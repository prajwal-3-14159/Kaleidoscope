// Curated places to visit, and smooth animated flights between views.

import * as bf from './core/bigfixed.js';
import { makeView, normalizeBits, centerDelta } from './view.js';

// z = log2 of the half-height of the view.
export const TOURS = [
    { id: 'home', fractal: 'mandelbrot', home: true },
    { id: 'seahorse', fractal: 'mandelbrot', x: '-0.7445398', y: '0.1217237', z: Math.log2(0.012) },
    { id: 'elephant', fractal: 'mandelbrot', x: '0.2829', y: '0.0103', z: Math.log2(0.012) },
    { id: 'spiral', fractal: 'mandelbrot', x: '-0.0886', y: '0.6545', z: Math.log2(0.012) },
    { id: 'minibrot', fractal: 'mandelbrot', x: '-1.7548776662466927', y: '0', z: Math.log2(0.022) },
    {
        id: 'deep', fractal: 'mandelbrot',
        x: '-0.743643887037158704752191506114774', y: '0.131825904205311970493132056385139',
        z: Math.log2(4e-30),
    },
    { id: 'rabbit', fractal: 'mandelbrot', julia: true, c: [-0.123, 0.745], home: true },
    { id: 'dendrite', fractal: 'mandelbrot', julia: true, c: [0, 1], home: true },
    { id: 'siegel', fractal: 'mandelbrot', julia: true, c: [-0.390541, -0.586788], home: true },
    { id: 'ship', fractal: 'burning-ship', x: '-1.7612', y: '-0.0293', z: Math.log2(0.035) },
    {
        id: 'sierpinski-deep', fractal: 'sierpinski',
        // u = 1/7, v = 2/7 in triangle coordinates: binary digits never clash, so this
        // point is in the set and the view repeats every 3 octaves forever.
        x: '0.2857142857142857142857142857142857142857142857142857142857142857142857',
        y: '0.2474358296526967562182066202151246238489721791157686611508295684931333',
        z: -180,
    },
];

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * A flight from view A to view B: zoom out until both are in sight, then zoom
 * into B while the centre glides in proportion to the view size (so the target
 * stays put on screen however deep it is).
 */
export function makeFlight(A, B, now) {
    const bits = Math.max(A.bits, B.bits);
    const ax = bf.rescale(A.cx, A.bits, bits), ay = bf.rescale(A.cy, A.bits, bits);
    const bx = bf.rescale(B.cx, B.bits, bits), by = bf.rescale(B.cy, B.bits, bits);
    const [dx, dy] = centerDelta(A, B, 0);
    const dist = Math.hypot(dx, dy);
    const outside = dist > 2 ** A.log2r * 0.6;
    const top = outside ? Math.max(A.log2r, Math.min(2, Math.log2(dist) + 0.6)) : Math.max(A.log2r, B.log2r);
    const up = top - A.log2r;
    const down = top - B.log2r;
    const secPerOctave = o => Math.min(o, 30) * 0.11 + Math.max(0, o - 30) * 0.05;
    const tUp = up > 0.01 ? Math.max(0.5, secPerOctave(up)) : 0;
    const tDown = Math.max(0.7, secPerOctave(Math.abs(down)));
    const rTop = 2 ** top, rB = 2 ** B.log2r;
    const simple = Math.abs(down) < 0.05;
    return {
        start: now, duration: (tUp + tDown) * 1000, target: B,
        at(t) {
            const s = Math.min(1, (t - this.start) / this.duration);
            const split = tUp / (tUp + tDown);
            let log2r, w;
            if (simple) {
                const e = ease(s);
                log2r = A.log2r + (B.log2r - A.log2r) * e;
                w = 1 - e;
            } else if (s < split) {
                log2r = A.log2r + up * ease(s / split);
                w = 1;
            } else {
                const e = ease((s - split) / (1 - split));
                log2r = top - down * e;
                // Offset from B shrinks with the view: w = (r − rB)/(rTop − rB).
                w = Math.max(0, (2 ** log2r - rB) / (rTop - rB));
                if (e >= 1) w = 0;
            }
            const v = {
                cx: bx + bf.mulByNumber(ax - bx, w),
                cy: by + bf.mulByNumber(ay - by, w),
                bits, log2r,
            };
            return { view: normalizeBits(v), done: s >= 1 };
        },
    };
}

export function tourView(tour) {
    return makeView(tour.x, tour.y, tour.z);
}
