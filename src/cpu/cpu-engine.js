// CPU ("Local Browser") engine: same maths as the GPU, computed in 64-bit floats
// across a pool of Web Workers, coloured on the main thread.
// Exposes the same frame()/resize()/renderImage() interface as GpuRenderer.

import { colorizePixel, makeLinearLut, toSrgb8 } from '../core/colorize.js';
import { iterateDirect } from '../core/escape.js';
import { relativeTransform } from '../view.js';

const PREVIEW_DIV = 4;

export class CpuEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.threads = Math.max(1, Math.min(16, (navigator.hardwareConcurrency || 4) - 1));
        this.workers = [];
        for (let i = 0; i < this.threads; i++) {
            const w = new Worker(new URL('../workers/cpu-worker.js', import.meta.url), { type: 'module' });
            w.onmessage = (e) => this._onMessage(e.data);
            this.workers.push(w);
        }
        this.nextId = 1;
        this.job = null;
        this.refId = null;
        this.width = 0; this.height = 0;
        this.snap = document.createElement('canvas');
        this.snapCtx = this.snap.getContext('2d');
        this.snapInfo = null;
        this.lutId = null;
        this.dirty = true;
        this.pipCanvas = document.createElement('canvas');
        this.pipKey = null;
        this.pipRect = null;
        this.pending = new Map();   // one-off renders (export/benchmark) by job id
        this.gpuName = `${this.threads} CPU threads`;
    }

    get ok() { return true; }

    setLut(bytes) { this.lut = makeLinearLut(bytes); }

    resize(w, h) {
        if (w === this.width && h === this.height) return;
        this.width = w; this.height = h;
        this.canvas.width = w; this.canvas.height = h;
        this.job = null;
        this.snapInfo = null;
        this.dirty = true;
    }

    // ---------------------------------------------------------------- jobs

    _plainSpec(spec, pxScale) {
        return {
            mode: spec.mode, fold: spec.fractal.fold || {}, power: spec.power, julia: spec.julia,
            juliaC: spec.juliaC, maxIter: spec.maxIter, log2pixel: spec.log2pixel, ysign: spec.ysign,
            center: spec.center, pixel: spec.pixel, refShift: spec.refShift, refId: spec.ref?.id,
            sier: spec.sier, pxScale,
        };
    }

    _sendOrbit(ref) {
        if (!ref || ref.id === this.refId) return;
        this.refId = ref.id;
        for (const w of this.workers) w.postMessage({ type: 'orbit', refId: ref.id, orbit: ref.orbit, len0: ref.len0, len1: ref.len1 });
    }

    /** Start computing a w×h grid; rows are interleaved across workers. */
    _dispatch(id, stage, spec, w, h, pxScale) {
        this._sendOrbit(spec.ref);
        const s = this._plainSpec(spec, pxScale);
        const n = this.workers.length;
        this.workers.forEach((worker, i) => {
            const rows = [];
            for (let y = i; y < h; y += n) rows.push(y);
            worker.postMessage({ type: 'job', id, stage, w, h, rows, s });
        });
    }

    _layer(w, h) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        return { canvas: c, ctx: c.getContext('2d'), img: new ImageData(w, h), data: new Float32Array(w * h * 4), rowsDone: 0, finished: 0, w, h };
    }

    _newJob(spec) {
        const w = this.width, h = this.height;
        const pw = Math.max(1, Math.ceil(w / PREVIEW_DIV)), ph = Math.max(1, Math.ceil(h / PREVIEW_DIV));
        const id = this.nextId++;
        this.job = {
            id, key: spec.key, colorKey: spec.colorKey, spec, view: spec.view, height: h, ysign: spec.ysign,
            stage: 'preview', start: performance.now(), elapsed: null,
            preview: this._layer(pw, ph), full: this._layer(w, h), dirtyLayers: true,
        };
        // 'wait' = reference orbit not ready: keep showing the reprojected snapshot.
        if (spec.mode !== 'wait') this._dispatch(id, 'preview', spec, pw, ph, w / pw);
    }

    _onMessage(m) {
        const one = this.pending.get(m.id);
        if (one) {
            if (m.finished) { if (++one.finished === this.workers.length) { this.pending.delete(m.id); one.resolve(one.data); } return; }
            m.rows.forEach((y, i) => one.data.set(m.data.subarray(i * one.w * 4, (i + 1) * one.w * 4), y * one.w * 4));
            return;
        }
        const job = this.job;
        if (!job || m.id !== job.id) return;
        const layer = m.stage === 'preview' ? job.preview : job.full;
        if (m.finished) {
            if (++layer.finished === this.workers.length) {
                if (m.stage === 'preview') {
                    job.stage = 'full';
                    this._dispatch(job.id, 'full', job.spec, job.full.w, job.full.h, 1);
                } else {
                    job.stage = 'done';
                    job.elapsed = performance.now() - job.start;
                }
                job.dirtyLayers = true;
            }
            return;
        }
        const w = layer.w;
        m.rows.forEach((y, i) => {
            layer.data.set(m.data.subarray(i * w * 4, (i + 1) * w * 4), y * w * 4);
            this._colorRow(layer, y, job.spec.color);
        });
        layer.rowsDone += m.rows.length;
        layer.ctx.putImageData(layer.img, 0, 0);
        job.dirtyLayers = true;
    }

    _colorSettings(color) {
        const a = color.light;
        return { ...color, lut: this.lut, lightX: a[0], lightY: a[1] };
    }

    _colorRow(layer, y, color, settings = this._colorSettings(color)) {
        const w = layer.w, d = layer.data, px = layer.img.data;
        const c = [0, 0, 0];
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            colorizePixel(d[i], d[i + 1], d[i + 2], d[i + 3], settings, c);
            px[i] = toSrgb8(c[0]); px[i + 1] = toSrgb8(c[1]); px[i + 2] = toSrgb8(c[2]); px[i + 3] = 255;
        }
    }

    _recolor(spec) {
        const job = this.job;
        job.colorKey = spec.colorKey;
        job.spec = spec;
        const settings = this._colorSettings(spec.color);
        for (const layer of [job.preview, job.full]) {
            if (!layer.rowsDone) continue;
            for (let y = 0; y < layer.h; y++) {
                if (layer.img.data[(y * layer.w) * 4 + 3] === 0) continue; // row not computed yet
                this._colorRow(layer, y, spec.color, settings);
            }
            layer.ctx.putImageData(layer.img, 0, 0);
        }
        job.dirtyLayers = true;
    }

    _snapshot() {
        if (!this.job) return;
        this.snap.width = this.width; this.snap.height = this.height;
        this.snapCtx.drawImage(this.canvas, 0, 0);
        this.snapInfo = { view: this.job.view, height: this.height, w: this.width, h: this.height };
    }

    _compose() {
        const ctx = this.ctx, w = this.width, h = this.height, job = this.job;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        if (job.stage !== 'done' && this.snapInfo) {
            const t = relativeTransform(this.snapInfo.view, this.snapInfo.height, job.view, h, job.ysign);
            const { w: pw, h: ph } = this.snapInfo;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(this.snap, (-pw / 2 - t.shift[0]) / t.scale + w / 2, (-ph / 2 + t.shift[1]) / t.scale + h / 2, pw / t.scale, ph / t.scale);
        }
        if (job.stage !== 'done' && job.preview.rowsDone) {
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(job.preview.canvas, 0, 0, w, h);
        }
        if (job.full.rowsDone) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(job.full.canvas, 0, 0);
        }
        if (this.pipRect) {
            const [x, y, pw, ph] = this.pipRect;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(this.pipCanvas, x, h - y - ph, pw, ph);
        }
    }

    frame(spec, pip) {
        if (!this.width) return null;
        let changed = this.dirty;
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
        if (this._updatePip(pip)) changed = true;
        if (this.job && (changed || this.job.dirtyLayers)) {
            this._compose();
            this.job.dirtyLayers = false;
            this.dirty = false;
        }
        return this._progress();
    }

    _progress() {
        const job = this.job;
        if (!job) return null;
        if (job.stage === 'done') return { done: true, samples: 1, total: 1, elapsed: job.elapsed };
        const layer = job.stage === 'preview' ? job.preview : job.full;
        return { done: false, stage: job.stage, sample: job.stage === 'full' ? 0 : -1, total: 1, fraction: layer.rowsDone / layer.h, samples: 0 };
    }

    invalidate() { if (this.job) this.job.key = null; }

    _updatePip(pip) {
        if (!pip) {
            const had = !!this.pipRect;
            this.pipRect = null;
            return had;
        }
        const rectChanged = this.pipRect?.join() !== pip.rect.join();
        this.pipRect = pip.rect;
        const now = performance.now();
        if (this.pipKey === pip.key || now - (this.pipTime || 0) < 100) return rectChanged;
        this.pipKey = pip.key;
        this.pipTime = now;
        // Small Julia preview computed directly on the main thread.
        const n = 120, s = pip.spec;
        this.pipCanvas.width = n; this.pipCanvas.height = n;
        const img = new ImageData(n, n);
        const out = new Float64Array(4), c = [0, 0, 0];
        const settings = this._colorSettings(s.color);
        const scale = pip.size / n;
        const fold = s.fractal.fold;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            const px = (x + 0.5 - n / 2) * scale, py = (n / 2 - y - 0.5) * scale * s.ysign;
            iterateDirect(fold, s.power, true, s.center[0] + px * s.pixel, s.center[1] + py * s.pixel,
                s.juliaC[0], s.juliaC[1], Math.min(s.maxIter, 400), s.log2pixel + Math.log2(scale), s.ysign, out);
            colorizePixel(out[0], out[1], out[2], out[3], settings, c);
            const i = (y * n + x) * 4;
            img.data[i] = toSrgb8(c[0]); img.data[i + 1] = toSrgb8(c[1]); img.data[i + 2] = toSrgb8(c[2]); img.data[i + 3] = 255;
        }
        this.pipCanvas.getContext('2d').putImageData(img, 0, 0);
        return true;
    }

    // ---------------------------------------------------------------- offscreen

    _computeAll(spec, w, h, pxScale) {
        const id = this.nextId++;
        return new Promise((resolve) => {
            this.pending.set(id, { w, h, data: new Float32Array(w * h * 4), finished: 0, resolve });
            this._dispatch(id, 'one-off', spec, w, h, pxScale);
        });
    }

    _toImage(spec, data, w, h) {
        const layer = { w, h, data, img: new ImageData(w, h) };
        const settings = this._colorSettings(spec.color);
        for (let y = 0; y < h; y++) this._colorRow(layer, y, spec.color, settings);
        return layer.img;
    }

    async renderImage(spec, width, height, pxScale, aa, onProgress) {
        onProgress?.(0);
        const data = await this._computeAll(spec, width, height, pxScale);
        onProgress?.(1);
        if (this.job) this.job.key = null; // the one-off may have pre-empted the live job
        return this._toImage(spec, data, width, height);
    }

    async benchFrame(spec, w, h) {
        const t0 = performance.now();
        const data = await this._computeAll(spec, w, h, this.height / h);
        const img = this._toImage(spec, data, w, h);
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        tmp.getContext('2d').putImageData(img, 0, 0);
        const s = Math.min(this.width / w, this.height / h);
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.width, this.height);
        this.ctx.drawImage(tmp, (this.width - w * s) / 2, (this.height - h * s) / 2, w * s, h * s);
        this.dirty = true;
        if (this.job) this.job.key = null;
        return performance.now() - t0;
    }
}
