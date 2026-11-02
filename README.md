# Kaleidoscope

An interactive fractal explorer that runs entirely in the browser, with a bilingual (English / Japanese) interface and a small fractal encyclopedia. It is a static site: no build step, no backend, native ES modules. Rendering uses WebGL2, with an optional multi-threaded CPU engine built on Web Workers.

Live site: see `site.json` (set with `npm run set-origin -- https://your-domain`).

## Features

- **Fractals**: Mandelbrot, Burning Ship, Tricorn, Celtic and Buffalo, each with a Julia variant, plus the Sierpiński triangle.
- **Any power from 1.5 to 12.** Integer powers use exact repeated complex multiplication. Non-integer powers use the principal branch, so they show a branch-cut seam.
- **Colouring**: the original Kaleidoscope "Classic" mapping (palette swept once, relative to the iteration limit) plus three cyclic mappings (square root, logarithmic, linear) that do not depend on the limit; smooth (continuous) iteration counts; distance-estimate filaments; 3D relief lighting with an adjustable light angle; optional interior glow.
- **Palettes**: the four original palettes (Cyberpunk, Solarized Fire, Deep Ocean, Mono Slate) and four more, interpolated in OKLab, with density and offset controls and animated colour cycling.
- **Progressive rendering**: a fast preview while you move, then jittered sub-pixel samples accumulate for anti-aliasing (1x, 4x, 8x, 16x) once the view is idle.
- **Ultra-deep zoom to about 10^300** for power-2 escape-time fractals, using perturbation theory with rebasing and BigInt reference orbits.
- **Exact Sierpiński triangle** that can be zoomed indefinitely, using exact binary-digit arithmetic.
- **Two engines**: GPU (WebGL2 fragment shaders) and CPU (64-bit floats across a pool of Web Workers).
- **Live Julia preview**: hover over a Mandelbrot-family view to see the Julia set for that point; press `J` to open it full size.
- **Guided tour** of notable places, with animated flights between them.
- **Shareable links**: the full view is stored in the URL hash.
- **High-resolution PNG export** at 1x, 2x or 4x, rendered offscreen in tiles.
- **Benchmark mode**: a deterministic workload with a cinematic presentation (title card, countdown, scene cards, live FPS graph), a tiered score, history, and optional in-browser video recording of the run (MediaRecorder; nothing is uploaded).
- **Learn section**: a plain-language fractal encyclopedia (`/learn/`, `/ja/learn/`) with formulas in MathML and "open in explorer" links for every entry.
- **English and Japanese** throughout: the app (`/` and `/ja/`), the encyclopedia and the legal pages, with a language switch on every page.

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
| `Esc` | Close dialogs / stop the benchmark |

## Running locally

The app uses ES modules and module Web Workers, so it must be served over HTTP. Opening `index.html` via `file://` will not work.

```sh
python3 -m http.server 8080
# or
npx serve .
```

Then open http://localhost:8080 (Japanese: http://localhost:8080/ja/). A browser with WebGL2 and the `EXT_color_buffer_float` extension is needed for the GPU engine; the CPU engine does not need WebGL.

## Tests and checks

```sh
npm test          # maths tests (node --test, no dependencies)
npm run check     # site checks: script syntax, i18n parity, shell sync, links, sitemap, manifest
npm run test:gpu  # GPU ↔ CPU parity in headless Chrome (needs `npm i -D playwright-core` and Chrome)
```

`npm run check` is what CI runs before every deploy. It fails on broken internal links, missing hreflang pairs, JSON-LD that does not parse, i18n keys present in only one language, or a stale `ja/index.html`.

## Site structure

```
index.html              the app (English shell; source of truth for the markup)
ja/index.html           the app (Japanese shell) — generated, do not edit by hand
learn/, ja/learn/       fractal encyclopedia (static pages, MathML formulas)
about.html, privacy.html, terms.html (+ ja/)   about, privacy policy, terms and disclaimers
404.html                not-found page (bilingual)
styles.css, bench.css   app styling; benchmark presentation
pages.css, pages.js     shared styling/behaviour of the content pages
fonts/                  self-hosted Outfit and Space Grotesk (SIL OFL)
assets/                 favicon, PWA icons, Open Graph images, encyclopedia figures
robots.txt, sitemap.xml, site.webmanifest
staticwebapp.config.json  Azure Static Web Apps headers, caching, 404 and CSP
site.json               public origin used in canonical/hreflang/sitemap URLs
scripts/
  shell-meta.mjs        per-language <head> metadata and structured data for the app
  build-shell.mjs       writes that metadata into index.html and generates ja/index.html
  set-origin.mjs        changes the public origin everywhere (then rebuilds the shell)
  check-site.mjs        the site checks listed above
src/
  main.js               app state, UI wiring, render scheduling, URL hash, export
  view.js               BigInt view centre, zoom as log2, pan/zoom maths
  deep.js               reference-orbit manager (perturbation)
  input.js              pointer, wheel, pinch and keyboard input
  tour.js               tour locations and animated flights
  benchmark.js          benchmark runner, presentation, recording and results UI
  i18n.js               English / Japanese strings; language follows the URL path (/ja/)
  core/                 fractal table, reference maths, BigInt fixed point, palettes, CPU colouring
  gl/                   WebGL2 renderer and GLSL (mirrors core/escape.js and core/colorize.js)
  cpu/, workers/        Web Worker pool engine and the BigInt reference-orbit worker
tests/                  maths tests and the GPU parity test
```

### Editing the app shell

`index.html` is edited by hand. Its SEO metadata (title, description, canonical, hreflang, Open Graph, JSON-LD, the `<noscript>` text) and the whole of `ja/index.html` are produced by `node scripts/build-shell.mjs` from `scripts/shell-meta.mjs`. After editing `index.html` or the metadata, run the script and commit both files (`npm run check` fails if they are out of date).

### Languages

The app picks its language from the URL (`/ja/` is Japanese), then from the stored choice, then from the browser. Toggling the language in the app switches the strings in place and rewrites the path between `/` and `/ja/` without reloading. Content pages exist once per language with `hreflang` links between the pairs; the same `localStorage` key keeps the choice in sync across the app and the pages. Every UI string lives in `src/i18n.js` with an `en` and a `ja` entry.

## How it works

### Escape-time fractals

Every escape-time fractal is written in one form:

    z -> post(pow(pre(z), p)) + c

`pre` is an optional fold before the power (`|re|`, `|im|`, or complex conjugate), `pow` is the complex power `p`, and `post` is an optional fold after it (`|re|`, `±|im|`). Mandelbrot has no folds; Burning Ship folds both parts before squaring; Tricorn conjugates; Celtic folds the real part after; Buffalo does both. Mandelbrot-family views start at `z = c` and vary `c` per pixel; Julia views fix `c` and vary the start `z`. Iteration stops when `|z|^2 > 65536`.

### Smooth colouring

With escape radius R and final value z after n steps, the continuous count is

    mu = n - log_p( log|z|^2 / log R^2 )

Using the actual power `p` keeps bands continuous for every power. The cyclic mappings colour from `mu` alone; the Classic mapping uses `sqrt(mu / maxIter)` to sweep the palette once, as the first version of Kaleidoscope did (so it changes with the iteration limit).

### Distance estimation and relief

Each step also propagates the 2x2 Jacobian of the iteration. The distance estimate `|z| ln|z| / |J|` draws thin filaments that plain escape counts miss, and the gradient of the potential serves as a surface normal for Lambert and specular lighting in relief mode.

### Perturbation and rebasing

For deep zooms a single reference orbit is computed at the view centre with BigInt fixed-point arithmetic. Each pixel then iterates only its difference from that orbit, which is accurate in ordinary floats because the difference is tiny. When a pixel's orbit gets closer to 0 than to the reference, it is rebased, which removes the glitches of plain perturbation. Reference orbits are computed in a worker so the page stays responsive.

### Sierpiński triangle

A point in triangle coordinates `(u, v)` belongs to the gasket exactly when the binary digits of `u` and `v` are never both 1 at the same position. The first K digits are resolved with BigInt; the rest are iterated in floats, so the picture is exact at any depth.

The `learn/how-it-works.html` page explains all of this for a general audience.

## Deployment

Every push to `main` runs `.github/workflows/azure-static-web-apps-*.yml`: the `test` job runs `npm test` and `npm run check`, then the repository root is uploaded as-is to Azure Static Web Apps (`skip_app_build: true`). Pull requests get a preview environment that is removed when the PR closes.

`staticwebapp.config.json` sets long-lived caching for fonts and assets, `no-cache` for HTML/CSS/JS (files are not content-hashed), a custom `404.html`, MIME types for `.mjs`, `.webmanifest`, `.woff2` and `.webp`, 404s for repository files that are not part of the site, and a Content-Security-Policy that allows only same-origin scripts, styles, fonts, workers and media (plus `data:`/`blob:` images and `blob:` media for the benchmark recording).

Before the first deploy to a new domain, set the public origin so canonical links, hreflang alternates, Open Graph URLs and the sitemap point at the right host:

```sh
npm run set-origin -- https://your-domain.example
```

## Privacy

The site makes no third-party requests (fonts are self-hosted), sets no cookies and has no analytics. The language choice and benchmark history live in `localStorage` only. See `privacy.html`.
