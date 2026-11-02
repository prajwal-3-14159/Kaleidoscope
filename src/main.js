// Kaleidoscope — application entry point: state, render loop, UI wiring.

import { FRACTALS, getFractal, supportsDeepZoom, POWER_MIN, POWER_MAX } from './core/fractals.js';
import { PALETTES, buildLut, paletteCss, paletteSpan, getPalette } from './core/palettes.js';
import { MAPPINGS, SHADINGS } from './core/colorize.js';
import { sierpinskiFrame } from './core/escape.js';
import * as V from './view.js';
import { ReferenceManager, computeReferenceOnce } from './deep.js';
import { GpuRenderer } from './gl/renderer.js';
import { CpuEngine } from './cpu/cpu-engine.js';
import { attachInput } from './input.js';
import { TOURS, makeFlight, tourView } from './tour.js';
import { t, getLang, toggleLang, onLangChange, applyTranslations } from './i18n.js';
import { initBenchmark } from './benchmark.js';

const $ = (id) => document.getElementById(id);

// Below this pixel size the GPU switches from 32-bit direct iteration to perturbation.
const GPU_DIRECT_MIN_LOG2PIXEL = -19;
const CPU_DIRECT_MIN_LOG2PIXEL = -46;

// ------------------------------------------------------------------ state

const DEFAULTS = {
    fractal: 'mandelbrot', julia: false, juliaC: [-0.8, 0.156], power: 2,
    palette: 'cyberpunk', mapping: 'relative', densityLog: 0, offset: 0,
    cycle: false, cycleSpeed: 0.08, shading: 'flat', lightAngle: 45, interior: 'black',
    autoIter: true, iterSlider: 400, aa: 8, res: 100, engine: 'gpu',
};

const state = { ...DEFAULTS, juliaC: [...DEFAULTS.juliaC] };
let view = null;

const app = {
    state,
    get view() { return view; },
    computeVersion: 1,
    viewVersion: 1,
    colorVersion: 1,
    hoverPos: null,
    motion: null,          // { kind: 'fling'|'flight'|'zoom', ... }
    lastInteract: 0,
    benchmarking: false,
    cyclePhase: 0,
    lastSpec: null,
    lastProgress: null,
    iterBoost: 1,
    probedKey: null,
    probing: false,
};

// ------------------------------------------------------------------ engines

const stage = $('stage');
const glCanvas = $('gl-canvas');
const cpuCanvas = $('cpu-canvas');
const gpu = new GpuRenderer(glCanvas);
let cpu = null;
const getCpu = () => (cpu ||= new CpuEngine(cpuCanvas));
const refs = new ReferenceManager(() => { app.viewVersion++; });

function engine() { return state.engine === 'gpu' && gpu.ok ? gpu : getCpu(); }

function canvasSize() {
    const r = stage.getBoundingClientRect();
    const k = (window.devicePixelRatio || 1) * state.res / 100;
    return { w: Math.max(1, Math.round(r.width * k)), h: Math.max(1, Math.round(r.height * k)), k, css: r };
}

function syncCanvas() {
    const { w, h } = canvasSize();
    const e = engine();
    e.resize(w, h);
    const useGpu = e === gpu;
    glCanvas.hidden = !useGpu;
    cpuCanvas.hidden = useGpu;
    document.body.classList.toggle('engine-cpu', !useGpu);
}

// ------------------------------------------------------------------ derived values

function fractal() { return getFractal(state.fractal); }
function ysign() { return fractal().flipY ? -1 : 1; }
function homeBox() { const f = fractal(); return state.julia && f.juliaHome ? f.juliaHome : f.home; }
/** Width (CSS px) of the right-hand area covered by the floating panel. */
function panelInset(cssWidth) {
    const panel = $('panel');
    if (!panel || cssWidth < 760 || document.body.classList.contains('panel-collapsed') || document.body.classList.contains('ui-hidden')) return 0;
    const r = panel.getBoundingClientRect();
    return r.width > 0 ? Math.max(0, cssWidth - r.left) : 0;
}

/** Home view: the fractal's box fitted into the visible area (left of the panel). */
function homeView() {
    const { w, h, css } = canvasSize();
    const inset = panelInset(css.width);
    const freeW = Math.max(css.width * 0.4, css.width - inset);
    const v = V.viewForBox(homeBox(), (freeW / css.width) * (w / h));
    // Shift the centre right by half the inset so the box sits centred in the free area.
    V.translatePixels(v, (inset / 2) * (w / css.width), 0, h, 1);
    return v;
}
function homeLog2r() { const { w, h } = canvasSize(); return V.viewForBox(homeBox(), w / h).log2r; }
function zoomLog10() { return Math.max(0, V.zoomFactorLog10(view, homeLog2r())); }

/** Starting guess for the iteration limit at a given zoom depth (decades). */
function baseIterations(L) {
    return Math.round(Math.min(2e6, 300 + 250 * L ** 1.3));
}

// Auto iterations = base guess × an adaptive boost, refined by probing the view
// (see adaptIterations): the depth of structure varies hugely between locations.
function autoIterations() {
    return Math.round(Math.min(2e6, baseIterations(zoomLog10()) * app.iterBoost));
}

function iterFromSlider(v) { return Math.round(10 ** (1 + (v / 1000) * 5)); }
function sliderFromIter(n) { return Math.round((Math.log10(n) - 1) / 5 * 1000); }

function maxIter() { return state.autoIter ? autoIterations() : iterFromSlider(state.iterSlider); }

/** Deepest allowed zoom (log2 of half-height) for the current settings. */
function minLog2r() {
    const f = fractal();
    if (f.kind === 'geometric' || supportsDeepZoom(f, state.power)) return V.MIN_LOG2R;
    const { h } = canvasSize();
    const minPix = engine() === gpu ? GPU_DIRECT_MIN_LOG2PIXEL - 2 : CPU_DIRECT_MIN_LOG2PIXEL - 2;
    return minPix - 1 + Math.log2(h);
}

/** Colour settings for the engines. maxIter matters only for the Classic mapping. */
function colorParams(maxIterations = maxIter()) {
    const a = state.lightAngle * Math.PI / 180;
    return {
        mapping: MAPPINGS[state.mapping], density: 2 ** state.densityLog,
        offset: state.offset + app.cyclePhase, shading: SHADINGS[state.shading],
        light: [Math.cos(a), Math.sin(a)], interiorGlow: state.interior === 'glow',
        maxIter: maxIterations, span: paletteSpan(state.palette),
    };
}

/** Everything the engines need to draw the current frame. */
function buildSpec(pin = null) {
    const e = engine();
    const H = e.height, f = fractal();
    const log2pixel = V.log2PixelSize(view, H);
    const mi = maxIter();
    const spec = {
        fractal: f, julia: state.julia && f.kind === 'escape', juliaC: state.juliaC, power: state.power,
        maxIter: mi, ysign: ysign(), log2pixel, view, aa: e === gpu ? state.aa : 1,
        color: colorParams(mi), colorKey: `${app.colorVersion}`,
    };
    let refTag = '';
    if (f.kind === 'geometric') {
        spec.mode = 'sierpinski';
        spec.sier = sierpinskiFrame(view.cx, view.cy, view.bits, log2pixel);
        // Removal levels are integers that keep growing with depth: step through the
        // palette linearly so every level stays distinct, however deep.
        spec.color = { ...spec.color, mapping: MAPPINGS.linear, density: spec.color.density * 6 };
    } else {
        const minDirect = e === gpu ? GPU_DIRECT_MIN_LOG2PIXEL : CPU_DIRECT_MIN_LOG2PIXEL;
        const deep = supportsDeepZoom(f, state.power) && log2pixel < minDirect;
        if (deep) {
            const ref = refs.get({ fractal: f, julia: spec.julia, juliaC: state.juliaC, view, heightPx: H, maxIter: mi }, pin);
            if (ref) {
                const ps = V.pixelSizeParts(view, H);
                const shift = refs.shiftPx(ref, { view, heightPx: H });
                Object.assign(spec, { mode: 'perturb', ref, refShift: shift, pm: ps.pm, ec: ps.ec, pixel: 2 ** log2pixel });
                refTag = `r${ref.id}`;
            } else {
                spec.mode = 'wait';
            }
        } else {
            spec.mode = 'direct';
            spec.center = V.centerNumbers(view);
            spec.pixel = 2 ** log2pixel;
        }
    }
    spec.key = `${app.computeVersion}:${app.viewVersion}:${e.width}x${e.height}:${refTag}:${spec.mode}`;
    return spec;
}

/**
 * Spec for an arbitrary scene (used by the benchmark). p = { fractal (id), julia,
 * juliaC, power, maxIter, view, shading?, ref? }. Uses the current colour settings
 * unless overridden. Pixel units are the live canvas's pixels.
 */
let sceneKey = 0;
function makeSpec(p) {
    const e = engine();
    const f = getFractal(p.fractal);
    const H = e.height;
    const log2pixel = V.log2PixelSize(p.view, H);
    const color = { ...colorParams(p.maxIter), ...(p.shading ? { shading: SHADINGS[p.shading] } : {}), ...(p.mapping ? { mapping: MAPPINGS[p.mapping] } : {}) };
    const spec = {
        fractal: f, julia: !!p.julia, juliaC: p.juliaC || f.juliaC || [0, 0], power: p.power ?? 2,
        maxIter: p.maxIter, ysign: f.flipY ? -1 : 1, log2pixel, view: p.view, aa: 1,
        color, colorKey: `scene${sceneKey}`, key: `scene${sceneKey++}`,
    };
    if (p.ref) {
        const ps = V.pixelSizeParts(p.view, H);
        const shift = V.centerDelta(p.view, { cx: p.ref.cx, cy: p.ref.cy, bits: p.ref.bits }, -log2pixel);
        Object.assign(spec, { mode: 'perturb', ref: p.ref, refShift: shift, pm: ps.pm, ec: ps.ec, pixel: 2 ** log2pixel });
    } else {
        Object.assign(spec, { mode: 'direct', center: V.centerNumbers(p.view), pixel: 2 ** log2pixel });
    }
    return spec;
}

function setPaletteLut(id) {
    const lut = buildLut(id || state.palette);
    if (gpu.ok) gpu.setLut(lut);
    cpu?.setLut(lut);
}

// ------------------------------------------------------------------ view operations

function touchView() {
    app.viewVersion++;
    app.lastViewChange = performance.now();
    scheduleUrlUpdate();
}

function clampZoom() {
    const lo = minLog2r();
    if (view.log2r < lo) {
        view.log2r = lo;
        V.normalizeBits(view);
        if (performance.now() - (app.lastClampToast || 0) > 2500) {
            toast(t(supportsDeepZoom(fractal(), 2) && state.power !== 2 ? 'toast.deep-power' : 'toast.max-zoom'));
            app.lastClampToast = performance.now();
        }
    }
}

function cssToPx(pos) {
    const { css, w, h } = canvasSize();
    const k = w / css.width;
    return [(pos[0] - css.width / 2) * k, (css.height / 2 - pos[1]) * (h / css.height)];
}

app.panBy = (dxCss, dyCss) => {
    const { css, w, h } = canvasSize();
    V.translatePixels(view, -dxCss * w / css.width, dyCss * h / css.height, h, ysign());
    touchView();
};

app.zoomAt = (pos, dlog2) => {
    const [px, py] = cssToPx(pos);
    const { h } = canvasSize();
    const target = Math.max(minLog2r(), view.log2r + dlog2);
    V.zoomAtPixel(view, target - view.log2r, px, py, h, ysign());
    if (dlog2 < 0 && target === minLog2r()) clampZoom();
    touchView();
};

app.zoomAnimated = (pos, dlog2) => {
    app.motion = { kind: 'zoom', pos, remaining: dlog2 };
};

app.fling = (vel) => {
    app.motion = { kind: 'fling', vel: [...vel] };
};

app.stopMotion = () => { app.motion = null; };

app.interact = () => {
    app.lastInteract = performance.now();
    $('hint').classList.add('faded');
};

app.hover = (pos) => { app.hoverPos = pos; };

app.flyTo = (target, opts = {}) => {
    app.motion = { kind: 'flight', flight: makeFlight(V.cloneView(view), target, performance.now()), pin: opts.pin };
};

function stepMotion(now, dt) {
    const m = app.motion;
    if (!m) return;
    if (m.kind === 'fling') {
        app.panBy(m.vel[0] * dt / 16, m.vel[1] * dt / 16);
        const decay = Math.exp(-dt / 220);
        m.vel[0] *= decay; m.vel[1] *= decay;
        if (Math.hypot(m.vel[0], m.vel[1]) < 0.05) app.motion = null;
    } else if (m.kind === 'zoom') {
        const step = m.remaining * Math.min(1, dt / 90);
        app.zoomAt(m.pos, step);
        m.remaining -= step;
        if (Math.abs(m.remaining) < 0.01) app.motion = null;
    } else if (m.kind === 'flight') {
        const { view: v, done } = m.flight.at(now);
        view = v;
        touchView();
        if (done) app.motion = null;
    }
}

// ------------------------------------------------------------------ setters (UI -> state)

function invalidateCompute() { app.computeVersion++; scheduleUrlUpdate(); }
function invalidateColor() { app.colorVersion++; scheduleUrlUpdate(); }

app.setFractal = (id, { julia = state.julia, resetView = true, juliaC = null } = {}) => {
    const f = getFractal(id);
    state.fractal = f.id;
    state.julia = f.kind === 'escape' && julia;
    if (juliaC) state.juliaC = [...juliaC];
    else if (f.juliaC && !state.julia) state.juliaC = [...f.juliaC];
    if (resetView) view = homeView();
    app.iterBoost = 1;
    invalidateCompute();
    touchView();
    syncControls();
};

app.setJulia = (on, c = null) => {
    if (c) state.juliaC = [c[0], c[1]];
    state.julia = on && fractal().kind === 'escape';
    view = homeView();
    invalidateCompute();
    touchView();
    syncControls();
};

app.resetView = () => {
    app.stopMotion();
    app.flyTo(homeView());
};

function setPalette(id) {
    state.palette = id;
    const lut = buildLut(id);
    gpu.ok && gpu.setLut(lut);
    cpu?.setLut(lut);
    invalidateColor();
    syncControls();
}

function setEngine(name) {
    if (name === 'gpu' && !gpu.ok) name = 'cpu';
    state.engine = name;
    const e = engine();
    e.setLut(buildLut(state.palette));
    syncCanvas();
    e.dirty = true;
    clampZoom();
    invalidateCompute();
    syncControls();
}

// ------------------------------------------------------------------ keyboard

app.key = (key, shift) => {
    const { css } = canvasSize();
    const centerPos = [css.width / 2, css.height / 2];
    if (key === 'Escape') {
        if ($('help-dialog').open) $('help-dialog').close();
        else if (document.body.classList.contains('ui-hidden')) toggleUi();
        return false;
    }
    if (app.benchmarking) return false;
    switch (key) {
        case 'ArrowLeft': app.panBy(css.width * 0.12, 0); return true;
        case 'ArrowRight': app.panBy(-css.width * 0.12, 0); return true;
        case 'ArrowUp': app.panBy(0, css.height * 0.12); return true;
        case 'ArrowDown': app.panBy(0, -css.height * 0.12); return true;
        case '+': case '=': app.zoomAnimated(centerPos, -1); return true;
        case '-': case '_': app.zoomAnimated(centerPos, 1); return true;
        case 'r': case 'R': app.resetView(); return true;
        case 'h': case 'H': toggleUi(); return true;
        case 'p': case 'P': togglePanel(); return true;
        case 'f': case 'F':
            if (document.fullscreenElement) document.exitFullscreen();
            else document.documentElement.requestFullscreen?.();
            return true;
        case 'c': case 'C': state.cycle = !state.cycle; syncControls(); return true;
        case 'j': case 'J': openJuliaAtHover(); return true;
        case '?': $('help-dialog').showModal(); return true;
        default: return false;
    }
};

function hoverComplex(pos) {
    const [px, py] = cssToPx(pos);
    const [cx, cy] = V.centerNumbers(view);
    const ps = 2 ** V.log2PixelSize(view, canvasSize().h);
    return [cx + px * ps, cy + py * ps * ysign()];
}

function openJuliaAtHover() {
    const f = fractal();
    if (f.kind !== 'escape') return;
    if (state.julia) { app.setJulia(false); return; }
    const pos = app.hoverPos || (() => { const { css } = canvasSize(); return [css.width / 2, css.height / 2]; })();
    const c = hoverComplex(pos);
    app.setJulia(true, [+c[0].toPrecision(12), +c[1].toPrecision(12)]);
}

function toggleUi() { document.body.classList.toggle('ui-hidden'); }
function togglePanel() { document.body.classList.toggle('panel-collapsed'); }

// ------------------------------------------------------------------ picture-in-picture Julia preview

const PIP_CSS = 210;

function pipSpec() {
    const f = fractal();
    if (!app.hoverPos || state.julia || f.kind !== 'escape' || app.benchmarking || app.motion) return null;
    if (performance.now() - app.lastInteract < 250) return null;
    if (document.body.classList.contains('ui-hidden')) return null;
    const { css, w, h, k } = canvasSize();
    if (css.width < 760) return null;
    const size = Math.round(PIP_CSS * (w / css.width));
    const margin = 16 * (w / css.width);
    const c = hoverComplex(app.hoverPos);
    const box = f.juliaHome;
    const pixel = 2 * Math.max(box.hw, box.hh) / size;
    const spec = {
        fractal: f, julia: true, juliaC: c, power: state.power, maxIter: Math.min(maxIter(), 600),
        ysign: ysign(), log2pixel: Math.log2(pixel), mode: 'direct', center: [box.x, box.y], pixel,
        color: colorParams(Math.min(maxIter(), 600)),
    };
    const rect = [Math.round(margin), Math.round(margin), size, size];
    // DOM frame drawn over the same rectangle.
    const pip = $('pip');
    pip.style.left = `${16}px`;
    pip.style.top = `${css.height - 16 - PIP_CSS}px`;
    pip.style.width = pip.style.height = `${PIP_CSS}px`;
    void k;
    return { spec, rect, size, key: `${c[0]},${c[1]}|${f.id}|${state.power}|${app.colorVersion}|${size}` };
}

// ------------------------------------------------------------------ HUD

const fmt = new Intl.NumberFormat();

function fractalLabel() {
    const name = t(`fractal.${state.fractal}`);
    return state.julia ? t('fractal.julia-suffix', { name }) : name;
}

function updateHud(progress, spec) {
    $('hud-fractal').textContent = fractalLabel();
    const s = V.serialize(view);
    const clip = (str) => (str.length > 42 ? `${str.slice(0, 41)}…` : str);
    const im = s.y.startsWith('-') ? `− ${s.y.slice(1)}` : `+ ${s.y}`;
    $('hud-center').textContent = `${clip(s.x)} ${clip(im)}i`;
    $('hud-zoom').textContent = V.formatZoom(zoomLog10());
    $('hud-iter').textContent = spec?.mode === 'sierpinski' ? '—' : fmt.format(maxIter());
    const e = engine();
    const deep = spec?.mode === 'perturb' || spec?.mode === 'wait';
    $('hud-mode').textContent = e === gpu ? t(deep ? 'mode.gpu-deep' : 'mode.gpu') : t(deep ? 'mode.cpu-deep' : 'mode.cpu', { n: getCpu().threads });
    let status = '', pct = 100;
    if (spec?.mode === 'wait') {
        status = t('status.reference');
        pct = refs.progress * 100;
    } else if (progress) {
        if (progress.done) status = t('status.done', { ms: fmt.format(Math.round(progress.elapsed || 0)) });
        else if (progress.stage === 'preview') { status = t('status.preview'); pct = progress.fraction * 100; }
        else if (progress.sample <= 0) { status = t('status.rendering', { pct: Math.floor(progress.fraction * 100) }); pct = progress.fraction * 100; }
        else {
            status = t('status.refining', { n: progress.sample + 1, total: progress.total });
            pct = (progress.sample + progress.fraction) / progress.total * 100;
        }
    }
    $('hud-status').textContent = status;
    $('hud-progress').style.width = `${pct.toFixed(1)}%`;
}

// ------------------------------------------------------------------ main loop

let lastTime = performance.now();
let hudTimer = 0;

function tick(now) {
    const dt = Math.min(100, now - lastTime);
    lastTime = now;
    if (!app.benchmarking) {
        stepMotion(now, dt);
        if (state.cycle) {
            const e = engine();
            // CPU recolouring is costly; animate it at a lower rate.
            if (e === gpu || now - (app.lastCycle || 0) > 120) {
                app.cyclePhase = (app.cyclePhase + state.cycleSpeed * (now - (app.lastCycle || now)) / 1000) % 1;
                app.lastCycle = now;
                app.colorVersion++;
            }
        }
        const e = engine();
        const pin = app.motion?.kind === 'flight' ? app.motion.pin : null;
        const spec = buildSpec(pin);
        const pip = pipSpec();
        $('pip').classList.toggle('visible', !!pip);
        const progress = e.frame(spec, pip);
        adaptIterations(spec, now);
        if (now - hudTimer > 100) {
            updateHud(progress, spec);
            hudTimer = now;
        }
        app.lastSpec = spec;
    }
    requestAnimationFrame(tick);
}

/**
 * Once the view has settled, sample it at low resolution. If escaping pixels come
 * close to the iteration limit, deeper structure is being cut off: double it.
 * If they all escape far below it, halve it again (the gap avoids oscillation).
 */
async function adaptIterations(spec, now) {
    if (!state.autoIter || app.probing || app.motion || spec.mode === 'wait' || spec.mode === 'sierpinski') return;
    if (now - app.lastInteract < 350 || now - (app.lastViewChange || 0) < 350) return;
    if (app.probedKey === spec.key) return;
    app.probedKey = spec.key;
    app.probing = true;
    try {
        const st = await engine().probe(spec);
        if (window.kaleidoscope) window.kaleidoscope.lastProbe = st;
        if (!st) return;
        const n = spec.maxIter;
        // Unescaped pixels plus a real share escaping late = the limit is cutting off
        // structure. (A few late pixels alone are normal: near any boundary some
        // points always escape just under any limit.)
        const truncated = st.interior > 0.01 && st.late > Math.max(0.003, 0.1 * st.interior);
        // Nothing escaped at all: either a truly interior view or (deep zoom) far too
        // few iterations. Escalate a bounded number of times to tell the two apart.
        const nothingEscaped = st.interior > 0.999 && app.iterBoost < 8;
        if ((truncated || nothingEscaped) && n < 2e6 && app.iterBoost < 256) app.iterBoost *= 2;
        else if (st.maxMu < 0.15 * n && app.iterBoost > 1) app.iterBoost /= 2;
        else return;
        invalidateCompute();
        syncControls();
    } finally {
        app.probing = false;
    }
}

// ------------------------------------------------------------------ URL state

let urlTimer = null;
function scheduleUrlUpdate() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
        if (!view || app.benchmarking) return;
        history.replaceState(null, '', `#${stateToHash()}`);
    }, 500);
}

function stateToHash() {
    const s = V.serialize(view);
    const p = new URLSearchParams();
    p.set('f', state.fractal);
    if (state.julia) p.set('c', `${state.juliaC[0]},${state.juliaC[1]}`);
    if (state.power !== 2) p.set('p', state.power);
    p.set('x', s.x); p.set('y', s.y); p.set('z', s.z);
    p.set('pal', state.palette);
    if (state.mapping !== DEFAULTS.mapping) p.set('map', state.mapping);
    if (state.densityLog) p.set('d', state.densityLog);
    if (state.offset) p.set('o', state.offset);
    p.set('sh', state.shading);
    if (state.interior !== DEFAULTS.interior) p.set('in', state.interior);
    if (state.shading === 'relief' && state.lightAngle !== DEFAULTS.lightAngle) p.set('l', state.lightAngle);
    if (!state.autoIter) p.set('it', maxIter());
    return p.toString();
}

function loadHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (!p.has('f')) return false;
    try {
        const f = getFractal(p.get('f'));
        state.fractal = f.id;
        if (p.has('c') && f.kind === 'escape') { state.julia = true; state.juliaC = p.get('c').split(',').map(Number); }
        if (p.has('p')) state.power = clampPower(Number(p.get('p')));
        if (p.has('pal')) state.palette = getPalette(p.get('pal')).id;
        if (p.has('map') && p.get('map') in MAPPINGS) state.mapping = p.get('map');
        if (p.has('d')) state.densityLog = Number(p.get('d')) || 0;
        if (p.has('o')) state.offset = Number(p.get('o')) || 0;
        if (p.has('sh') && p.get('sh') in SHADINGS) state.shading = p.get('sh');
        if (p.has('in')) state.interior = p.get('in') === 'glow' ? 'glow' : 'black';
        if (p.has('l')) state.lightAngle = Number(p.get('l')) || 45;
        if (p.has('it')) { state.autoIter = false; state.iterSlider = sliderFromIter(Number(p.get('it'))); }
        if (p.has('x') && p.has('y') && p.has('z')) view = V.makeView(p.get('x'), p.get('y'), Number(p.get('z')));
        return true;
    } catch (err) {
        console.warn('Ignoring malformed link', err);
        return false;
    }
}

function clampPower(p) {
    if (!Number.isFinite(p)) return 2;
    return Math.min(POWER_MAX, Math.max(POWER_MIN, Math.round(p * 10) / 10));
}

// ------------------------------------------------------------------ toast

let toastTimer = null;
function toast(msg, ms = 2200) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
app.toast = toast;

// ------------------------------------------------------------------ export

async function exportImage() {
    const scale = Number($('export-scale').value) || 1;
    const e = engine();
    let W = Math.round(e.width * scale), H = Math.round(e.height * scale);
    const maxSide = 16384, maxPixels = 120e6;
    const shrink = Math.min(1, maxSide / Math.max(W, H), Math.sqrt(maxPixels / (W * H)));
    W = Math.floor(W * shrink); H = Math.floor(H * shrink);
    const spec = buildSpec();
    if (spec.mode === 'wait') return;
    toast(t('toast.export-start', { w: W, h: H }), 60000);
    const btn = $('btn-export');
    btn.disabled = true;
    try {
        const img = await e.renderImage(spec, W, H, e.height / H, Math.max(4, state.aa), (f) => {
            $('toast').textContent = `${t('toast.export-start', { w: W, h: H })} ${Math.round(f * 100)}%`;
        });
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        c.getContext('2d').putImageData(img, 0, 0);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `kaleidoscope-${state.fractal}${state.julia ? '-julia' : ''}-${W}x${H}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        toast(t('toast.export-done'));
    } catch (err) {
        console.error(err);
        toast(String(err.message || err));
    } finally {
        btn.disabled = false;
        e.dirty = true;
    }
}

// ------------------------------------------------------------------ thumbnails

async function makeThumbnails() {
    const e = engine();
    const W = 192, H = 128;
    for (const f of FRACTALS) {
        const box = f.home;
        const hh = Math.max(box.hh, box.hw / (W / H));
        const log2pixel = Math.log2(2 * hh / H);
        const v = V.makeView(box.x, box.y, Math.log2(hh));
        const spec = {
            fractal: f, julia: false, juliaC: f.juliaC || [0, 0], power: 2, maxIter: 300,
            ysign: f.flipY ? -1 : 1, log2pixel, view: v,
            color: { ...colorParams(300), offset: state.offset, shading: SHADINGS.relief },
        };
        if (f.kind === 'geometric') { spec.mode = 'sierpinski'; spec.sier = sierpinskiFrame(v.cx, v.cy, v.bits, log2pixel); }
        else { spec.mode = 'direct'; spec.center = [box.x, box.y]; spec.pixel = 2 ** log2pixel; }
        try {
            const img = await e.renderImage(spec, W, H, 1, e === gpu ? 4 : 1);
            const c = document.createElement('canvas');
            c.width = W; c.height = H;
            c.getContext('2d').putImageData(img, 0, 0);
            const el = document.querySelector(`.fractal-card[data-fractal="${f.id}"] img`);
            if (el) el.src = c.toDataURL('image/png');
        } catch (err) { console.warn('thumbnail failed', err); }
    }
}

// ------------------------------------------------------------------ controls

function buildControls() {
    const grid = $('fractal-grid');
    grid.innerHTML = '';
    for (const f of FRACTALS) {
        const b = document.createElement('button');
        b.className = 'fractal-card';
        b.dataset.fractal = f.id;
        b.type = 'button';
        b.innerHTML = '<img alt=""><span></span>';
        b.addEventListener('click', () => app.setFractal(f.id, { julia: false }));
        grid.appendChild(b);
    }
    const pal = $('palette-grid');
    pal.innerHTML = '';
    for (const p of PALETTES) {
        const b = document.createElement('button');
        b.className = 'palette-swatch';
        b.type = 'button';
        b.dataset.palette = p.id;
        b.style.background = paletteCss(p.id);
        b.addEventListener('click', () => setPalette(p.id));
        pal.appendChild(b);
    }
    const tour = $('tour');
    tour.innerHTML = '';
    for (const tr of TOURS) {
        const o = document.createElement('option');
        o.value = tr.id;
        tour.appendChild(o);
    }
    translateDynamic();

    $('toggle-julia').addEventListener('change', (e) => app.setJulia(e.target.checked));
    const juliaInput = (axis, el, num) => {
        const apply = (v) => {
            if (!Number.isFinite(v)) return;
            state.juliaC[axis] = Math.max(-2, Math.min(2, v));
            invalidateCompute();
            syncControls();
        };
        $(el).addEventListener('input', (e) => apply(Number(e.target.value)));
        $(num).addEventListener('change', (e) => apply(Number(e.target.value)));
    };
    juliaInput(0, 'julia-re', 'julia-re-num');
    juliaInput(1, 'julia-im', 'julia-im-num');

    const setPower = (p) => {
        state.power = clampPower(p);
        clampZoom();
        invalidateCompute();
        touchView();
        syncControls();
    };
    $('power').addEventListener('input', (e) => setPower(Number(e.target.value)));
    $('power-num').addEventListener('change', (e) => setPower(Number(e.target.value)));

    $('mapping').addEventListener('change', (e) => { state.mapping = e.target.value; invalidateColor(); });
    $('density').addEventListener('input', (e) => { state.densityLog = Number(e.target.value); invalidateColor(); syncControls(); });
    $('offset').addEventListener('input', (e) => { state.offset = Number(e.target.value); app.cyclePhase = 0; invalidateColor(); });
    $('toggle-cycle').addEventListener('change', (e) => { state.cycle = e.target.checked; });
    $('cycle-speed').addEventListener('input', (e) => { state.cycleSpeed = Number(e.target.value); });
    for (const b of document.querySelectorAll('#shading-seg .seg')) {
        b.addEventListener('click', () => { state.shading = b.dataset.shading; invalidateColor(); syncControls(); });
    }
    $('light-angle').addEventListener('input', (e) => { state.lightAngle = Number(e.target.value); invalidateColor(); });
    $('interior').addEventListener('change', (e) => { state.interior = e.target.value; invalidateColor(); });

    $('toggle-auto-iter').addEventListener('change', (e) => {
        if (!e.target.checked) state.iterSlider = sliderFromIter(autoIterations());
        state.autoIter = e.target.checked;
        invalidateCompute();
        syncControls();
    });
    $('iter').addEventListener('input', (e) => {
        state.autoIter = false;
        state.iterSlider = Number(e.target.value);
        invalidateCompute();
        syncControls();
    });
    $('aa').addEventListener('change', (e) => { state.aa = Number(e.target.value); invalidateCompute(); });
    $('res').addEventListener('input', (e) => {
        state.res = Number(e.target.value);
        syncCanvas();
        touchView();
        syncControls();
    });
    for (const b of document.querySelectorAll('#engine-seg .seg')) {
        b.addEventListener('click', () => setEngine(b.dataset.engine));
    }

    $('btn-tour-go').addEventListener('click', () => goTour($('tour').value));
    $('btn-reset').addEventListener('click', () => app.resetView());
    $('btn-share').addEventListener('click', async () => {
        history.replaceState(null, '', `#${stateToHash()}`);
        try { await navigator.clipboard.writeText(location.href); toast(t('toast.link-copied')); }
        catch { toast(location.href, 5000); }
    });
    $('btn-export').addEventListener('click', exportImage);
    $('btn-panel').addEventListener('click', togglePanel);
    $('btn-lang').addEventListener('click', (e) => { e.preventDefault(); toggleLang(); });
    $('btn-help').addEventListener('click', () => $('help-dialog').showModal());
    $('btn-help-close').addEventListener('click', () => $('help-dialog').close());
    onLangChange(() => { translateDynamic(); syncControls(); });
}

function translateDynamic() {
    for (const b of document.querySelectorAll('.fractal-card')) b.querySelector('span').textContent = t(`fractal.${b.dataset.fractal}`);
    for (const b of document.querySelectorAll('.palette-swatch')) {
        b.title = t(`palette.${b.dataset.palette}`);
        b.setAttribute('aria-label', b.title);
    }
    for (const o of $('tour').options) o.textContent = t(`tour.${o.value}`);
}

function goTour(id) {
    const tr = TOURS.find(x => x.id === id);
    if (!tr) return;
    const sameFractal = tr.fractal === state.fractal && !!tr.julia === state.julia &&
        (!tr.julia || (tr.c[0] === state.juliaC[0] && tr.c[1] === state.juliaC[1]));
    if (!sameFractal) app.setFractal(tr.fractal, { julia: !!tr.julia, juliaC: tr.c, resetView: !!tr.home || !sameFractal });
    if (tr.fractal === 'mandelbrot' && state.power !== 2) { state.power = 2; invalidateCompute(); syncControls(); }
    if (tr.mapping && state.mapping === 'relative') { state.mapping = tr.mapping; invalidateColor(); syncControls(); }
    const target = tr.home ? homeView() : tourView(tr);
    if (!sameFractal && tr.home) return;
    const pin = supportsDeepZoom(fractal(), state.power) && target.log2r < -20
        ? { cx: target.cx, cy: target.cy, bits: target.bits, maxIter: baseIterations((homeLog2r() - target.log2r) * Math.log10(2)) }
        : null;
    app.flyTo(target, { pin });
}

function syncControls() {
    const f = fractal();
    for (const b of document.querySelectorAll('.fractal-card')) b.classList.toggle('active', b.dataset.fractal === state.fractal);
    $('row-julia').classList.toggle('hidden', f.kind !== 'escape');
    // Encyclopedia entry for what is on screen (Julia sets share one page).
    $('learn-link').href = `${getLang() === 'ja' ? '/ja' : ''}/learn/${state.julia ? 'julia' : f.id}.html`;
    $('toggle-julia').checked = state.julia;
    $('julia-controls').classList.toggle('hidden', !state.julia);
    $('julia-re').value = state.juliaC[0];
    $('julia-im').value = state.juliaC[1];
    if (document.activeElement !== $('julia-re-num')) $('julia-re-num').value = state.juliaC[0];
    if (document.activeElement !== $('julia-im-num')) $('julia-im-num').value = state.juliaC[1];
    $('power-section').classList.toggle('hidden', f.kind !== 'escape');
    $('power').value = Math.min(8, state.power);
    if (document.activeElement !== $('power-num')) $('power-num').value = state.power;
    $('power-note').classList.toggle('hidden', state.power === 2);
    for (const b of document.querySelectorAll('.palette-swatch')) b.classList.toggle('active', b.dataset.palette === state.palette);
    $('mapping').value = state.mapping;
    $('mapping-note').classList.toggle('hidden', !(state.mapping === 'relative' && view && zoomLog10() > 6));
    $('density').value = state.densityLog;
    $('density-val').textContent = `${(2 ** state.densityLog).toFixed(2)}×`;
    $('offset').value = state.offset;
    $('toggle-cycle').checked = state.cycle;
    $('cycle-speed').value = state.cycleSpeed;
    for (const b of document.querySelectorAll('#shading-seg .seg')) b.classList.toggle('active', b.dataset.shading === state.shading);
    $('light-row').classList.toggle('hidden', state.shading !== 'relief');
    $('light-angle').value = state.lightAngle;
    $('interior').value = state.interior;
    $('toggle-auto-iter').checked = state.autoIter;
    $('iter').value = state.autoIter ? sliderFromIter(autoIterations()) : state.iterSlider;
    $('iter-val').textContent = fmt.format(maxIter());
    $('aa').value = String(state.aa);
    $('aa').disabled = engine() !== gpu;
    $('res').value = state.res;
    $('res-val').textContent = `${state.res}%`;
    for (const b of document.querySelectorAll('#engine-seg .seg')) {
        b.classList.toggle('active', b.dataset.engine === (engine() === gpu ? 'gpu' : 'cpu'));
        if (b.dataset.engine === 'gpu') b.disabled = !gpu.ok;
    }
    $('engine-note').textContent = !gpu.ok ? t('engine.no-webgl')
        : engine() === gpu ? t('engine.gpu-note') : t('engine.cpu-note', { n: getCpu().threads });
}

// Keep the auto-iteration readout fresh while zooming.
setInterval(() => {
    if (state.autoIter && view) {
        $('iter').value = sliderFromIter(autoIterations());
        $('iter-val').textContent = fmt.format(maxIter());
    }
}, 250);

// ------------------------------------------------------------------ boot

function boot() {
    applyTranslations();
    buildControls();
    const fromLink = loadHash();
    if (!gpu.ok) state.engine = 'cpu';
    syncCanvas();
    if (!view) view = homeView();
    const lut = buildLut(state.palette);
    if (gpu.ok) gpu.setLut(lut);
    if (state.engine === 'cpu') getCpu().setLut(lut);
    syncControls();
    attachInput(stage, app);
    new ResizeObserver(() => { syncCanvas(); touchView(); }).observe(stage);
    if (!gpu.ok) toast(t('engine.no-webgl'), 5000);
    initBenchmark(app, { engine, gpu, makeSpec, computeReference: computeReferenceOnce, setPaletteLut, makeView: V.makeView, getFractal, toast, restore: () => { setPaletteLut(); engine().dirty = true; engine().invalidate(); app.viewVersion++; } });
    requestAnimationFrame(tick);
    // Compile remaining shader variants and render thumbnails once the first frame is up.
    setTimeout(async () => {
        if (gpu.ok) { try { gpu.warmUp(FRACTALS); } catch (err) { console.error(err); } }
        await makeThumbnails();
    }, 400);
    if (fromLink) $('hint').classList.add('faded');
    setTimeout(() => $('hint').classList.add('faded'), 9000);
}

// Expose for debugging and automated tests.
window.kaleidoscope = { app, state, gpu, refs, V, makeSpec, get view() { return view; }, set view(v) { view = v; touchView(); }, goTour, setEngine, setPalette, buildSpec };

boot();
