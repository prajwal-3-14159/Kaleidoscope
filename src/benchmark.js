// Benchmark: renders a fixed, deterministic set of animated scenes at a fixed
// resolution and reports pixels-per-second as a score (100 points = 1 Mpx/s).
//
// Only the duration returned by engine.benchFrame() is counted. Time spent
// waiting for requestAnimationFrame, preparing reference orbits, playing the
// intro, or updating the overlay never contributes, so the score reflects
// rendering throughput. All DOM work happens between benchFrame() calls.
//
// Around that core sits the show: an intro card with a countdown, letterbox
// bars with a live HUD, scene titles, a results finale and optional video
// capture of the engine canvas.

import { t, onLangChange } from './i18n.js';

const HISTORY_KEY = 'kaleidoscope.bench.v3'; // v3: deep scene retuned (10^-20, 14k iterations)
const HISTORY_MAX = 10;
const RECORD_KEY = 'kaleidoscope.bench.record';

// Performance tiers by score, best first.
const TIERS = [
    { min: 3000, id: 'legendary' },
    { min: 1500, id: 'ultra' },
    { min: 700, id: 'high' },
    { min: 300, id: 'mid' },
    { min: 0, id: 'entry' },
];
const tierIndex = (score) => TIERS.findIndex((x) => score >= x.min);

// The one reference point we can vouch for: a measured quick run on an Apple M5 laptop.
const REFERENCE_SCORE = 1450; // Apple M5 laptop, quick mode, benchmark v3 (measured 1,463–1,483)

// Video capture: first supported type wins.
const RECORD_MIME_TYPES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm',
];
const RECORD_BITRATE = 12_000_000;

// Show timings (ms). None of this is part of the measured time.
const INTRO_REVEAL_MS = 800;
const INTRO_BEAT_MS = 600;
const INTRO_FADE_MS = 450;
const SCENE_TITLE_MS = 1600;
const FINISH_HOLD_MS = 900;
const COUNT_UP_MS = 1800;
const SPARK_FRAMES = 60;
const BURST_PARTICLES = 24;

// GPU runs use a fixed resolution per mode; the CPU engine is far slower so it
// gets a small frame and fewer frames (recorded in the result).
const MODES = {
    quick: { gpu: { w: 1280, h: 720, frames: 40 }, cpu: { w: 480, h: 270, frames: 8 } },
    full: { gpu: { w: 1920, h: 1080, frames: 120 }, cpu: { w: 480, h: 270, frames: 20 } },
};

// ------------------------------------------------------------------ scenes
// Each scene's frame(s, ctx) maps progress s in [0, 1] to a makeSpec() argument.
// Scenes fix their palette, shading and (cyclic) colour mapping so the pictures do
// not depend on the user's colour settings.

const lerp = (a, b, s) => a + (b - a) * s;

/**
 * Zoom towards `target`, keeping it centred as the half-height shrinks.
 * log2 half-height is interpolated linearly; the centre follows
 * target + (start - target) * (r - r1) / (r0 - r1).
 */
function zoomPath(start, end, s) {
    const l0 = Math.log2(start.r), l1 = Math.log2(end.r);
    const l = lerp(l0, l1, s);
    const k = (2 ** l - end.r) / (start.r - end.r);
    return {
        x: end.x + (start.x - end.x) * k,
        y: end.y + (start.y - end.y) * k,
        log2: l,
    };
}

const SCENES = [
    {
        id: 'seahorse',
        palette: 'classic',
        frame(s, { makeView }) {
            const p = zoomPath({ x: -0.75, y: 0.1, r: 1.2 }, { x: -0.7436438870371587, y: 0.1318259042053120, r: 1.2e-4 }, s);
            return { fractal: 'mandelbrot', maxIter: 600, shading: 'relief', mapping: 'sqrt', view: makeView(p.x, p.y, p.log2) };
        },
    },
    {
        id: 'julia',
        palette: 'aurora',
        frame(s, { makeView }) {
            const a = 2 * Math.PI * s;
            return {
                fractal: 'mandelbrot', julia: true, juliaC: [0.7885 * Math.cos(a), 0.7885 * Math.sin(a)],
                maxIter: 400, shading: 'filaments', mapping: 'sqrt', view: makeView(0, 0, Math.log2(1.25)),
            };
        },
    },
    {
        id: 'ship',
        palette: 'fire',
        frame(s, { makeView }) {
            const p = zoomPath({ x: -0.45, y: -0.55, r: 1.2 }, { x: -1.7612, y: -0.0293, r: 0.03 }, s);
            return { fractal: 'burning-ship', maxIter: 500, shading: 'relief', mapping: 'sqrt', view: makeView(p.x, p.y, p.log2) };
        },
    },
    {
        id: 'power',
        palette: 'neon',
        frame(s, { makeView }) {
            const power = +(2 + 4 * Math.sin(Math.PI * s) ** 2).toFixed(2);
            return { fractal: 'mandelbrot', power, maxIter: 300, shading: 'flat', mapping: 'sqrt', view: makeView(-0.3, 0, Math.log2(1.4)) };
        },
    },
    {
        id: 'deep',
        palette: 'ocean',
        DEEP_X: '-0.743643887037158704752191506114774',
        DEEP_Y: '0.131825904205311970493132056385139',
        // Deep enough to need perturbation throughout, shallow enough that every
        // frame still escapes within the budget (measured: 0% unescaped at 1e-17..1e-21).
        MAX_ITER: 14000,
        LOG2_START: Math.log2(1e-6),
        LOG2_END: Math.log2(1e-20),
        /** Untimed set-up: one reference orbit, computed for the deepest view. */
        async prepare({ makeView, computeReference, getFractal }) {
            const view = makeView(this.DEEP_X, this.DEEP_Y, this.LOG2_END);
            return computeReference({ fractal: getFractal('mandelbrot'), julia: false, juliaC: [0, 0], view, maxIter: this.MAX_ITER });
        },
        frame(s, { makeView, ref }) {
            const view = makeView(this.DEEP_X, this.DEEP_Y, lerp(this.LOG2_START, this.LOG2_END, s));
            return { fractal: 'mandelbrot', maxIter: this.MAX_ITER, shading: 'relief', mapping: 'sqrt', view, ref };
        },
    },
];

// ------------------------------------------------------------------ history

function loadHistory() {
    try {
        const h = JSON.parse(localStorage.getItem(HISTORY_KEY));
        return Array.isArray(h) ? h : [];
    } catch { return []; }
}

function saveHistory(run) {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify([run, ...loadHistory()].slice(0, HISTORY_MAX)));
    } catch { /* storage unavailable: history is optional */ }
}

function loadRecordPref() {
    try { return localStorage.getItem(RECORD_KEY) === '1'; } catch { return false; }
}

function saveRecordPref(on) {
    try { localStorage.setItem(RECORD_KEY, on ? '1' : '0'); } catch { /* optional */ }
}

/** "ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)" -> "Apple M5". */
function prettyGpu(name) {
    if (!name) return '—';
    const m = /^ANGLE \((.*)\)$/.exec(name);
    if (!m) return name;
    const parts = m[1].split(', ');
    const dev = (parts[1] || parts[0])
        .replace(/^ANGLE[^:]*:\s*/, '')
        .replace(/\s*\(0x[0-9a-f]+\)/gi, '')
        .replace(/\s+Direct3D.*$/i, '')
        .trim();
    return dev || name;
}

const fmtSize = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

class Aborted extends Error {}

// ------------------------------------------------------------------ module

export function initBenchmark(app, deps) {
    const { engine, gpu, makeSpec, computeReference, setPaletteLut, makeView, getFractal, toast, restore } = deps;
    const $ = (id) => document.getElementById(id);
    const dialog = $('bench-dialog');
    const overlay = $('bench-overlay');
    const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const recSupported = typeof MediaRecorder !== 'undefined'
        && typeof HTMLCanvasElement !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;

    let running = false;
    let abortRequested = false;
    let wake = null;         // resolves the current sleep() early (abort)
    let lastMode = 'quick';
    let lastInfo = null;     // { run, best, isPb } for the results panel
    let countAnim = 0;       // requestAnimationFrame id of the score count-up
    let video = null;        // { url, name, size } of the finished recording

    const requestAbort = () => { abortRequested = true; wake?.(); };
    const checkAbort = () => { if (abortRequested) throw new Aborted(); };
    const nextFrame = () => new Promise(requestAnimationFrame);
    /** Wait `ms`, or less when an abort is requested. */
    const sleep = (ms) => new Promise((resolve) => {
        const done = () => { clearTimeout(timer); if (wake === done) wake = null; resolve(); };
        const timer = setTimeout(done, ms);
        wake = done;
    });

    // ---------------------------------------------------------- formatting

    const fmtDate = (ts) => new Date(ts).toLocaleString(document.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const modeName = (mode) => t(mode === 'full' ? 'bench.full' : 'bench.quick');
    const engineName = (run) => (run.engine === 'gpu' ? 'GPU' : 'CPU');
    const resName = (run) => `${run.w}×${run.h}`;
    const metaText = (run) => `${modeName(run.mode)} · ${t('bench.meta', { engine: engineName(run), res: resName(run), gpu: prettyGpu(run.gpu), date: fmtDate(run.date) })}`;
    const tierName = (score) => t('bench.tier.' + TIERS[tierIndex(score)].id);

    // ---------------------------------------------------------- results dialog

    function renderHistory() {
        const ul = $('bench-history');
        const history = loadHistory();
        ul.replaceChildren();
        if (!history.length) {
            const li = document.createElement('li');
            li.textContent = t('bench.empty');
            ul.append(li);
            return;
        }
        for (const run of history) {
            const li = document.createElement('li');
            const score = document.createElement('strong');
            score.textContent = run.score.toLocaleString();
            const info = document.createElement('span');
            info.textContent = ` ${modeName(run.mode)} · ${engineName(run)} · ${prettyGpu(run.gpu)} · ${fmtDate(run.date)}`;
            li.append(score, info);
            ul.append(li);
        }
    }

    /** Everything in the results panel except the animated score number. */
    function renderResults({ run, best, isPb }) {
        // Per-scene rows; the bar is FPS relative to the best scene.
        const body = $('bench-table');
        body.replaceChildren();
        const maxFps = Math.max(...run.scenes.map((s) => s.fps), 1e-9);
        run.scenes.forEach((sc, i) => {
            const tr = document.createElement('tr');
            const first = document.createElement('td');
            const name = document.createElement('span');
            name.className = 'sb-name';
            name.textContent = t('bench.scene.' + sc.id);
            const track = document.createElement('span');
            track.className = 'sb-track';
            const fill = document.createElement('i');
            fill.className = 'sb-fill' + (sc.fps === maxFps ? ' best' : '');
            fill.style.setProperty('--v', (sc.fps / maxFps).toFixed(4));
            fill.style.setProperty('--i', i);
            track.append(fill);
            first.append(name, track);
            tr.append(first);
            for (const text of [sc.fps.toFixed(1), sc.seconds.toFixed(2) + ' s']) {
                const td = document.createElement('td');
                td.textContent = text;
                tr.append(td);
            }
            body.append(tr);
        });

        // Tier label with a five-step ladder.
        const ti = tierIndex(run.score);
        $('bench-tier-name').textContent = `${t('bench.tier')} · ${t('bench.tier.' + TIERS[ti].id)}`;
        const dots = $('bench-tier-dots');
        dots.replaceChildren();
        for (let j = 0; j < TIERS.length; j++) {
            const d = document.createElement('i');
            if (j < TIERS.length - ti) d.className = 'on';
            d.style.setProperty('--k', j);
            dots.append(d);
        }
        $('bench-pb').hidden = !isPb;

        // Comparison: this run, your best, and the one reference we can vouch for.
        const rows = [
            { cls: 'this', name: t('bench.cmp.this'), value: run.score, text: run.score.toLocaleString() },
            { cls: 'best', name: t('bench.cmp.best'), value: best, text: best.toLocaleString() },
            { cls: 'ref', name: t('bench.cmp.ref'), value: REFERENCE_SCORE, text: '≈ ' + REFERENCE_SCORE.toLocaleString() },
        ];
        const max = Math.max(...rows.map((r) => r.value), 1);
        const ul = $('bench-compare');
        ul.replaceChildren();
        for (const r of rows) {
            const li = document.createElement('li');
            li.className = r.cls;
            const name = document.createElement('span');
            name.className = 'cmp-name';
            name.textContent = r.name;
            const val = document.createElement('span');
            val.className = 'cmp-val';
            val.textContent = r.text;
            const track = document.createElement('span');
            track.className = 'cmp-track';
            const bar = document.createElement('i');
            bar.style.setProperty('--v', (r.value / max).toFixed(4));
            track.append(bar);
            li.append(name, val, track);
            ul.append(li);
        }

        $('bench-meta').textContent = metaText(run);
    }

    function showVideoButton() {
        const a = $('btn-bench-download');
        if (!video) { a.hidden = true; return; }
        a.href = video.url;
        a.download = video.name;
        a.textContent = `${t('bench.download')} · ${fmtSize(video.size)}`;
        a.hidden = false;
    }

    function setVideo(blob, score) {
        revokeVideo();
        if (!blob) return;
        const ext = /mp4/i.test(blob.type) ? 'mp4' : 'webm';
        video = { url: URL.createObjectURL(blob), name: `kaleidoscope-benchmark-${score}.${ext}`, size: blob.size };
    }

    function revokeVideo() {
        if (video) URL.revokeObjectURL(video.url);
        video = null;
        const a = $('btn-bench-download');
        a.hidden = true;
        a.removeAttribute('href');
    }

    /** ~24 particles that fly out along fixed angles (pure CSS animation, see bench.css). */
    function buildBurst() {
        const box = $('bench-burst');
        box.replaceChildren();
        for (let i = 0; i < BURST_PARTICLES; i++) {
            const p = document.createElement('i');
            p.style.setProperty('--a', ((i / BURST_PARTICLES) * 360 + (i % 2 ? 6 : -6)).toFixed(1) + 'deg');
            p.style.setProperty('--d', (90 + ((i * 7) % 5) * 22) + 'px');
            p.style.setProperty('--s', (4 + (i % 3) * 2) + 'px');
            p.style.setProperty('--delay', ((i % 4) * 25) + 'ms');
            box.append(p);
        }
    }

    function countUp(target, done) {
        cancelAnimationFrame(countAnim);
        const el = $('bench-score');
        if (reducedMotion()) { el.textContent = target.toLocaleString(); done(); return; }
        const t0 = performance.now();
        const step = (now) => {
            const k = Math.min(1, Math.max(0, (now - t0) / COUNT_UP_MS));
            const eased = 1 - (1 - k) ** 4;
            el.textContent = Math.round(target * eased).toLocaleString();
            if (k < 1) countAnim = requestAnimationFrame(step);
            else done();
        };
        countAnim = requestAnimationFrame(step);
    }

    /** End of the count-up: scale punch, particle burst, bars fill, tier and badge appear. */
    function finale() {
        $('bench-results').classList.add('done');
        if (reducedMotion()) return;
        $('bench-score').animate([
            { transform: 'scale(1)' },
            { transform: 'scale(1.16)', offset: 0.4 },
            { transform: 'scale(1)' },
        ], { duration: 560, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.2)' });
        const burst = $('bench-burst');
        burst.classList.remove('go');
        void burst.offsetWidth;
        burst.classList.add('go');
    }

    function showStart() {
        $('bench-start').classList.remove('hidden');
        $('bench-results').classList.add('hidden');
        renderHistory();
        if (!dialog.open) dialog.showModal();
    }

    function showResults(info) {
        lastInfo = info;
        const results = $('bench-results');
        $('bench-start').classList.add('hidden');
        results.classList.remove('hidden', 'done');
        $('bench-burst').classList.remove('go');
        renderResults(info);
        showVideoButton();
        if (!dialog.open) dialog.showModal();
        $('bench-score').textContent = '0';
        countUp(info.run.score, finale);
    }

    // ---------------------------------------------------------- overlay / HUD

    const ui = {
        scene: $('bench-scene'), chip: $('bench-chip'), fps: $('bench-fps'), ms: $('bench-ms'),
        elapsed: $('bench-elapsed'), score: $('bench-live-score'), progress: $('bench-progress-bar'),
        spark: $('bench-spark'), segs: $('bench-segs'), rec: $('bench-rec'),
    };
    const setPhase = (phase) => { overlay.dataset.phase = phase; };

    function setOverlay({ scene, fps, ms, elapsed, score, progress }) {
        if (scene !== undefined) ui.scene.textContent = scene;
        if (fps !== undefined) ui.fps.textContent = fps;
        if (ms !== undefined) ui.ms.textContent = ms;
        if (elapsed !== undefined) ui.elapsed.textContent = elapsed;
        if (score !== undefined) ui.score.textContent = score;
        if (progress !== undefined) ui.progress.style.transform = `scaleX(${Math.min(1, progress).toFixed(4)})`;
    }

    // Five progress segments, one per scene.
    let segs = [];
    function buildSegments() {
        ui.segs.replaceChildren();
        segs = SCENES.map(() => {
            const seg = document.createElement('span');
            seg.className = 'bo-seg';
            const fill = document.createElement('i');
            seg.append(fill);
            ui.segs.append(seg);
            return { seg, fill };
        });
    }
    function startSegment(si) {
        segs.forEach((s, j) => {
            s.seg.classList.toggle('cur', j === si);
            if (j < si) s.fill.style.transform = 'scaleX(1)';
        });
    }
    const setSegment = (si, frac) => { if (segs[si]) segs[si].fill.style.transform = `scaleX(${frac.toFixed(4)})`; };

    // Frame-time sparkline (2D canvas, redrawn once per frame between benchFrame calls).
    const frameTimes = [];
    let sparkCtx = null;
    let sparkGrad = null;
    function sizeSpark() {
        const r = ui.spark.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.max(1, Math.round(r.width * dpr));
        const h = Math.max(1, Math.round(r.height * dpr));
        if (ui.spark.width !== w || ui.spark.height !== h) { ui.spark.width = w; ui.spark.height = h; }
        sparkCtx = ui.spark.getContext('2d');
        sparkGrad = sparkCtx.createLinearGradient(0, 0, 0, h);
        sparkGrad.addColorStop(0, 'rgba(168, 85, 247, 0.55)');
        sparkGrad.addColorStop(1, 'rgba(168, 85, 247, 0)');
        drawSpark();
    }
    function drawSpark() {
        if (!sparkCtx) return;
        const W = ui.spark.width, H = ui.spark.height;
        sparkCtx.clearRect(0, 0, W, H);
        const n = frameTimes.length;
        if (n < 2) return;
        let max = 0;
        for (const v of frameTimes) if (v > max) max = v;
        max = Math.max(max * 1.15, 1e-3);
        const pad = 2;
        const x = (i) => W * (SPARK_FRAMES - n + i) / (SPARK_FRAMES - 1);
        const y = (v) => H - pad - (v / max) * (H - 2 * pad);
        sparkCtx.beginPath();
        sparkCtx.moveTo(x(0), y(frameTimes[0]));
        for (let i = 1; i < n; i++) sparkCtx.lineTo(x(i), y(frameTimes[i]));
        sparkCtx.lineJoin = 'round';
        sparkCtx.lineWidth = Math.max(1.5, H / 22);
        sparkCtx.strokeStyle = '#d8b4fe';
        sparkCtx.stroke();
        sparkCtx.lineTo(x(n - 1), H);
        sparkCtx.lineTo(x(0), H);
        sparkCtx.closePath();
        sparkCtx.fillStyle = sparkGrad;
        sparkCtx.fill();
    }

    // Scene title: slides in, holds, fades out over SCENE_TITLE_MS.
    let titleAnim = null;
    let titleTimer = 0;
    function hideSceneTitle() {
        titleAnim?.cancel();
        titleAnim = null;
        clearTimeout(titleTimer);
        $('bench-scene-title').classList.remove('show');
    }
    function showSceneTitle(kicker, name) {
        const el = $('bench-scene-title');
        $('bench-title-kicker').textContent = kicker;
        $('bench-title-name').textContent = name;
        hideSceneTitle();
        if (reducedMotion() || !el.animate) {
            el.classList.add('show');
            titleTimer = setTimeout(() => el.classList.remove('show'), SCENE_TITLE_MS);
            return;
        }
        titleAnim = el.animate([
            { opacity: 0, transform: 'translateX(-18px)', easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
            { opacity: 1, transform: 'none', offset: 0.22 },
            { opacity: 1, transform: 'none', offset: 0.72, easing: 'ease-in' },
            { opacity: 0, transform: 'translateX(10px)' },
        ], { duration: SCENE_TITLE_MS, fill: 'both' });
    }

    // Intro card: title, specs, 3-2-1 countdown, then the bars slide in.
    function pulse(n) {
        // A quiet "Starting in n…" line (the earlier big countdown read as a game splash).
        const count = $('bench-intro-count');
        count.textContent = t('bench.starting', { n });
        count.animate([
            { opacity: 0, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'none', offset: 0.2 },
            { opacity: 1, offset: 0.85 },
            { opacity: 0 },
        ], { duration: INTRO_BEAT_MS, easing: 'ease', fill: 'both' });
    }

    async function playIntro({ mode, w, h, engineLabel, gpuName }) {
        const intro = $('bench-intro');
        $('bench-intro-mode').textContent = `${modeName(mode)} · ${w}×${h} · ${engineLabel}`;
        $('bench-intro-gpu').textContent = prettyGpu(gpuName);
        $('bench-intro-count').textContent = '';
        intro.hidden = false;
        setPhase('intro');
        if (reducedMotion()) {
            await sleep(1200);
            checkAbort();
        } else {
            await sleep(INTRO_REVEAL_MS);
            checkAbort();
            for (const n of [3, 2, 1]) {
                pulse(n);
                await sleep(INTRO_BEAT_MS);
                checkAbort();
            }
        }
        setPhase('run');      // the card fades out while the bars slide in
        await sleep(reducedMotion() ? 0 : INTRO_FADE_MS);
        checkAbort();
        intro.hidden = true;  // gone before the first timed frame
    }

    // ---------------------------------------------------------- video capture

    /** Capture the visible engine canvas. Automatic mode: preserveDrawingBuffer is false. */
    function startRecording() {
        const canvas = $('cpu-canvas').hidden ? $('gl-canvas') : $('cpu-canvas');
        const stream = canvas.captureStream();
        const release = () => stream.getTracks().forEach((tr) => tr.stop());
        const mimeType = RECORD_MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
        let rec;
        try {
            rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: RECORD_BITRATE });
        } catch (err) { release(); throw err; }
        const chunks = [];
        let failed = false;
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onerror = () => { failed = true; };
        const stopped = new Promise((resolve) => { rec.onstop = resolve; });
        rec.start(1000);
        return {
            /** Stop and return the video Blob (null when nothing usable was recorded). */
            async finish() {
                if (rec.state !== 'inactive') rec.stop();
                await Promise.race([stopped, new Promise((r) => setTimeout(r, 8000))]);
                release();
                if (failed || !chunks.length) return null;
                return new Blob(chunks, { type: rec.mimeType || mimeType || 'video/webm' });
            },
            /** Stop and throw everything away (abort). */
            discard() {
                rec.ondataavailable = null; rec.onstop = null; rec.onerror = null;
                try { if (rec.state !== 'inactive') rec.stop(); } catch { /* already stopped */ }
                release();
            },
        };
    }

    // ---------------------------------------------------------- the run

    async function run(mode) {
        if (running) return;
        running = true;
        abortRequested = false;
        lastMode = mode;

        const eng = engine();
        const isGpu = eng === gpu;
        const cfg = MODES[mode][isGpu ? 'gpu' : 'cpu'];
        const { w, h, frames } = cfg;
        const engineLabel = isGpu ? 'GPU' : 'CPU';
        const wantRecord = recSupported && $('bench-record').checked;
        let recorder = null;

        app.benchmarking = true;
        document.body.classList.add('benchmarking');
        buildSegments();
        frameTimes.length = 0;
        sparkCtx = null;
        setOverlay({ scene: '', fps: '–', ms: '–', elapsed: '0.0 s', score: '–', progress: 0 });
        ui.chip.textContent = `${modeName(mode)} · ${w}×${h} · ${engineLabel}`;
        ui.rec.hidden = true;
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); requestAbort(); } };
        const onResize = () => sizeSpark();
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', onResize);

        try {
            await playIntro({ mode, w, h, engineLabel, gpuName: eng.gpuName });
            sizeSpark();

            // The stream must exist before the first frame is drawn.
            if (wantRecord) {
                try { recorder = startRecording(); } catch (err) { console.error(err); toast(t('bench.rec-failed'), 4000); }
            }
            ui.rec.hidden = !recorder;

            const scenes = [];
            let totalSeconds = 0;       // sum of benchFrame durations
            let totalPixels = 0;
            let elapsedMs = 0;          // timed time only (excludes preparation)
            const totalFrames = SCENES.length * frames;
            let framesDone = 0;

            for (let si = 0; si < SCENES.length; si++) {
                const scene = SCENES[si];
                const name = t('bench.scene.' + scene.id);
                const label = `${si + 1}/${SCENES.length} · ${name}`;
                setOverlay({ scene: label });
                startSegment(si);
                showSceneTitle(t('bench.scene-of', { n: si + 1, total: SCENES.length }), name);

                // Untimed preparation (deep scene: reference orbit).
                const ctx = { makeView, computeReference, getFractal, ref: undefined };
                if (scene.prepare) {
                    setOverlay({ scene: t('bench.preparing', { scene: name }) });
                    await nextFrame();
                    checkAbort();
                    ctx.ref = await scene.prepare(ctx);
                    checkAbort();
                    setOverlay({ scene: label });
                }

                setPaletteLut(scene.palette);
                let sceneMs = 0;
                const recent = [];      // rolling window of frame times (ms)

                for (let i = 0; i < frames; i++) {
                    checkAbort();
                    const s = frames > 1 ? i / (frames - 1) : 0;
                    const spec = makeSpec(scene.frame(s, ctx));
                    const ms = await eng.benchFrame(spec, w, h);

                    // ---- timed region ends here; everything below is untimed ----
                    sceneMs += ms;
                    elapsedMs += ms;
                    totalPixels += w * h;
                    framesDone++;
                    recent.push(ms);
                    if (recent.length > 10) recent.shift();
                    frameTimes.push(ms);
                    if (frameTimes.length > SPARK_FRAMES) frameTimes.shift();
                    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
                    setOverlay({
                        fps: (1000 / Math.max(avg, 0.001)).toFixed(1),
                        ms: ms.toFixed(ms < 10 ? 1 : 0) + ' ms',
                        elapsed: (elapsedMs / 1000).toFixed(1) + ' s',
                        // Same formula as the final score, applied to what has been rendered so far.
                        score: Math.round(totalPixels / Math.max(elapsedMs / 1000, 1e-9) / 10000).toLocaleString(),
                        progress: framesDone / totalFrames,
                    });
                    setSegment(si, (i + 1) / frames);
                    drawSpark();
                    // Let the browser present the frame; this wait is not timed.
                    await nextFrame();
                }

                const seconds = sceneMs / 1000;
                totalSeconds += seconds;
                scenes.push({ id: scene.id, frames, seconds, fps: frames / Math.max(seconds, 1e-9) });
            }

            const score = Math.round(totalPixels / Math.max(totalSeconds, 1e-9) / 10000);
            const result = {
                score, mode, engine: isGpu ? 'gpu' : 'cpu', gpu: eng.gpuName || '',
                w, h, frames, date: Date.now(), scenes,
            };
            // Personal best is judged against earlier runs with the same engine and mode.
            const same = loadHistory().filter((r) => r.engine === result.engine && r.mode === result.mode);
            const prevBest = same.length ? Math.max(...same.map((r) => r.score)) : null;
            saveHistory(result);

            // Finale hold (untimed): the last frame stays up under a "complete" title.
            setPhase('done');
            setOverlay({ scene: t('bench.complete') });
            showSceneTitle(t('bench.title'), t('bench.complete'));
            const rec = recorder;
            recorder = null;
            const [blob] = await Promise.all([rec ? rec.finish() : null, sleep(FINISH_HOLD_MS)]);
            if (rec && !blob) toast(t('bench.rec-failed'), 4000);
            return { result, prevBest, blob };
        } finally {
            recorder?.discard();
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('resize', onResize);
            hideSceneTitle();
            $('bench-intro').hidden = true;
            ui.rec.hidden = true;
            setPhase('');
            app.benchmarking = false;
            document.body.classList.remove('benchmarking');
            restore();
            running = false;
        }
    }

    /** Run, then show results (or a toast when aborted / failed). */
    async function start(mode) {
        if (running) return;
        if (dialog.open) dialog.close();
        revokeVideo();
        try {
            const { result, prevBest, blob } = await run(mode);
            setVideo(blob, result.score);
            showResults({
                run: result,
                best: Math.max(result.score, prevBest ?? 0),
                isPb: prevBest != null && result.score > prevBest,
            });
        } catch (err) {
            if (err instanceof Aborted) toast(t('bench.aborted'));
            else { console.error(err); toast(String(err?.message || err), 5000); }
        }
    }

    // ---------------------------------------------------------- summary text

    function summaryText(r) {
        const lines = [
            `Kaleidoscope benchmark — ${modeName(r.mode)}`,
            `${t('bench.score')}: ${r.score.toLocaleString()}`,
            `${t('bench.tier')}: ${tierName(r.score)}`,
            metaText(r),
            `${r.frames} frames/scene`,
            '',
            ...r.scenes.map(sc => `${t('bench.scene.' + sc.id)}: ${sc.fps.toFixed(1)} FPS, ${sc.seconds.toFixed(2)} s`),
        ];
        return lines.join('\n');
    }

    // ---------------------------------------------------------- wiring

    buildBurst();
    if (recSupported) {
        $('bench-record-row').hidden = false;
        $('bench-record').checked = loadRecordPref();
        $('bench-record').addEventListener('change', (e) => saveRecordPref(e.target.checked));
    }

    $('btn-benchmark').addEventListener('click', () => { if (!running) showStart(); });
    $('btn-bench-close').addEventListener('click', () => dialog.close());
    $('btn-bench-run').addEventListener('click', () => {
        const mode = document.querySelector('input[name=bench-mode]:checked')?.value === 'full' ? 'full' : 'quick';
        start(mode);
    });
    $('btn-bench-again').addEventListener('click', () => start(lastMode));
    $('btn-bench-abort').addEventListener('click', requestAbort);
    $('btn-bench-copy').addEventListener('click', async () => {
        if (!lastInfo) return;
        const text = summaryText(lastInfo.run);
        try {
            await navigator.clipboard.writeText(text);
            toast(t('toast.copied'));
        } catch (err) {
            toast(text, 6000);
        }
    });
    // Closing the dialog (Esc / button) returns to the start panel next time and frees the video.
    dialog.addEventListener('close', () => { cancelAnimationFrame(countAnim); revokeVideo(); });

    onLangChange(() => {
        if (!dialog.open) return;
        if ($('bench-results').classList.contains('hidden')) renderHistory();
        else if (lastInfo) { renderResults(lastInfo); showVideoButton(); }
    });
}
