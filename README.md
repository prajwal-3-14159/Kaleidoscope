# Kaleidoscope

An interactive fractal explorer that runs entirely in the browser. It is a static site: no build step, no backend, native ES modules. Rendering uses WebGL2, with an optional multi-threaded CPU engine built on Web Workers.

## Features

- **Fractals**: Mandelbrot, Burning Ship, Tricorn, Celtic and Buffalo, each with a Julia variant, plus the Sierpiński triangle.
- **Any power from 1.5 to 12.** Integer powers use exact repeated complex multiplication. Non-integer powers use the principal branch, so they show a branch-cut seam.
- **Colouring**: smooth (continuous) iteration count, distance-estimate filaments, and 3D relief lighting with an adjustable light angle. Interior glow is optional.
- **Palettes**: 8 palettes interpolated in OKLab, with density and offset controls and animated colour cycling.
- **Progressive rendering**: a fast preview while you move, then jittered sub-pixel samples accumulate for anti-aliasing (1x, 4x, 8x, 16x) once the view is idle.
- **Ultra-deep zoom to about 10^300** for power-2 escape-time fractals, using perturbation theory with rebasing and BigInt reference orbits. Deep views are computed relative to a high-precision reference orbit, so they stay correct beyond the limits of 32-bit and 64-bit floats.
- **Exact Sierpiński triangle** that can be zoomed indefinitely (to the same ~10^300 limit), using exact binary-digit arithmetic.
- **Two engines**: GPU (WebGL2 fragment shaders) and CPU ("Local Browser": 64-bit floats across a pool of Web Workers).
- **Live Julia preview**: hover over a Mandelbrot-family view to see the Julia set for that point in a picture-in-picture window. Press `J` to open it full size.
- **Guided tour** of notable places, with animated flights between them.
- **Shareable links**: the full view (fractal, centre, zoom, power, palette, shading, ...) is stored in the URL hash.
- **High-resolution PNG export** at 1x, 2x or 4x, rendered offscreen in tiles.
- **Deterministic benchmark** with fixed scenes and workload.
- **English and Japanese** UI.

Deep zoom limits depend on the case. Power 2 on either engine goes to about 10^300 through perturbation. Other powers use direct iteration and are limited by float precision (GPU 32-bit, CPU 64-bit); the app tells you when you reach that limit.

## Controls

| Input | Action |
|-------|--------|
| Drag | Pan (with inertia) |
| Mouse wheel / trackpad pinch / touch pinch | Zoom at the pointer |
| Double-click | Zoom in at the pointer (Shift: zoom out) |
| Arrow keys | Pan |
| `+` / `-` | Zoom in / out |
| `R` | Reset the view |
| `J` | Open the Julia set for the point under the pointer |
| `C` | Toggle colour cycling |
| `H` | Hide or show all UI |
| `F` | Fullscreen |
| `P` | Toggle the side panel |
| `?` | Help |
| `Esc` | Close dialogs |

## Running locally

The app uses ES modules and module Web Workers, so it must be served over HTTP. Opening `index.html` via `file://` will not work.

```sh
python3 -m http.server 8080
# or
npx serve .
```

Then open http://localhost:8080. A browser with WebGL2 and the `EXT_color_buffer_float` extension is needed for the GPU engine; the CPU engine does not need WebGL.

## Tests

```sh
npm test      # node --test tests/*.test.mjs
```

The tests run in plain Node with no dependencies. They cover the BigInt fixed-point arithmetic, known Mandelbrot and Julia points, smooth-count continuity, distance estimates, perturbation against direct iteration for every fractal (including Julia variants), reference orbits, and the Sierpiński rule at shallow and deep levels.

## How it works

### Escape-time fractals

Every escape-time fractal is written in one form:

    z -> post(pow(pre(z), p)) + c

`pre` is an optional fold before the power (`|re|`, `|im|`, or complex conjugate), `pow` is the complex power `p`, and `post` is an optional fold after it (`|re|`, `±|im|`). Mandelbrot has no folds; Burning Ship folds both parts before squaring; Tricorn conjugates; Celtic folds the real part after; Buffalo does both. Mandelbrot-family views start at `z = c` and vary `c` per pixel; Julia views fix `c` and vary the start `z`. Iteration stops when `|z|^2 > 65536`.

### Smooth colouring

With escape radius R and final value z after n steps, the continuous count is

    mu = n - log_p( log|z|^2 / log R^2 )

Using the actual power `p` (not a fixed `log 2`) keeps bands continuous for every power. Colour comes from `mu` through the palette, independent of the iteration limit.

### Distance estimation and relief

Each step also propagates the 2x2 Jacobian of the iteration (with respect to `c` for Mandelbrot-type views, `z0` for Julia). The distance estimate to the set is `|z| ln|z| / |J|`, which draws thin filaments that plain escape counts miss. The gradient of the potential `log|z|` is proportional to `J^T z`; its direction serves as a surface normal for Lambert and specular lighting in relief mode. The Jacobian is kept as mantissa plus exponent so it cannot overflow.

### Perturbation and rebasing

For deep zooms a single reference orbit `Z_n` is computed at the view centre with BigInt fixed-point arithmetic (precision grows with zoom). Each pixel then iterates only its difference `delta` from that orbit:

    delta' = 2 Z delta + delta^2 + delta_c

which is accurate in ordinary floats because `delta` is tiny (the GPU stores it as mantissa and exponent to go below the 32-bit range). The folded fractals use a cancellation-free `|c + d| - |c|` helper in place of plain subtraction. When a pixel's orbit gets closer to 0 than to the reference (or the reference runs out), the pixel is rebased: its delta becomes the full `z` and it restarts against the orbit at index 0. This removes the glitches that plain perturbation produces, so any reference point is valid and the current one is reused until it drifts too far. Reference orbits are computed in a worker so the page stays responsive.

### Sierpiński triangle

The equilateral gasket with vertices (0,0), (1,0), (1/2, sqrt(3)/2) is an affine image of the right-angled one, where a point `(u, v)` in [0,1)^2 belongs to the set exactly when the binary digits of `u` and `v` are never both 1 at the same position (Pascal's triangle mod 2). The first K digits are resolved with BigInt for the neighbouring cells; the remaining digits are iterated in floats. That makes the picture exact at any depth and self-similar, with the view repeating every few octaves.

## Project structure

```
index.html              page and UI markup
styles.css              styling
staticwebapp.config.json  Azure Static Web Apps headers, routes and CSP
src/
  main.js               app state, UI wiring, render scheduling, URL hash, export
  view.js               BigInt view centre, zoom as log2, pan/zoom maths
  deep.js               reference-orbit manager (perturbation)
  input.js              pointer, wheel, pinch and keyboard input
  tour.js               tour locations and animated flights
  benchmark.js          benchmark runner and UI
  i18n.js               English / Japanese strings
  core/
    fractals.js         fractal definitions (folds, home views, Julia constants)
    escape.js           reference maths: iteration, Jacobian, perturbation, Sierpiński
    bigfixed.js         BigInt fixed-point arithmetic
    palettes.js         OKLab palettes baked to lookup tables
    colorize.js         CPU colouring (twin of the GPU colorize shader)
  gl/
    renderer.js         WebGL2 pipeline: compute, colorize/accumulate, present
    shaders.js          GLSL sources mirroring core/escape.js
  cpu/cpu-engine.js     Web Worker pool engine
  workers/
    cpu-worker.js       CPU tile renderer
    ref-worker.js       BigInt reference-orbit worker
tests/math.test.mjs     Node tests for the maths
PLAN.md                 design notes and roadmap
```

`core/escape.js` is the reference implementation. The GLSL in `gl/shaders.js` and the CPU colouring in `core/colorize.js` mirror it and must be kept in sync.

## Deployment

The site is deployed to Azure Static Web Apps by `.github/workflows/azure-static-web-apps-*.yml` on every push to `main`. The workflow uploads the repository root as-is (`app_location: "/"`, `skip_app_build: true`), so there is nothing to build.

`staticwebapp.config.json` sets:

- `Cache-Control: no-cache` for HTML, JS and CSS (files are not content-hashed, so browsers revalidate rather than cache blindly);
- JavaScript MIME types for `.js` and `.mjs`;
- `nosniff`, a strict referrer policy and a Content-Security-Policy that allows same-origin scripts and workers, Google Fonts, and `data:`/`blob:` images;
- 404 responses for repository files that are uploaded but not part of the app (`.github`, `tests`, `PLAN.md`, `package.json`);
- a navigation fallback to `/index.html` that excludes `/src/*` and static asset extensions.
