// Fractal definitions.
//
// Every escape-time fractal here is z -> post(pow(pre(z), p)) + c, where
//   pre  = optional fold before the power (|x|, |y|, complex conjugate)
//   pow  = complex power p (integer powers use exact repeated multiplication)
//   post = optional fold after the power (|re|, ±|im|)
// Writing them this way gives one shared, exact implementation of the
// iteration, its Jacobian (for distance estimation and 3D lighting) and its
// perturbation-theory delta (for ultra-deep zoom).
//
// Sierpinski is a geometric (not escape-time) fractal and is handled separately.

export const FRACTALS = [
    {
        id: 'mandelbrot',
        kind: 'escape',
        fold: { preX: false, preY: false, conj: false, postRe: false, postIm: 0 },
        flipY: false,
        home: { x: -0.65, y: 0, hw: 1.75, hh: 1.2 },
        juliaHome: { x: 0, y: 0, hw: 1.7, hh: 1.15 },
        juliaC: [-0.8, 0.156],
    },
    {
        id: 'burning-ship',
        kind: 'escape',
        fold: { preX: true, preY: true, conj: false, postRe: false, postIm: 0 },
        // Conventionally drawn with the imaginary axis pointing down so the ship sits upright.
        flipY: true,
        home: { x: -0.4, y: -0.55, hw: 1.9, hh: 1.3 },
        juliaHome: { x: 0, y: 0, hw: 1.9, hh: 1.4 },
        juliaC: [-1.62, -0.02],
    },
    {
        id: 'tricorn',
        kind: 'escape',
        fold: { preX: false, preY: false, conj: true, postRe: false, postIm: 0 },
        flipY: false,
        home: { x: -0.25, y: 0, hw: 1.8, hh: 1.55 },
        juliaHome: { x: 0, y: 0, hw: 1.6, hh: 1.4 },
        juliaC: [-0.48, 0.52],
    },
    {
        id: 'celtic',
        kind: 'escape',
        fold: { preX: false, preY: false, conj: false, postRe: true, postIm: 0 },
        flipY: false,
        home: { x: -0.45, y: 0, hw: 1.9, hh: 1.3 },
        juliaHome: { x: 0, y: 0, hw: 1.8, hh: 1.3 },
        juliaC: [-0.95, 0.24],
    },
    {
        id: 'buffalo',
        kind: 'escape',
        fold: { preX: true, preY: true, conj: false, postRe: true, postIm: -1 },
        flipY: false,
        home: { x: -0.5, y: 0.35, hw: 1.9, hh: 1.35 },
        juliaHome: { x: 0, y: 0, hw: 1.9, hh: 1.4 },
        juliaC: [-0.75, -0.45],
    },
    {
        id: 'sierpinski',
        kind: 'geometric',
        flipY: false,
        home: { x: 0.5, y: 0.4330127018922193, hw: 0.62, hh: 0.5 },
    },
];

export function getFractal(id) {
    return FRACTALS.find(f => f.id === id) || FRACTALS[0];
}

/** Escape radius squared. Large enough for accurate smooth colouring, small enough
 *  that |z|^p for p <= 12 still fits in a 32-bit float on the GPU. */
export const BAIL2 = 65536;
export const LOG2_BAIL2 = Math.log2(BAIL2);

export const POWER_MIN = 1.5;
export const POWER_MAX = 12;

/** Perturbation (ultra-deep zoom) is implemented for power-2 escape-time fractals. */
export function supportsDeepZoom(fractal, power) {
    return fractal.kind === 'escape' && power === 2;
}

/** Integer power if p is a whole number, else 0. */
export function integerPower(p) {
    return Number.isInteger(p) ? p : 0;
}
