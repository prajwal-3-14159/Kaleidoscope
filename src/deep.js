// Reference-orbit management for perturbation (ultra-deep zoom) rendering.
//
// A reference orbit is computed once, in BigInt precision, for one point near the
// view; every pixel is then iterated as a small difference from it in fast
// float arithmetic. Thanks to rebasing (see core/escape.js) any reference point
// gives correct results, so we keep reusing the current one until it is too far
// away, too imprecise for the zoom level, or for a different formula.

import { bitsFor, centerDelta, log2PixelSize } from './view.js';
import * as bf from './core/bigfixed.js';

const MAX_SHIFT_PX = 8192;

export class ReferenceManager {
    constructor(onUpdate) {
        this.onUpdate = onUpdate;
        this.ref = null;        // last completed reference
        this.pending = null;    // request in flight
        this.worker = null;
        this.nextId = 1;
        this.progress = 0;
    }

    _formulaKey(s) {
        return `${s.fractal.id}|${s.julia ? `${s.juliaC[0]},${s.juliaC[1]}` : 'm'}`;
    }

    /** Is `ref` usable for spec `s` (view, heightPx, fractal, julia, juliaC, maxIter)? */
    usable(ref, s) {
        if (!ref || ref.key !== this._formulaKey(s)) return false;
        if (ref.bits < bitsFor(s.view.log2r) - 32) return false;
        const shift = this.shiftPx(ref, s);
        return Math.abs(shift[0]) < MAX_SHIFT_PX && Math.abs(shift[1]) < MAX_SHIFT_PX;
    }

    /** (view centre − reference) in pixels, complex orientation (not y-flipped). */
    shiftPx(ref, s) {
        const l = log2PixelSize(s.view, s.heightPx);
        return centerDelta(s.view, { cx: ref.cx, cy: ref.cy, bits: ref.bits }, -l);
    }

    /** Desired reference quality differs enough from the current one to recompute? */
    _wantsBetter(ref, s) {
        if (!ref.escaped && s.maxIter > ref.maxIter * 1.5) return true;
        const shift = this.shiftPx(ref, s);
        // Drifted well outside the view: still correct, but a centred reference is faster.
        return Math.hypot(shift[0], shift[1]) > s.heightPx * 1.5;
    }

    /**
     * Returns a usable reference for the spec (possibly an older one), starting a
     * new computation in the background when needed. Returns null if none usable yet.
     * `pin` (optional {cx, cy, bits}) requests a specific reference point.
     */
    get(s, pin = null) {
        const ok = this.usable(this.ref, s);
        if (!ok || this._wantsBetter(this.ref, s)) this._request(s, pin);
        return ok ? this.ref : null;
    }

    _request(s, pin) {
        const key = this._formulaKey(s);
        const bits = Math.max(bitsFor(s.view.log2r), pin ? pin.bits : 0);
        const target = pin || s.view;
        const cx = bf.rescale(target.cx, target.bits, bits);
        const cy = bf.rescale(target.cy, target.bits, bits);
        const maxIter = Math.max(s.maxIter, pin?.maxIter || 0);
        const p = this.pending;
        if (p && p.key === key && p.maxIter >= maxIter && p.bits >= bits - 32) {
            const req = { cx: p.cx, cy: p.cy, bits: p.bits, key, escaped: false, maxIter: p.maxIter };
            if (this.usable(req, s) && !this._wantsBetter(req, s)) return; // in-flight one will do
        }
        if (this.worker) this.worker.terminate();
        this.worker = new Worker(new URL('./workers/ref-worker.js', import.meta.url), { type: 'module' });
        const id = this.nextId++;
        const jb = (v) => bf.fromNumber(v, bits);
        this.pending = { id, key, cx, cy, bits, maxIter };
        this.progress = 0;
        this.worker.onmessage = (e) => {
            const m = e.data;
            if (!this.pending || m.id !== this.pending.id) return;
            if (m.type === 'progress') { this.progress = m.done / m.total; return; }
            this.ref = {
                id, key, cx, cy, bits, maxIter,
                orbit: m.orbit, len0: m.len0, len1: m.len1, escaped: m.escaped,
            };
            this.pending = null;
            this.worker.terminate();
            this.worker = null;
            this.onUpdate?.(this.ref);
        };
        this.worker.postMessage({
            id, fold: s.fractal.fold, julia: s.julia, cx, cy,
            jx: jb(s.juliaC[0]), jy: jb(s.juliaC[1]), bits, maxIter,
        });
    }

    get busy() { return !!this.pending; }
}

let onceId = 1e9;
/** One-off reference orbit computation (used by the benchmark). Resolves to a ref object. */
export function computeReferenceOnce({ fractal, julia, juliaC, view, maxIter }) {
    return new Promise((resolve) => {
        const bits = Math.max(bitsFor(view.log2r), view.bits);
        const cx = bf.rescale(view.cx, view.bits, bits), cy = bf.rescale(view.cy, view.bits, bits);
        const worker = new Worker(new URL('./workers/ref-worker.js', import.meta.url), { type: 'module' });
        const id = onceId++;
        worker.onmessage = (e) => {
            if (e.data.type !== 'done') return;
            worker.terminate();
            resolve({
                id, key: `${fractal.id}|${julia ? `${juliaC[0]},${juliaC[1]}` : 'm'}`, cx, cy, bits, maxIter,
                orbit: e.data.orbit, len0: e.data.len0, len1: e.data.len1, escaped: e.data.escaped,
            });
        };
        worker.postMessage({
            id, fold: fractal.fold, julia, cx, cy,
            jx: bf.fromNumber(juliaC[0], bits), jy: bf.fromNumber(juliaC[1], bits), bits, maxIter,
        });
    });
}
