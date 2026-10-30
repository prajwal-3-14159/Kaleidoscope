// CPU render worker: computes per-pixel fractal data rows with 64-bit maths.
import { iterateDirect, iteratePerturb, iterateSierpinski } from '../core/escape.js';

let current = 0;           // id of the job we should be working on
const orbits = new Map();  // refId -> { orbit, len0, len1 }

// Yield to the event loop quickly (lets a newer job pre-empt this one).
const chan = new MessageChannel();
const waiters = [];
chan.port1.onmessage = () => waiters.shift()?.();
const yieldNow = () => new Promise(r => { waiters.push(r); chan.port2.postMessage(0); });

self.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'orbit') {
        orbits.clear();
        orbits.set(m.refId, m);
        return;
    }
    if (m.type === 'job') {
        current = m.id;
        run(m);
    }
};

async function run(job) {
    const { id, w, h, rows, s } = job;
    const out = new Float64Array(4);
    const scratch = new Float64Array(10);
    const ref = s.mode === 'perturb' ? orbits.get(s.refId) : null;
    const crit = ref ? ref.orbit.subarray(ref.len0 * 2) : null;
    let batchRows = [];
    let batch = [];
    let t0 = performance.now();
    const flush = () => {
        if (!batchRows.length) return;
        const data = new Float32Array(batchRows.length * w * 4);
        batch.forEach((row, i) => data.set(row, i * w * 4));
        self.postMessage({ id, stage: job.stage, rows: batchRows, data }, [data.buffer]);
        batchRows = []; batch = [];
        t0 = performance.now();
    };
    for (const y of rows) {
        if (current !== id) return;
        const row = new Float32Array(w * 4);
        const py0 = (h / 2 - y - 0.5) * s.pxScale * s.ysign;
        for (let x = 0; x < w; x++) {
            const px = (x + 0.5 - w / 2) * s.pxScale;
            if (s.mode === 'direct') {
                iterateDirect(s.fold, s.power, s.julia, s.center[0] + px * s.pixel, s.center[1] + py0 * s.pixel,
                    s.juliaC[0], s.juliaC[1], s.maxIter, s.log2pixel, s.ysign, out, scratch);
            } else if (s.mode === 'perturb') {
                const dx = (px + s.refShift[0]) * s.pixel, dy = (py0 + s.refShift[1]) * s.pixel;
                iteratePerturb(s.fold, s.julia, dx, dy, ref.orbit, ref.len0, crit, ref.len1, s.maxIter, s.log2pixel, s.ysign, out, scratch);
            } else {
                iterateSierpinski(s.sier, px, py0, out);
            }
            row[x * 4] = out[0]; row[x * 4 + 1] = out[1]; row[x * 4 + 2] = out[2]; row[x * 4 + 3] = out[3];
        }
        batchRows.push(y);
        batch.push(row);
        if (performance.now() - t0 > 40) {
            flush();
            await yieldNow();
        }
    }
    flush();
    self.postMessage({ id, stage: job.stage, finished: true });
}
