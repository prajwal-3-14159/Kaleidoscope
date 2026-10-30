// Benchmark: renders a fixed, deterministic set of animated scenes at a fixed
// resolution and reports pixels-per-second as a score (100 points = 1 Mpx/s).
//
// Only the duration returned by engine.benchFrame() is counted. Time spent
// waiting for requestAnimationFrame, preparing reference orbits, or updating
// the overlay never contributes, so the score reflects rendering throughput.

import { t, onLangChange } from './i18n.js';

const HISTORY_KEY = 'kaleidoscope.bench.v2';
const HISTORY_MAX = 10;

// GPU runs use a fixed resolution per mode; the CPU engine is far slower so it
// gets a small frame and fewer frames (recorded in the result).
const MODES = {
    quick: { gpu: { w: 1280, h: 720, frames: 40 }, cpu: { w: 480, h: 270, frames: 8 } },
    full: { gpu: { w: 1920, h: 1080, frames: 120 }, cpu: { w: 480, h: 270, frames: 20 } },
};

// ------------------------------------------------------------------ scenes
// Each scene's frame(s, ctx) maps progress s in [0, 1] to a makeSpec() argument.

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
            return { fractal: 'mandelbrot', maxIter: 600, shading: 'relief', view: makeView(p.x, p.y, p.log2) };
        },
    },
    {
        id: 'julia',
        palette: 'aurora',
        frame(s, { makeView }) {
            const a = 2 * Math.PI * s;
            return {
                fractal: 'mandelbrot', julia: true, juliaC: [0.7885 * Math.cos(a), 0.7885 * Math.sin(a)],
                maxIter: 400, shading: 'filaments', view: makeView(0, 0, Math.log2(1.25)),
            };
        },
    },
    {
        id: 'ship',
        palette: 'fire',
        frame(s, { makeView }) {
            const p = zoomPath({ x: -0.45, y: -0.55, r: 1.2 }, { x: -1.7612, y: -0.0293, r: 0.03 }, s);
            return { fractal: 'burning-ship', maxIter: 500, shading: 'relief', view: makeView(p.x, p.y, p.log2) };
        },
    },
    {
        id: 'power',
        palette: 'neon',
        frame(s, { makeView }) {
            const power = +(2 + 4 * Math.sin(Math.PI * s) ** 2).toFixed(2);
            return { fractal: 'mandelbrot', power, maxIter: 300, shading: 'flat', view: makeView(-0.3, 0, Math.log2(1.4)) };
        },
    },
    {
        id: 'deep',
        palette: 'ocean',
        DEEP_X: '-0.743643887037158704752191506114774',
        DEEP_Y: '0.131825904205311970493132056385139',
        MAX_ITER: 6000,
        LOG2_START: Math.log2(1e-6),
        LOG2_END: Math.log2(1e-30),
        /** Untimed set-up: one reference orbit, computed for the deepest view. */
        async prepare({ makeView, computeReference, getFractal }) {
            const view = makeView(this.DEEP_X, this.DEEP_Y, this.LOG2_END);
            return computeReference({ fractal: getFractal('mandelbrot'), julia: false, juliaC: [0, 0], view, maxIter: this.MAX_ITER });
        },
        frame(s, { makeView, ref }) {
            const view = makeView(this.DEEP_X, this.DEEP_Y, lerp(this.LOG2_START, this.LOG2_END, s));
            return { fractal: 'mandelbrot', maxIter: this.MAX_ITER, shading: 'relief', view, ref };
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

// ------------------------------------------------------------------ module

export function initBenchmark(app, deps) {
    const { engine, gpu, makeSpec, computeReference, setPaletteLut, makeView, getFractal, toast, restore } = deps;
    const $ = (id) => document.getElementById(id);
    const dialog = $('bench-dialog');
    const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let running = false;
    let abortRequested = false;
    let lastMode = 'quick';
    let lastRun = null;      // the run currently shown in the results panel
    let countAnim = 0;       // requestAnimationFrame id of the score count-up

    // ---------------------------------------------------------- formatting

    const fmtDate = (ts) => new Date(ts).toLocaleString(document.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const modeName = (mode) => t(mode === 'full' ? 'bench.full' : 'bench.quick');
    const engineName = (run) => (run.engine === 'gpu' ? 'GPU' : 'CPU');
    const resName = (run) => `${run.w}×${run.h}`;
    const metaText = (run) => `${modeName(run.mode)} · ${t('bench.meta', { engine: engineName(run), res: resName(run), gpu: run.gpu || '—', date: fmtDate(run.date) })}`;

    // ---------------------------------------------------------- dialog views

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
            info.textContent = ` ${modeName(run.mode)} · ${engineName(run)} · ${run.gpu || '—'} · ${fmtDate(run.date)}`;
            li.append(score, info);
            ul.append(li);
        }
    }

    function renderResultsText(run) {
        const body = $('bench-table');
        body.replaceChildren();
        for (const sc of run.scenes) {
            const tr = document.createElement('tr');
            for (const text of [t('bench.scene.' + sc.id), sc.fps.toFixed(1), sc.seconds.toFixed(2) + ' s']) {
                const td = document.createElement('td');
                td.textContent = text;
                tr.append(td);
            }
            body.append(tr);
        }
        $('bench-meta').textContent = metaText(run);
    }

    function countUp(target) {
        cancelAnimationFrame(countAnim);
        const el = $('bench-score');
        if (reducedMotion()) { el.textContent = target.toLocaleString(); return; }
        const dur = 800, t0 = performance.now();
        const step = (now) => {
            const k = Math.min(1, (now - t0) / dur);
            const eased = 1 - (1 - k) ** 3;
            el.textContent = Math.round(target * eased).toLocaleString();
            if (k < 1) countAnim = requestAnimationFrame(step);
        };
        countAnim = requestAnimationFrame(step);
    }

    function showStart() {
        $('bench-start').classList.remove('hidden');
        $('bench-results').classList.add('hidden');
        renderHistory();
        if (!dialog.open) dialog.showModal();
    }

    function showResults(run) {
        lastRun = run;
        $('bench-start').classList.add('hidden');
        $('bench-results').classList.remove('hidden');
        renderResultsText(run);
        if (!dialog.open) dialog.showModal();
        $('bench-score').textContent = '0';
        countUp(run.score);
    }

    // ---------------------------------------------------------- overlay

    function setOverlay({ scene, fps, elapsed, progress }) {
        if (scene !== undefined) $('bench-scene').textContent = scene;
        if (fps !== undefined) $('bench-fps').textContent = fps;
        if (elapsed !== undefined) $('bench-elapsed').textContent = elapsed;
        if (progress !== undefined) $('bench-progress-bar').style.width = (progress * 100).toFixed(1) + '%';
    }

    const nextFrame = () => new Promise(requestAnimationFrame);

    // ---------------------------------------------------------- the run

    class Aborted extends Error {}

    async function run(mode) {
        if (running) return;
        running = true;
        abortRequested = false;
        lastMode = mode;

        const eng = engine();
        const isGpu = eng === gpu;
        const cfg = MODES[mode][isGpu ? 'gpu' : 'cpu'];
        const { w, h, frames } = cfg;
        const checkAbort = () => { if (abortRequested) throw new Aborted(); };

        app.benchmarking = true;
        document.body.classList.add('benchmarking');
        setOverlay({ scene: '', fps: '–', elapsed: '0.0 s', progress: 0 });
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); abortRequested = true; } };
        window.addEventListener('keydown', onKey, true);

        try {
            const scenes = [];
            let totalSeconds = 0;       // sum of benchFrame durations
            let totalPixels = 0;
            let elapsedMs = 0;          // timed time only (excludes preparation)
            const totalFrames = SCENES.length * frames;
            let framesDone = 0;

            for (let si = 0; si < SCENES.length; si++) {
                const scene = SCENES[si];
                const name = t('bench.scene.' + scene.id);
                const label = `${name} ${si + 1}/${SCENES.length}`;
                setOverlay({ scene: label });

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

                    sceneMs += ms;
                    elapsedMs += ms;
                    totalPixels += w * h;
                    framesDone++;
                    recent.push(ms);
                    if (recent.length > 10) recent.shift();
                    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
                    setOverlay({
                        fps: (1000 / Math.max(avg, 0.001)).toFixed(1),
                        elapsed: (elapsedMs / 1000).toFixed(1) + ' s',
                        progress: framesDone / totalFrames,
                    });
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
            saveHistory(result);
            return result;
        } finally {
            window.removeEventListener('keydown', onKey, true);
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
        try {
            const result = await run(mode);
            showResults(result);
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
            metaText(r),
            `${r.frames} frames/scene`,
            '',
            ...r.scenes.map(sc => `${t('bench.scene.' + sc.id)}: ${sc.fps.toFixed(1)} FPS, ${sc.seconds.toFixed(2)} s`),
        ];
        return lines.join('\n');
    }

    // ---------------------------------------------------------- wiring

    $('btn-benchmark').addEventListener('click', () => { if (!running) showStart(); });
    $('btn-bench-close').addEventListener('click', () => dialog.close());
    $('btn-bench-run').addEventListener('click', () => {
        const mode = document.querySelector('input[name=bench-mode]:checked')?.value === 'full' ? 'full' : 'quick';
        start(mode);
    });
    $('btn-bench-again').addEventListener('click', () => start(lastMode));
    $('btn-bench-abort').addEventListener('click', () => { abortRequested = true; });
    $('btn-bench-copy').addEventListener('click', async () => {
        if (!lastRun) return;
        try {
            await navigator.clipboard.writeText(summaryText(lastRun));
            toast(t('toast.copied'));
        } catch (err) {
            toast(summaryText(lastRun), 6000);
        }
    });
    // Closing the dialog (Esc / button) returns to the start panel next time.
    dialog.addEventListener('close', () => cancelAnimationFrame(countAnim));

    onLangChange(() => {
        if (!dialog.open) return;
        if ($('bench-results').classList.contains('hidden')) renderHistory();
        else if (lastRun) renderResultsText(lastRun);
    });
}
