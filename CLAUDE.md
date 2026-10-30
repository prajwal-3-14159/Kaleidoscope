# Kaleidoscope — notes for Claude

Static WebGL2 fractal explorer. No build step, native ES modules, deployed as-is to Azure Static Web Apps (`staticwebapp.config.json`, workflow in `.github/`). Read this file instead of exploring; open only the files a task touches.

## Commands
- Serve: `python3 -m http.server 8080` (must be http, not file://)
- Math tests: `npm test` (node --test, 22 tests, ~0.5 s)
- GPU↔CPU parity: `npm run test:gpu` (needs `npm i -D playwright-core` + Chrome; set `PLAYWRIGHT_CORE` to a path if installed elsewhere)
- Headless Chrome on macOS needs `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`; use `waitUntil: 'commit'` (Google Fonts can delay `load`).
- Debug handle in page: `window.kaleidoscope` = `{ app, state, gpu, refs, V, makeSpec, view (get/set), goTour(id), setEngine('gpu'|'cpu'), buildSpec, lastProbe }`.

## Map (src/)
| File | Role |
|---|---|
| `main.js` | State, render loop (`tick`), `buildSpec`, view ops, adaptive iterations (`adaptIterations`), URL hash, export, thumbnails, UI bindings (`buildControls`/`syncControls`) |
| `core/fractals.js` | Fractal table. Escape-time = `post(pow(pre(z),p)) + c` via `fold` flags; `BAIL2=65536` |
| `core/escape.js` | CPU reference maths: `iterateDirect`, `iteratePerturb` (rebasing), `referenceOrbit` (BigInt), Sierpiński frame/iterate |
| `core/bigfixed.js` | BigInt fixed point (value = n / 2^bits) |
| `core/palettes.js` / `core/colorize.js` | OKLab LUTs; CPU colouring (mirror of GLSL `COLORIZE`) |
| `gl/shaders.js` | GLSL: compute (modes `direct`/`perturb`/`sierpinski`, `#define`s per fractal), `COLORIZE`, `PRESENT`, `BLIT` |
| `gl/renderer.js` | `GpuRenderer`: job = passes (preview, full sample 0..aa-1) run in row bands under an adaptive budget (fences); snapshot+reprojection; PiP; `renderImage` (tiled export); `benchFrame`; `probe`/`readData` |
| `cpu/cpu-engine.js` + `workers/cpu-worker.js` | Same interface as GpuRenderer, 64-bit, worker pool, rows interleaved |
| `deep.js` + `workers/ref-worker.js` | `ReferenceManager` (reuse ref until too far/imprecise), `computeReferenceOnce` |
| `view.js` | View = `{cx, cy: BigInt, bits, log2r}` (log2 half-height). Pixel offsets are y-up; `ysign` flips for Burning Ship |
| `input.js`, `tour.js`, `benchmark.js`, `i18n.js` | Input; tour stops + `makeFlight`; benchmark (5 fixed scenes, score = 100 per Mpx/s); EN/JA strings |
| `index.html`, `styles.css` | UI shell; ids are a contract used by main.js/benchmark.js |

## Invariants / gotchas (each cost real debugging time)
- GLSL compute and `core/escape.js` must stay in sync; GLSL `COLORIZE` and `core/colorize.js` too. Run both test suites after maths changes.
- Per-pixel data = `(mu, log2 DE in px, normal angle, extra)`; `mu < 0` = interior.
- Mandelbrot-type iteration starts at n=1, z=c (perturb: m=1, δ=δc); Julia starts at n=0.
- GPU switches to perturbation below `log2pixel < -19` (CPU: -46). Perturbation only for power 2; other powers clamp zoom (`minLog2r`).
- WebGL: a texture bound to any unit a program samples must never be the render target. New textures are bound on scratch unit 7 (`_scratch()`); compute always binds the orbit texture to unit 0.
- `Math.LOG10_2` does not exist (use `Math.log10(2)`). A NaN cost made the band loop spin forever: keep the `rowCost` guard.
- `bf.mulPow2` must guard non-finite exponents (infinite loop otherwise).
- Auto iterations: base(zoom) × `app.iterBoost`; the probe doubles only when unescaped pixels AND late escapes coexist (max-mu alone escalates forever near boundaries).
- Float32 perturbation differs from float64 on chaotic boundary pixels (parity test allows ≤10%); median agreement is exact.
- `spec.mode === 'wait'` = reference orbit pending; engines just reproject the old frame.
- Every new UI string needs `en` and `ja` entries in `src/i18n.js`.

## Context hygiene
- No `.claudeignore` exists in Claude Code. Search respects `.gitignore`, and `.claude/settings.json` denies reading `node_modules/`, `package-lock.json` and PNGs.
- Prefer `grep -n` and `sed -n 'a,bp'` on the file you need over whole-file reads (`main.js` and `renderer.js` are large).

## Conventions
- Commit messages end with the Co-Authored-By line from the session instructions. Do not commit scratch files.
- Keep comments short and useful; no build tooling or frameworks.
- `PLAN.md` = roadmap/decisions (historical bug list refers to the pre-rewrite code).
