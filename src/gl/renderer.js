// WebGL2 renderer.
//
// Pipeline per view:
//   compute   (fractal maths)  -> data texture: mu, log2 DE, normal angle, extra
//   colorize  (palette/light)  -> linear colour, accumulated over jittered samples (anti-aliasing)
//   present                    -> screen, compositing in-progress stages over the previous frame
//
// Work is split into horizontal bands and spread over animation frames with an
// adaptive budget (driven by GPU fences), so deep zooms with huge iteration counts
// never freeze the page. Colour-only changes re-use the computed data instantly.

import { VERTEX, computeFragment, COLORIZE, PRESENT, BLIT } from './shaders.js';
import { relativeTransform } from '../view.js';

const PREVIEW_DIV = 4;
const ORBIT_W = 4096;

// Low-discrepancy (R2) sub-pixel offsets; sample 0 is the pixel centre.
function jitter(k) {
    if (k === 0) return [0, 0];
    const g = 1.32471795724474602596;
    return [((k / g) % 1) - 0.5, ((k / (g * g)) % 1) - 0.5];
}

/**
 * Escape statistics from a buffer of per-pixel data (mu in every 4th float):
 * interior = fraction that never escaped, late = fraction escaping in the last
 * half of the iteration budget, maxMu = largest escape count.
 */
export function probeStats(buf, maxIter) {
    let interior = 0, late = 0, maxMu = 0;
    const n = buf.length / 4;
    for (let i = 0; i < buf.length; i += 4) {
        const mu = buf[i];
        if (mu < 0) interior++;
        else {
            if (mu > maxMu) maxMu = mu;
            if (mu > maxIter / 2) late++;
        }
    }
    return { interior: interior / n, late: late / n, maxMu, n };
}

export class GpuRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        const gl = canvas.getContext('webgl2', {
            antialias: false, alpha: false, depth: false, stencil: false,
            preserveDrawingBuffer: false, powerPreference: 'high-performance',
        });
        this.ok = !!gl && !!gl.getExtension('EXT_color_buffer_float');
        if (!this.ok) return;
        this.gl = gl;
        gl.getExtension('OES_texture_float_linear');
        this.vao = gl.createVertexArray();
        this.programs = new Map();
        this.colorizeProg = this._program(COLORIZE);
        this.presentProg = this._program(PRESENT);
        this.blitProg = this._program(BLIT);
        this.lutTex = gl.createTexture();
        this.orbitTex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE7);
        gl.bindTexture(gl.TEXTURE_2D, this.orbitTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, 1, 1, 0, gl.RG, gl.FLOAT, new Float32Array(2));
        this.orbitId = null;
        this.budget = 2e8;          // pixel-iterations per frame (adapted)
        this.fence = null;
        this.job = null;
        this.prev = null;           // snapshot of the last displayed frame
        this.width = 0; this.height = 0;
        this.pip = null;
        this.dirty = true;
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        this.gpuName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    }

    // ------------------------------------------------------------------ setup

    _compile(type, src) {
        const gl = this.gl;
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
    }

    _program(fs) {
        const gl = this.gl;
        const prog = gl.createProgram();
        const vs = this._compile(gl.VERTEX_SHADER, VERTEX);
        const fsh = this._compile(gl.FRAGMENT_SHADER, fs);
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fsh);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            const log = gl.getShaderInfoLog(fsh) || gl.getProgramInfoLog(prog);
            console.error(log, fs.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
            throw new Error(`Shader link failed: ${log}`);
        }
        const cache = new Map();
        const u = (name) => {
            if (!cache.has(name)) cache.set(name, gl.getUniformLocation(prog, name));
            return cache.get(name);
        };
        return { prog, u };
    }

    _computeProgram(spec) {
        const key = `${spec.fractal.id}|${spec.julia ? 1 : 0}|${spec.mode}`;
        if (!this.programs.has(key)) {
            this.programs.set(key, this._program(computeFragment(spec.fractal, { julia: spec.julia, mode: spec.mode })));
        }
        return this.programs.get(key);
    }

    /** Compile all program variants up front (avoids a hitch on first use). */
    warmUp(fractals) {
        for (const fractal of fractals) {
            const modes = fractal.kind === 'escape' ? ['direct', 'perturb'] : ['sierpinski'];
            for (const mode of modes) for (const julia of fractal.kind === 'escape' ? [false, true] : [false]) {
                this._computeProgram({ fractal, julia, mode });
            }
        }
    }

    /** Bind on a scratch unit that no shader samples, so setup never creates feedback loops. */
    _scratch() { this.gl.activeTexture(this.gl.TEXTURE7); }

    _target(w, h, internal, filter) {
        const gl = this.gl;
        const tex = gl.createTexture();
        this._scratch();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { tex, fbo, w, h };
    }

    _freeTarget(t) {
        if (!t) return;
        this.gl.deleteTexture(t.tex);
        this.gl.deleteFramebuffer(t.fbo);
    }

    _makeSet(w, h) {
        const gl = this.gl;
        const pw = Math.max(1, Math.ceil(w / PREVIEW_DIV)), ph = Math.max(1, Math.ceil(h / PREVIEW_DIV));
        return {
            w, h, pw, ph,
            data0: this._target(w, h, gl.RGBA32F, gl.NEAREST),
            dataTmp: this._target(w, h, gl.RGBA32F, gl.NEAREST),
            accum: this._target(w, h, gl.RGBA16F, gl.NEAREST),
            pdata: this._target(pw, ph, gl.RGBA32F, gl.NEAREST),
            pcolor: this._target(pw, ph, gl.RGBA16F, gl.LINEAR),
        };
    }

    _freeSet(s) {
        if (!s) return;
        for (const k of ['data0', 'dataTmp', 'accum', 'pdata', 'pcolor']) this._freeTarget(s[k]);
    }

    resize(w, h) {
        if (!this.ok || (w === this.width && h === this.height)) return;
        this.width = w; this.height = h;
        this.canvas.width = w; this.canvas.height = h;
        this._freeSet(this.set);
        this.set = this._makeSet(w, h);
        if (this.prev) { this._freeTarget(this.prev.a); this._freeTarget(this.prev.b); }
        const gl = this.gl;
        this.prev = { a: this._target(w, h, gl.RGBA16F, gl.LINEAR), b: this._target(w, h, gl.RGBA16F, gl.LINEAR), valid: false };
        this.job = null;
        this.dirty = true;
    }

    setLut(bytes) {
        const gl = this.gl;
        this._scratch();
        gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, bytes.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    _uploadOrbit(ref) {
        if (this.orbitId === ref.id) return;
        const gl = this.gl;
        const n = ref.len0 + ref.len1;
        const rows = Math.max(1, Math.ceil(n / ORBIT_W));
        const data = new Float32Array(ORBIT_W * rows * 2);
        data.set(ref.orbit.subarray(0, n * 2));
        this._scratch();
        gl.bindTexture(gl.TEXTURE_2D, this.orbitTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, ORBIT_W, rows, 0, gl.RG, gl.FLOAT, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        this.orbitId = ref.id;
    }

    // ------------------------------------------------------------------ passes

    _bindTex(unit, tex) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
    }

    _draw() {
        const gl = this.gl;
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /**
     * Run the compute shader into `target` for rows [y0, y0+rows).
     * origin: target pixel (0,0) relative to the image centre (target pixels).
     * pxScale: target pixel -> spec pixel.
     */
    _compute(spec, target, y0, rows, origin, pxScale, jit) {
        const gl = this.gl;
        const P = this._computeProgram(spec);
        gl.useProgram(P.prog);
        const u = P.u;
        gl.uniform2f(u('u_origin'), origin[0], origin[1]);
        gl.uniform2f(u('u_jitter'), jit[0], jit[1]);
        gl.uniform1f(u('u_pxScale'), pxScale);
        gl.uniform1f(u('u_ysign'), spec.ysign);
        gl.uniform1f(u('u_log2pixel'), spec.log2pixel);
        gl.uniform1i(u('u_maxIter'), spec.maxIter);
        gl.uniform1f(u('u_power'), spec.power);
        gl.uniform1i(u('u_powerInt'), Number.isInteger(spec.power) ? spec.power : 0);
        gl.uniform2f(u('u_juliaC'), spec.juliaC[0], spec.juliaC[1]);
        // Unit 0 must never hold the texture being rendered to (WebGL feedback loop).
        this._bindTex(0, this.orbitTex);
        if (spec.mode === 'direct') {
            gl.uniform2f(u('u_center'), spec.center[0], spec.center[1]);
            gl.uniform1f(u('u_pixel'), spec.pixel);
        } else if (spec.mode === 'perturb') {
            this._uploadOrbit(spec.ref);
            gl.uniform1i(u('u_orbit'), 0);
            gl.uniform1i(u('u_len0'), spec.ref.len0);
            gl.uniform1i(u('u_len1'), spec.ref.len1);
            gl.uniform2f(u('u_refShift'), spec.refShift[0], spec.refShift[1]);
            gl.uniform1f(u('u_pm'), spec.pm);
            gl.uniform1i(u('u_ec'), spec.ec);
        } else {
            const s = spec.sier;
            gl.uniform2f(u('u_sLocal'), s.lu, s.lv);
            gl.uniform1f(u('u_sScale'), s.scale);
            gl.uniform1fv(u('u_sStatus'), Float32Array.from(s.status));
            gl.uniform1fv(u('u_sLast'), Float32Array.from(s.lastZero));
            gl.uniform1f(u('u_sK'), s.K);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        gl.viewport(0, 0, target.w, target.h);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, y0, target.w, rows);
        gl.disable(gl.BLEND);
        this._draw();
        gl.disable(gl.SCISSOR_TEST);
    }

    _colorize(color, dataTarget, outTarget, y0, rows, blend) {
        const gl = this.gl;
        const P = this.colorizeProg;
        gl.useProgram(P.prog);
        const u = P.u;
        this._bindTex(0, dataTarget.tex);
        this._bindTex(1, this.lutTex);
        gl.uniform1i(u('u_data'), 0);
        gl.uniform1i(u('u_lut'), 1);
        gl.uniform1i(u('u_mapping'), color.mapping);
        gl.uniform1f(u('u_density'), color.density);
        gl.uniform1f(u('u_offset'), color.offset);
        gl.uniform1i(u('u_shading'), color.shading);
        gl.uniform2f(u('u_light'), color.light[0], color.light[1]);
        gl.uniform1i(u('u_interiorGlow'), color.interiorGlow ? 1 : 0);
        gl.uniform1f(u('u_maxIter'), color.maxIter || 1);
        gl.uniform1f(u('u_span'), color.span ?? 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, outTarget.fbo);
        gl.viewport(0, 0, outTarget.w, outTarget.h);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, y0, outTarget.w, rows);
        if (blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); } else gl.disable(gl.BLEND);
        this._draw();
        gl.disable(gl.BLEND);
        gl.disable(gl.SCISSOR_TEST);
    }

    // ------------------------------------------------------------------ jobs

    _costPerPixel(spec) {
        if (spec.mode === 'sierpinski') return 30;
        return spec.maxIter * (spec.mode === 'perturb' ? 2 : 1) * (Number.isInteger(spec.power) ? 1 : 3);
    }

    _newJob(spec) {
        const s = this.set;
        const fullCost = s.w * s.h * this._costPerPixel(spec);
        const passes = [];
        if (spec.mode === 'wait' || fullCost > this.budget * 1.5) passes.push({ kind: 'preview' });
        // 'wait' = reference orbit not ready: keep showing the reprojected previous frame.
        if (spec.mode !== 'wait') for (let k = 0; k < Math.max(1, spec.aa); k++) passes.push({ kind: 'full', sample: k });
        this.job = {
            key: spec.key, colorKey: spec.colorKey, spec, passes, idx: 0, row: 0,
            samples: 0, hadPreview: false, start: performance.now(), elapsed: null,
            view: spec.view, height: s.h, ysign: spec.ysign,
        };
    }

    _passSize(pass) {
        const s = this.set;
        return pass.kind === 'preview' ? [s.pw, s.ph] : [s.w, s.h];
    }

    _runBand(spec, pass, y0, rows) {
        const s = this.set;
        if (pass.kind === 'preview') {
            this._compute(spec, s.pdata, y0, rows, [-s.pw / 2, -s.ph / 2], s.w / s.pw, [0, 0]);
            this._colorize(spec.color, s.pdata, s.pcolor, y0, rows, false);
        } else {
            const data = pass.sample === 0 ? s.data0 : s.dataTmp;
            this._compute(spec, data, y0, rows, [-s.w / 2, -s.h / 2], 1, jitter(pass.sample));
            this._colorize(spec.color, data, s.accum, y0, rows, pass.sample > 0);
        }
    }

    _work(spec) {
        const job = this.job;
        if (spec.mode === 'wait') return false;
        let remaining = this.budget;
        let did = false;
        while (job.idx < job.passes.length) {
            const pass = job.passes[job.idx];
            const [w, h] = this._passSize(pass);
            const rowCost = w * Math.max(1, this._costPerPixel(spec) || 1000); // never NaN: that would loop forever
            let rows = Math.min(h - job.row, Math.floor(remaining / rowCost));
            if (rows < 1) {
                if (did) break;
                rows = 1;
            }
            // Bands go top-down; GL rows count from the bottom.
            this._runBand(spec, pass, h - job.row - rows, rows);
            did = true;
            remaining -= rows * rowCost;
            job.row += rows;
            if (job.row >= h) {
                job.idx++;
                job.row = 0;
                if (pass.kind === 'full') job.samples++;
                else job.hadPreview = true;
                if (job.idx >= job.passes.length) job.elapsed = performance.now() - job.start;
            }
            if (remaining <= 0) break;
        }
        return did;
    }

    _recolor(spec) {
        const job = this.job;
        const s = this.set;
        job.colorKey = spec.colorKey;
        job.spec = spec;
        if (job.hadPreview || job.passes[job.idx]?.kind === 'preview') {
            this._colorize(spec.color, s.pdata, s.pcolor, 0, s.ph, false);
        }
        if (job.samples >= 1 || job.passes[job.idx]?.kind === 'full') {
            this._colorize(spec.color, s.data0, s.accum, 0, s.h, false);
        }
        if (job.samples >= 1) {
            // Restart anti-aliasing from sample 1 with the new colours.
            job.samples = 1;
            job.idx = job.passes.findIndex(p => p.kind === 'full' && p.sample === 1);
            if (job.idx < 0) job.idx = job.passes.length;
            job.row = 0;
            job.elapsed = job.idx >= job.passes.length ? job.elapsed : null;
        }
    }

    _presentUniforms(job, P) {
        const gl = this.gl;
        const u = P.u;
        const s = this.set;
        const pass = job.passes[job.idx];
        let stage = 3, doneY = 1;
        if (pass) {
            const [, h] = this._passSize(pass);
            doneY = job.row / h;
            stage = pass.kind === 'preview' ? 0 : pass.sample === 0 ? 1 : 2;
        }
        this._bindTex(0, s.accum.tex);
        this._bindTex(1, s.pcolor.tex);
        this._bindTex(2, this.prev.valid ? this.prev.a.tex : s.pcolor.tex);
        gl.uniform1i(u('u_accum'), 0);
        gl.uniform1i(u('u_preview'), 1);
        gl.uniform1i(u('u_prev'), 2);
        gl.uniform1i(u('u_stage'), stage);
        gl.uniform1f(u('u_doneY'), doneY);
        gl.uniform1f(u('u_samples'), job.samples);
        gl.uniform2f(u('u_size'), s.w, s.h);
        gl.uniform1i(u('u_hasPreview'), job.hadPreview ? 1 : 0);
        gl.uniform1i(u('u_hasPrev'), this.prev.valid ? 1 : 0);
        if (this.prev.valid) {
            const t = relativeTransform(this.prev.view, this.prev.height, job.view, s.h, job.ysign);
            gl.uniform3f(u('u_prevXform'), t.shift[0], t.shift[1], t.scale);
            gl.uniform2f(u('u_prevSize'), this.prev.w, this.prev.h);
        }
    }

    _present(job, fbo, linear) {
        const gl = this.gl;
        const P = this.presentProg;
        gl.useProgram(P.prog);
        this._presentUniforms(job, P);
        gl.uniform1i(P.u('u_linearOut'), linear ? 1 : 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, this.set.w, this.set.h);
        gl.disable(gl.BLEND);
        this._draw();
    }

    /** Freeze what is on screen now so it can be reprojected while the next view renders. */
    _snapshot() {
        const job = this.job;
        if (!job) return;
        this._present(job, this.prev.b.fbo, true);
        [this.prev.a, this.prev.b] = [this.prev.b, this.prev.a];
        Object.assign(this.prev, { valid: true, view: job.view, height: job.height, w: this.set.w, h: this.set.h });
    }

    // ------------------------------------------------------------------ public

    /**
     * Advance rendering for one animation frame. Returns progress info.
     * `spec` describes what to draw (see main.js buildSpec); `pip` is optional.
     */
    frame(spec, pip) {
        if (!this.ok || this.lost || !this.set) return null;
        const gl = this.gl;
        let gpuBusy = false;
        if (this.fence) {
            const st = gl.clientWaitSync(this.fence, 0, 0);
            gpuBusy = st === gl.TIMEOUT_EXPIRED;
            if (!gpuBusy) { gl.deleteSync(this.fence); this.fence = null; }
        }
        if (gpuBusy) {
            this.budget = Math.max(2e6, this.budget * 0.75);
            return this._progress();
        }
        if (this._lastWorked) this.budget = Math.min(2e11, this.budget * 1.2);

        let changed = false;
        if (spec) {
            if (!this.job || this.job.key !== spec.key) {
                if (this.job) this._snapshot();
                this._newJob(spec);
                changed = true;
            } else if (this.job.colorKey !== spec.colorKey) {
                this._recolor(spec);
                changed = true;
            }
        }
        let worked = false;
        if (spec && this.job && this.job.idx < this.job.passes.length) worked = this._work(this.job.spec = spec);
        this._lastWorked = worked;

        const pipChanged = this._updatePip(pip);
        if (changed || worked || pipChanged || this.dirty) {
            if (this.job) this._present(this.job, null, false);
            this._drawPip();
            this.dirty = false;
            this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
            gl.flush();
        }
        return this._progress();
    }

    _progress() {
        const job = this.job;
        if (!job) return null;
        const pass = job.passes[job.idx];
        const total = job.passes.filter(p => p.kind === 'full').length;
        if (!pass) return { done: true, samples: job.samples, total, elapsed: job.elapsed };
        const [, h] = this._passSize(pass);
        return {
            done: false, stage: pass.kind, sample: pass.sample ?? -1, total,
            fraction: job.row / h, samples: job.samples,
        };
    }

    /** Force a full re-render on the next frame (e.g. after a reference orbit arrives). */
    invalidate() { if (this.job) this.job.key = null; }

    /**
     * Render a small low-resolution sample of `spec` and return escape statistics:
     * { interior: fraction of pixels that never escaped, maxMu, n } — used to adapt
     * the iteration limit to how deep the structure in view really goes.
     */
    probe(spec) {
        if (spec.mode === 'wait') return null;
        const w = 96, h = Math.max(8, Math.round(96 * this.set.h / this.set.w));
        return probeStats(this.readData(spec, w, h), spec.maxIter);
    }

    /** Raw per-pixel data for spec on a w×h grid covering the view (rows bottom-up). */
    readData(spec, w, h) {
        const gl = this.gl;
        if (!this.probeT || this.probeT.h !== h || this.probeT.w !== w) {
            this._freeTarget(this.probeT);
            this.probeT = this._target(w, h, gl.RGBA32F, gl.NEAREST);
        }
        this._compute(spec, this.probeT, 0, h, [-w / 2, -h / 2], this.set.w / w, [0, 0]);
        const buf = new Float32Array(w * h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.probeT.fbo);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, buf);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.dirty = true;
        return buf;
    }

    // ------------------------------------------------------------------ picture-in-picture

    _updatePip(pip) {
        const gl = this.gl;
        if (!pip) {
            const had = !!this.pip?.visible;
            if (this.pip) this.pip.visible = false;
            return had;
        }
        const size = pip.size;
        if (!this.pip || this.pip.size !== size) {
            if (this.pip) { this._freeTarget(this.pip.data); this._freeTarget(this.pip.color); }
            this.pip = { size, data: this._target(size, size, gl.RGBA32F, gl.NEAREST), color: this._target(size, size, gl.RGBA16F, gl.LINEAR), key: null };
        }
        const rectChanged = !this.pip.visible || this.pip.rect?.join() !== pip.rect.join();
        this.pip.visible = true;
        this.pip.rect = pip.rect;
        if (this.pip.key === pip.key) return rectChanged;
        this.pip.key = pip.key;
        this._compute(pip.spec, this.pip.data, 0, size, [-size / 2, -size / 2], 1, [0, 0]);
        this._colorize(pip.spec.color, this.pip.data, this.pip.color, 0, size, false);
        return true;
    }

    _drawPip() {
        if (!this.pip?.visible) return;
        const gl = this.gl;
        const P = this.blitProg;
        const [x, y, w, h] = this.pip.rect;
        gl.useProgram(P.prog);
        this._bindTex(0, this.pip.color.tex);
        gl.uniform1i(P.u('u_tex'), 0);
        gl.uniform4f(P.u('u_rect'), x, y, w, h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(x, y, w, h);
        this._draw();
        gl.viewport(0, 0, this.set.w, this.set.h);
    }

    // ------------------------------------------------------------------ offscreen (export / benchmark)

    /**
     * Render `spec` completely at width×height into an RGBA8 image, in tiles.
     * pxScale converts output pixels to spec pixels (e.g. 0.5 for a 2× export).
     * Returns ImageData (top-down rows).
     */
    async renderImage(spec, width, height, pxScale, aa, onProgress) {
        const gl = this.gl;
        const T = 512;
        const data = this._target(T, T, gl.RGBA32F, gl.NEAREST);
        const accum = this._target(T, T, gl.RGBA16F, gl.NEAREST);
        const out8 = this._target(T, T, gl.RGBA8, gl.NEAREST);
        const img = new ImageData(width, height);
        const buf = new Uint8Array(T * T * 4);
        const tilesX = Math.ceil(width / T), tilesY = Math.ceil(height / T);
        let done = 0;
        try {
            for (let ty = 0; ty < tilesY; ty++) {
                for (let tx = 0; tx < tilesX; tx++) {
                    // Tile origin in output pixels (GL y-up), relative to the image centre.
                    const ox = tx * T - width / 2;
                    const oyTop = ty * T;                      // from the top of the image
                    const oy = height / 2 - oyTop - T;         // bottom edge of tile, y-up
                    for (let k = 0; k < aa; k++) {
                        this._compute(spec, data, 0, T, [ox, oy], pxScale, jitter(k));
                        this._colorize(spec.color, data, accum, 0, T, k > 0);
                    }
                    // Resolve: average samples and convert to sRGB bytes.
                    const P = this.presentProg;
                    gl.useProgram(P.prog);
                    this._bindTex(0, accum.tex);
                    gl.uniform1i(P.u('u_accum'), 0);
                    gl.uniform1i(P.u('u_stage'), 3);
                    gl.uniform1f(P.u('u_samples'), aa);
                    gl.uniform2f(P.u('u_size'), T, T);
                    gl.uniform1i(P.u('u_hasPrev'), 0);
                    gl.uniform1i(P.u('u_linearOut'), 0);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, out8.fbo);
                    gl.viewport(0, 0, T, T);
                    this._draw();
                    gl.readPixels(0, 0, T, T, gl.RGBA, gl.UNSIGNED_BYTE, buf);
                    for (let row = 0; row < T; row++) {
                        const yImg = oyTop + (T - 1 - row);
                        if (yImg >= height) continue;
                        const w = Math.min(T, width - tx * T);
                        img.data.set(buf.subarray(row * T * 4, row * T * 4 + w * 4), (yImg * width + tx * T) * 4);
                    }
                    done++;
                    onProgress?.(done / (tilesX * tilesY));
                    await new Promise(r => setTimeout(r, 0));
                }
            }
        } finally {
            this._freeTarget(data); this._freeTarget(accum); this._freeTarget(out8);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            this.dirty = true;
        }
        return img;
    }

    /**
     * Benchmark frame: render `spec` fully at w×h (no progressive budget), show it
     * scaled on screen, and wait for the GPU to finish. Returns elapsed ms.
     */
    benchFrame(spec, w, h) {
        const gl = this.gl;
        if (!this.bench || this.bench.w !== w || this.bench.h !== h) {
            if (this.bench) { this._freeTarget(this.bench.data); this._freeTarget(this.bench.color); }
            this.bench = { w, h, data: this._target(w, h, gl.RGBA32F, gl.NEAREST), color: this._target(w, h, gl.RGBA16F, gl.LINEAR) };
        }
        const t0 = performance.now();
        const pxScale = this.set.h / h; // spec pixels are screen pixels
        this._compute(spec, this.bench.data, 0, h, [-w / 2, -h / 2], pxScale, [0, 0]);
        this._colorize(spec.color, this.bench.data, this.bench.color, 0, h, false);
        // Letterbox the fixed-size frame onto the canvas.
        const s = Math.min(this.set.w / w, this.set.h / h);
        const vw = Math.round(w * s), vh = Math.round(h * s);
        const vx = Math.round((this.set.w - vw) / 2), vy = Math.round((this.set.h - vh) / 2);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.set.w, this.set.h);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const P = this.blitProg;
        gl.useProgram(P.prog);
        this._bindTex(0, this.bench.color.tex);
        gl.uniform1i(P.u('u_tex'), 0);
        gl.uniform4f(P.u('u_rect'), vx, vy, vw, vh);
        gl.viewport(vx, vy, vw, vh);
        this._draw();
        // Synchronise: reading one pixel waits for all queued GPU work.
        const px = new Float32Array(4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bench.color.fbo);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.set.w, this.set.h);
        this.dirty = true;
        return performance.now() - t0;
    }
}
