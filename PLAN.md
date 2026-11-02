# Kaleidoscope — Improvement Plan

> **Status (2026-11-03):** all phases below are implemented. This file is kept as the historical record of the rewrite (its bug list refers to the pre-rewrite code). Since then: original colour scheme restored (Classic mapping, original palettes), Learn encyclopedia (EN/JA), legal pages, SEO/PWA files, self-hosted fonts, cinematic benchmark with video recording (benchmark v3), CI test job, Japanese app shell. See `README.md` and `CLAUDE.md` for the current state.

Goal: a visually striking, easy-to-use, mathematically sound static WebGL fractal explorer with a meaningful benchmark mode. No build step; deploys as-is to Azure Static Web Apps.

## Current state (as of a64aa4a)

- `index.html` + `styles.css`: glass sidebar UI, left benchmark panel, score modal.
- `app.js`: WebGL1 fragment shader (all models compiled into one `if/else` chain), plus a single-threaded JS fallback renderer, pan/zoom, palettes, PNG export.
- `models/*.js`: per-fractal GLSL snippet + JS twin (Mandelbrot, Burning Ship, Tricorn, Celtic, Buffalo, "Sierpinski").
- `benchmark.js`: 6 × 30 s scripted scenes, score = frames × megapixels × 42.
- `i18n.js`: English / Japanese.

## Bugs found

| # | Where | Problem |
|---|-------|---------|
| B1 | `i18n.js` | Tricorn and Celtic names are swapped in the dropdown (`fractal-4` is Tricorn's id, labelled "Celtic"; `fractal-6` the reverse). |
| B2 | `benchmark.js` | Scene ids are wrong: scene 3 (`id 4`) renders Tricorn not Burning Ship; scene 4 (`id 12`) and scene 6 (`id 17`) point at models that don't exist and silently fall back to Mandelbrot; scene 5 (`id 8`) is Buffalo not Celtic. |
| B3 | `app.js` render queue | `nextRenderArgs` snapshots the whole state and `Object.assign`s it back later, which can revert newer changes made during a render (e.g. pan during render). |
| B4 | `app.js` WebGL path | Each render waits an extra `requestAnimationFrame`, then copies GL canvas → offscreen → visible canvas. Halves frame rate and caps the benchmark at ~30 fps. |
| B5 | Benchmark score | Measures display refresh (vsync-capped) not GPU throughput; uses the restored canvas size for every frame; the "×42" multiplier is arbitrary. Scores aren't comparable across machines/resolutions. |
| B6 | Benchmark end | Restores state then calls `resetFractalBounds()`, throwing away the user's view. |
| B7 | Julia controls | Initial state `c = -0.4 + 0.6i` but sliders show `-0.7 / 0.27`. |
| B8 | Power input | No bounds; power ≤ 1 or negative gives garbage and breaks smooth colouring. |
| B9 | Footer | Promises pinch-zoom; there are no touch/pointer handlers. |
| B10 | Copy | "Apple Silicon JIT" text, README (FastAPI/Numba) and `gemini.md` describe a backend that no longer exists. |
| B11 | Repo | `debug.js`, `debug.py`, `test.js`, `test_benchmark.js/.py` are scratch files with no real checks. |

## Mathematical soundness

| # | Problem | Fix |
|---|---------|-----|
| M1 | Smooth-iteration formula hardcodes `log 2`; only correct for power 2. | Use `nu = log(log|z| / log R) / log(n)` with the actual power `n`. |
| M2 | Colour = `sqrt(smoothIter / maxIter)`, so colours shift when you change max iterations, and deep zooms go flat. | Colour from smooth iteration count directly (log-scaled, cyclic palette with density and offset controls), independent of max iterations. |
| M3 | 32-bit float precision: image goes blocky at about 10⁵× zoom. The benchmark's own Mandelbrot scene zooms to 3·10⁵×. | Phase 1: double-float (df64) emulation in the shader → clean to about 10¹³×. Phase 2 (optional): perturbation theory with a CPU high-precision reference orbit → 10³⁰⁰×+. |
| M4 | "Sierpinski" isn't an escape-time fractal; GLSL (`mod` approximation) and JS (bitwise AND) compute different sets, and its "Julia" variant has no meaning. | Remove it from the escape-time family. If wanted, re-add as an exact pixel-space Sierpiński (WebGL2 integer `&`) in a separate "geometric" category with no Julia toggle. |
| M5 | Non-integer powers use `atan`, so they have a branch cut (a visible seam). That is correct maths but unexplained. | Integer powers via repeated complex multiplication (exact and faster); label non-integer powers "principal branch". Clamp to n ≥ 2 for Mandelbrot-family smoothing. |
| M6 | Escape radius is 100 (fine), but the JS and GL paths differ in edge handling (Sierpinski colouring, `modulusSq > 0` guard). | One shared spec, plus a test that compares JS reference pixels to GL `readPixels` output. |
| M7 | No anti-aliasing: hard aliasing at boundaries. | Progressive supersampling: accumulate jittered sub-pixel samples into a float buffer while the view is idle. |

Verification tests: known points (c = −1, c = 0, c = i are in the set; c = 1 escapes at iteration 3; c = 0.25 + ε escapes slowly), JS vs. GLSL pixel agreement, df64 vs. float64 reference along a deep-zoom path.

## Visual upgrades ("striking")

1. Full-bleed canvas: fractal fills the window; controls become a floating, collapsible glass panel (key `H` hides all UI for a clean view).
2. Better colour: cosine-gradient palettes (Inigo Quilez style) plus curated presets, palette offset and density sliders, and optional animated colour cycling.
3. Distance-estimation shading: thin-filament detail and a soft 3D-lit "relief" mode using the derivative `dz` (normal → Lambert + specular). This is the biggest visual jump.
4. Interior colouring: orbit-trap / period-based interior instead of flat black (optional).
5. Progressive refinement: instant preview while moving, sharpening to supersampled quality when idle.
6. Mandelbrot → Julia live link: hovering the Mandelbrot shows a picture-in-picture Julia for that `c`; click to jump into it.
7. Curated "Tour" bookmarks (Seahorse Valley, Elephant Valley, mini-brots, Burning Ship armada) with smooth animated flights between them. This doubles as benchmark content.
8. High-resolution export: render 2×/4×/8× offscreen in tiles, independent of screen size.

## Ease of use

- WebGL2 required (with a clear message if missing); drop the manual "Local Browser" engine toggle. Keep the JS renderer only as a hidden reference for tests.
- Smooth, inertial pan/zoom running every frame (no 150 ms debounce or stretched preview), pointer events with pinch on touch, double-click to zoom, keyboard (arrows, +/−, R reset, H hide UI, F fullscreen).
- URL hash holds the full view state (fractal, centre, zoom, palette, …), so any view can be shared or bookmarked.
- Auto iterations: scale max iterations with zoom depth, with a manual override.
- Fractal picker as a visual card grid with thumbnails; "Julia" as a toggle, not separate list entries.
- Show only relevant controls; tooltips explaining each parameter in one line.
- Responsive/mobile layout; respect `prefers-reduced-motion`.

## Benchmark redesign

- Deterministic workload: fixed internal resolution (e.g. 1920×1080 offscreen framebuffer, independent of window), fixed scene script, fixed iteration counts, fixed number of frames per scene, so every run does identical work.
- Measure GPU time, not vsync: render N frames back-to-back into an offscreen FBO with a `readPixels` sync per batch (or `EXT_disjoint_timer_query_webgl2` where available). Display stays vsync-limited; the measurement doesn't.
- Score = total iterations evaluated per second (or Mpixel·iter/s), shown with per-scene breakdown, GPU name (`WEBGL_debug_renderer_info`), resolution, and precision mode.
- Quick (≈30 s) and Full (≈2 min) runs; history of past runs in `localStorage`; shareable result card (PNG).
- Scenes reuse the Tour: deep Mandelbrot zoom (df64), Julia morph, Burning Ship zoom, power morph, DE-shaded relief.

## Code structure

```
index.html
styles.css
src/
  main.js          bootstrap, state store (single source of truth, dirty flag + rAF loop)
  renderer.js      WebGL2 setup, programs, FBOs, uniform cache, accumulation
  shaders/         GLSL as JS template strings: common, df64, coloring, per-model iterate()
  models/          per-fractal: id, names, default view, GLSL iterate, JS reference
  palettes.js
  input.js         pointer/wheel/keyboard/pinch
  ui.js            panel binding, i18n application
  url-state.js
  benchmark/       scenes.js, runner.js, results-ui.js
  i18n.js
tests/             math unit tests (node), GL-vs-JS pixel test (Playwright)
```

- Models keyed by string id (`"mandelbrot"`), so there are no `id*2+1` arithmetic bugs.
- One generated shader per (model, julia, precision) combination, compiled lazily and cached, instead of one giant branchy shader. That is faster on the GPU.
- Still no bundler: native ES modules, deploys unchanged on Azure.

## Phased roadmap

| Phase | Scope | Outcome |
|-------|-------|---------|
| 0 | Cleanup: remove scratch files, rewrite README, delete `gemini.md` (or fold it into README), fix B1, B2, B7, B8, B10 | Correct labels and benchmark scenes; honest docs |
| 1 | Core refactor: state store + rAF loop, WebGL2 renderer drawing directly to the visible canvas, uniform cache, per-model shaders, string ids (fixes B3, B4) | Smooth 60/120 fps interaction |
| 2 | Maths: M1, M2, M4, M5, M6 plus test suite | Correct, consistent images |
| 3 | Deep zoom: df64 (M3); auto iterations | 10¹³× zoom |
| 4 | Visuals: full-bleed layout, cosine palettes, DE shading/relief, progressive AA (M7), Julia preview, hi-res export | "Striking" |
| 5 | UX: pointer/pinch/keyboard, URL state, card picker, Tour, mobile | Easy to use |
| 6 | Benchmark redesign (B5, B6) | Meaningful, comparable scores |
| 7 (optional) | Perturbation-theory ultra-deep zoom | 10³⁰⁰× zoom |

## Decisions (2026-10-31)

1. Sierpiński: keep, as an exact geometric fractal (no fake Julia variant).
2. "Local Browser" CPU engine: keep as a user option (moved to Web Workers so it doesn't freeze the page).
3. Ultra-deep zoom (perturbation theory): in scope.
4. Japanese translation: keep and maintain.
