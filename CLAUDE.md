# Kaleidoscope — notes for Claude

Static WebGL2 fractal explorer with a bilingual (EN/JA) content site around it. No build step, native ES modules, deployed as-is to Azure Static Web Apps (`staticwebapp.config.json`, workflow in `.github/`). Read this file instead of exploring; open only the files a task touches.

## Status (2026-11-03)
Plan phases 0–7 done (perturbation deep zoom included). This revision restored the original colour scheme (single violet accent, Cyberpunk/Fire/Ocean/Slate palettes, "Classic" iteration-relative mapping as default), added the Learn encyclopedia, legal pages, SEO/PWA files, self-hosted fonts, a cinematic benchmark with optional video recording, a CI test job, and the Japanese app shell.
- Verified: 22 math tests; GPU↔CPU parity 16/16 (`npm run test:gpu`); `npm run check` clean; EN+JA app shells and language toggle (path sync) in headless Chrome; quick benchmark incl. recording (mp4) on Apple M5: ~1,450–1,480 (benchmark v3); deep tour stop renders (was black before the probe fix); mobile layout screenshots.
- NOT verified: real touch devices, Safari/Firefox MediaRecorder paths, full-mode benchmark, Japanese text by a native speaker, legal text by a lawyer.
- Owner TODOs: run `npm run set-origin -- https://<domain>` when a custom domain exists (live default: https://yellow-wave-04cc1c20f.7.azurestaticapps.net); fill the `TODO(owner)` comments in privacy/terms (legal name, governing law); add a LICENSE if the code should be open source.

## Commands
- Serve: `python3 -m http.server 8080` (must be http, not file://). JA shell at `/ja/`.
- Math tests: `npm test` (node --test, 22 tests, ~0.5 s)
- Site checks: `npm run check` (`scripts/check-site.mjs`: syntax, i18n key parity, shell sync, links, hreflang, JSON-LD, sitemap, manifest). CI runs this before deploying.
- Shell: `npm run build:shell` after editing `index.html` or `scripts/shell-meta.mjs` (regenerates the `<head>` metadata and `ja/index.html`). Never edit `ja/index.html` by hand.
- Origin: `npm run set-origin -- https://domain` rewrites canonical/hreflang/OG/sitemap URLs everywhere (`site.json` holds the current one).
- GPU↔CPU parity: `npm run test:gpu` (needs `npm i -D playwright-core` + Chrome; set `PLAYWRIGHT_CORE` to a path if installed elsewhere)
- Headless Chrome on macOS needs `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`; use `waitUntil: 'commit'`. Scratch scripts outside the repo must import playwright-core via `createRequire('<repo>/package.json')`.
- Debug handle in page: `window.kaleidoscope` = `{ app, state, gpu, refs, V, makeSpec, view (get/set), goTour(id), setEngine('gpu'|'cpu'), setPalette(id), buildSpec, lastProbe }`.

## Map
| File | Role |
|---|---|
| `index.html` / `ja/index.html` | App shell (EN source of truth / generated JA copy). Root-absolute asset paths. ids are a contract used by main.js/benchmark.js |
| `styles.css`, `bench.css` | App UI; benchmark presentation (classes `bo-*`, `bench-*`) |
| `pages.css`, `pages.js` | Shared look/behaviour of the content pages |
| `learn/`, `ja/learn/` | Encyclopedia (10 pages per language, MathML formulas, explore deep links `/#f=…&x=…&y=…&z=…&pal=…&sh=…`) |
| `about/privacy/terms.html` (+`ja/`), `404.html` | Legal/about pages (written by a subagent; TODO(owner) comments inside) |
| `assets/` | `favicon.svg`, `icons/` (PWA), `og/*.jpg` (1200×630), `learn/*.webp` (1200×675 figures) |
| `fonts/` | Self-hosted Outfit + Space Grotesk (variable, latin/latin-ext) + OFL texts |
| `scripts/` | `shell-meta.mjs` (per-language head metadata + JSON-LD), `build-shell.mjs`, `set-origin.mjs`, `check-site.mjs` |
| `src/main.js` | State, render loop (`tick`), `buildSpec`, view ops, adaptive iterations (`adaptIterations`), URL hash, export, thumbnails, UI bindings |
| `src/core/fractals.js` | Fractal table. Escape-time = `post(pow(pre(z),p)) + c` via `fold` flags; `BAIL2=65536` |
| `src/core/escape.js` | CPU reference maths: `iterateDirect`, `iteratePerturb` (rebasing), `referenceOrbit` (BigInt), Sierpiński |
| `src/core/palettes.js` / `colorize.js` | OKLab LUTs (`stops` + optional `wrap` stop; `paletteSpan`); CPU colouring (mirror of GLSL `COLORIZE`); `MAPPINGS` incl. `relative` (Classic) |
| `src/gl/shaders.js`, `renderer.js` | GLSL compute/`COLORIZE`/`PRESENT`/`BLIT`; `GpuRenderer` (bands, fences, snapshot, PiP, `renderImage`, `benchFrame`, `probe`) |
| `src/cpu/cpu-engine.js` + `workers/` | Same interface, 64-bit worker pool |
| `src/deep.js` | `ReferenceManager`, `computeReferenceOnce` |
| `src/view.js` | View = `{cx, cy: BigInt, bits, log2r}`; `ysign` flips for Burning Ship |
| `src/benchmark.js` | 5 fixed scenes (palette, shading, mapping pinned), score = 100 per Mpx/s of `benchFrame` time, history `kaleidoscope.bench.v3`, intro/letterbox/HUD/finale, MediaRecorder capture of the engine canvas |
| `src/i18n.js` | EN/JA strings; language = URL path (`/ja/`) > stored > browser; `data-i18n`, `-title`, `-aria`, `-content`, `data-href-en/ja`; exports `DICTIONARIES` |
| `src/input.js`, `tour.js` | Input; tour stops (`mapping` optional) + `makeFlight` |

## Invariants / gotchas (each cost real debugging time)
- GLSL compute and `core/escape.js` must stay in sync; GLSL `COLORIZE` and `core/colorize.js` too (incl. `u_maxIter`/`u_span` for the Classic mapping). Run both test suites after maths changes.
- Per-pixel data = `(mu, log2 DE in px, normal angle, extra)`; `mu < 0` = interior.
- Classic mapping = `sqrt(mu/maxIter)` over the palette stops once: it depends on the iteration limit and goes flat at deep zoom (panel shows a hint past 10^6; deep tour stops and benchmark scenes pin a cyclic mapping).
- Mandelbrot-type iteration starts at n=1, z=c (perturb: m=1, δ=δc); Julia starts at n=0.
- GPU switches to perturbation below `log2pixel < -19` (CPU: -46). Perturbation only for power 2; other powers clamp zoom (`minLog2r`).
- WebGL: a texture bound to any unit a program samples must never be the render target. New textures bound on scratch unit 7; compute binds the orbit texture to unit 0. `preserveDrawingBuffer` is false: `readPixels` on the canvas after presentation returns zeros (use `renderImage`/screenshots to inspect output).
- `Math.LOG10_2` does not exist. A NaN cost made the band loop spin forever: keep the `rowCost` guard. `bf.mulPow2` must guard non-finite exponents.
- Auto iterations: base(zoom) × `app.iterBoost`; the probe doubles when unescaped and late escapes coexist, or (bounded to 8×) when nothing escaped at all (deep views otherwise stay black).
- Float32 perturbation differs from float64 on chaotic boundary pixels (parity allows ≤10%); median agreement is exact.
- `spec.mode === 'wait'` = reference orbit pending; engines just reproject the old frame.
- Every new UI string needs `en` and `ja` entries in `src/i18n.js` (`npm run check` fails otherwise). Benchmark strings are `bench.*`.
- CSP is `script-src 'self'`; no CDNs, no inline scripts (JSON-LD is allowed). Fonts are self-hosted; keep the privacy page true if that changes.
- Changing the benchmark workload changes scores: bump `HISTORY_KEY` and re-measure `REFERENCE_SCORE`.

## Context hygiene
- `.claude/settings.json` denies reading `node_modules/`, `package-lock.json` and PNGs (scratchpad PNGs outside the repo are fine).
- Prefer `grep -n` and `sed -n 'a,bp'` on the file you need over whole-file reads (`main.js`, `renderer.js`, `benchmark.js`, `styles.css` are large).

## Conventions
- Commit messages end with the Co-Authored-By line from the session instructions. Do not commit scratch files.
- Keep comments short and useful; no build tooling or frameworks (the shell generator and checks are plain Node scripts).
- Subagents: use Sonnet for self-contained pieces (UI, benchmark, docs, QA). Give each a file-ownership contract, unique scratch-file prefixes, and the headless Chrome flags.
- Colour: one violet accent (`--violet #a855f7`, `--violet-hi #d8b4fe`, `--violet-deep #7c3aed`); no cyan/pink gradients (the owner finds them generic).
- `PLAN.md` = historical roadmap/decisions (pre-rewrite bug list).
