// GPU ↔ CPU parity (median |Δμ| is 0; tails are chaotic boundary pixels): renders small grids with the WebGL2 shaders (float32, direct and
// perturbation) and compares escape counts pixel by pixel against the 64-bit CPU
// reference implementation in src/core/escape.js.
//
// Needs Chrome and playwright-core:  npm i -D playwright-core && npm run test:gpu
// (set CHROME_PATH if Chrome is not in the default macOS location).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pwPath = process.env.PLAYWRIGHT_CORE || 'playwright-core';
const { chromium } = await import(pwPath);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const CASES = [
    { name: 'mandelbrot home · direct', fractal: 'mandelbrot', x: '-0.65', y: '0', r: 1.2, maxIter: 500 },
    { name: 'mandelbrot seahorse · perturb', fractal: 'mandelbrot', x: '-0.7445398', y: '0.1217237', r: 0.01, maxIter: 1500, perturb: true },
    { name: 'mandelbrot 1e-9 · perturb', fractal: 'mandelbrot', x: '-0.743643887037158', y: '0.131825904205312', r: 1e-9, maxIter: 4000, perturb: true },
    { name: 'mandelbrot power 3 · direct', fractal: 'mandelbrot', x: '-0.2', y: '0', r: 1.3, maxIter: 300, power: 3 },
    { name: 'mandelbrot power 2.5 · direct', fractal: 'mandelbrot', x: '-0.3', y: '0', r: 1.3, maxIter: 300, power: 2.5 },
    { name: 'burning ship home · direct', fractal: 'burning-ship', x: '-0.4', y: '-0.55', r: 1.3, maxIter: 500 },
    { name: 'burning ship mini · perturb', fractal: 'burning-ship', x: '-1.7548776662466927', y: '0', r: 0.02, maxIter: 1500, perturb: true },
    { name: 'tricorn · perturb', fractal: 'tricorn', x: '-0.25', y: '0', r: 1.5, maxIter: 500, perturb: true },
    { name: 'celtic · perturb', fractal: 'celtic', x: '-0.45', y: '0', r: 1.3, maxIter: 500, perturb: true },
    { name: 'buffalo · perturb', fractal: 'buffalo', x: '-0.5', y: '0.35', r: 1.35, maxIter: 500, perturb: true },
    { name: 'buffalo home · direct', fractal: 'buffalo', x: '-0.5', y: '0.35', r: 1.35, maxIter: 500 },
    { name: 'julia · direct', fractal: 'mandelbrot', julia: true, juliaC: [-0.8, 0.156], x: '0', y: '0', r: 1.2, maxIter: 800 },
    { name: 'julia · perturb', fractal: 'mandelbrot', julia: true, juliaC: [-0.8, 0.156], x: '0.1', y: '0.05', r: 0.3, maxIter: 800, perturb: true },
    { name: 'burning ship julia · perturb', fractal: 'burning-ship', julia: true, juliaC: [-1.62, -0.02], x: '0', y: '0', r: 1.3, maxIter: 500, perturb: true },
    { name: 'sierpinski home', fractal: 'sierpinski', x: '0.5', y: '0.4330127018922193', r: 0.5 },
    { name: 'sierpinski 1e-40', fractal: 'sierpinski', x: '0.2857142857142857142857142857142857142857142857142857', y: '0.2474358296526967562182066202151246238489721791157686', r: 1e-40 },
];

const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
let failed = 0;
try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.kaleidoscope?.gpu?.set, null, { timeout: 30000 });
    const results = await page.evaluate(async (cases) => {
        const k = window.kaleidoscope;
        const esc = await import('/src/core/escape.js');
        const { computeReferenceOnce } = await import('/src/deep.js');
        const { getFractal } = await import('/src/core/fractals.js');
        k.app.benchmarking = true; // pause the live loop
        const W = 96, H = 64, out = new Float64Array(4);
        const res = [];
        for (const c of cases) {
            const f = getFractal(c.fractal);
            const view = k.V.makeView(c.x, c.y, Math.log2(c.r));
            const p = { fractal: f.id, julia: !!c.julia, juliaC: c.juliaC, power: c.power ?? 2, maxIter: c.maxIter ?? 100, view };
            if (c.perturb) p.ref = await computeReferenceOnce({ fractal: f, julia: !!c.julia, juliaC: c.juliaC || [0, 0], view, maxIter: p.maxIter });
            const spec = k.makeSpec(p);
            if (f.kind === 'geometric') { spec.mode = 'sierpinski'; spec.sier = esc.sierpinskiFrame(view.cx, view.cy, view.bits, spec.log2pixel); }
            const gpu = k.gpu.readData(spec, W, H);
            const pxScale = k.gpu.set.w / W;
            const [cx, cy] = k.V.centerNumbers(view);
            let bad = 0, both = 0, cls = 0; const diffs = [];
            for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
                const px = (i + 0.5 - W / 2) * pxScale, py = (j + 0.5 - H / 2) * pxScale * spec.ysign;
                if (spec.mode === 'sierpinski') esc.iterateSierpinski(spec.sier, px, py, out);
                else esc.iterateDirect(f.fold, spec.power, spec.julia, cx + px * spec.pixel, cy + py * spec.pixel,
                    spec.juliaC[0], spec.juliaC[1], spec.maxIter, spec.log2pixel, spec.ysign, out);
                const g = gpu[(j * W + i) * 4];
                // Disagreement = different fate, or a whole-iteration difference in escape time.
                const mismatch = (g < 0) !== (out[0] < 0) || (g >= 0 && Math.abs(g - out[0]) > 1);
                if (mismatch) bad++;
                if ((g < 0) !== (out[0] < 0)) cls++;
                if (g >= 0 && out[0] >= 0) { both++; diffs.push(Math.abs(g - out[0])); }
            }
            diffs.sort((a, b) => a - b);
            const q = (x) => diffs.length ? diffs[Math.min(diffs.length - 1, Math.floor(x * diffs.length))] : 0;
            res.push({ name: c.name, mode: spec.mode, bad: bad / (W * H), escaped: both / (W * H), cls: cls / (W * H), p50: q(0.5), p90: q(0.9), p99: q(0.99) });
        }
        k.app.benchmarking = false;
        return res;
    }, CASES);
    for (const r of results) {
        // Chaotic boundary pixels legitimately differ between float32 (GPU) and float64
        // (CPU); perturbation deltas have a 24-bit mantissa, so allow it more drift.
        const limit = r.mode === 'perturb' ? 0.10 : 0.04;
        const ok = r.bad <= limit && r.cls <= 0.01 && (r.escaped > 0.05 || r.name.startsWith('sierpinski'));
        if (!ok) failed++;
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(34)} ${r.mode.padEnd(10)} mismatch ${(r.bad * 100).toFixed(2)}%  escaped ${(r.escaped * 100).toFixed(0)}%  class ${(r.cls * 100).toFixed(2)}%  |Δμ| p50 ${r.p50.toFixed(3)} p90 ${r.p90.toFixed(3)} p99 ${r.p99.toFixed(2)}`);
    }
} finally {
    await browser.close();
    server.close();
}
process.exit(failed ? 1 : 0);
