// The view: an arbitrary-precision centre plus a zoom level.
// The centre is BigInt fixed point (see core/bigfixed.js); the zoom is stored as
// log2r = log2 of the half-height of the view in complex-plane units.
// Screen offsets used here are in render pixels with y pointing UP; `ysign` maps
// screen-up to +imaginary (1) or -imaginary (-1, for fractals drawn flipped).

import * as bf from './core/bigfixed.js';

export const MIN_LOG2R = -1000; // ≈ 10^-301: the deepest zoom supported anywhere
export const MAX_LOG2R = 4;

export function bitsFor(log2r) {
    return Math.max(96, Math.ceil(-log2r) + 96);
}

export function makeView(x, y, log2r) {
    const bits = bitsFor(log2r);
    const conv = v => (typeof v === 'string' ? bf.fromDecimal(v, bits) : bf.fromNumber(v, bits));
    return { cx: conv(x), cy: conv(y), bits, log2r };
}

export function cloneView(v) {
    return { cx: v.cx, cy: v.cy, bits: v.bits, log2r: v.log2r };
}

/** Grow (or, if far shallower, shrink) the precision to suit the zoom level. */
export function normalizeBits(v) {
    const need = bitsFor(v.log2r);
    if (need > v.bits || need < v.bits - 256) {
        v.cx = bf.rescale(v.cx, v.bits, need);
        v.cy = bf.rescale(v.cy, v.bits, need);
        v.bits = need;
    }
    return v;
}

/** log2 of the size of one render pixel in complex units. */
export function log2PixelSize(v, heightPx) {
    heightPx = Math.max(1, heightPx || 1);
    return v.log2r + 1 - Math.log2(heightPx);
}

/** Pixel size as mantissa/exponent: ps = pm * 2^ec with pm ∈ [1,2). */
export function pixelSizeParts(v, heightPx) {
    const l = log2PixelSize(v, heightPx);
    const ec = Math.floor(l);
    return { pm: 2 ** (l - ec), ec, log2: l };
}

export function centerNumbers(v) {
    return [bf.toNumber(v.cx, v.bits), bf.toNumber(v.cy, v.bits)];
}

/** Move the centre by a complex offset given in pixels (y-up screen pixels). */
export function translatePixels(v, dxPx, dyPx, heightPx, ysign) {
    const l = log2PixelSize(v, heightPx);
    // Exact: offset (a double) * 2^l converted straight to fixed point.
    v.cx += bf.fromNumber(bf.mulPow2(dxPx, l + v.bits), 0);
    v.cy += bf.fromNumber(bf.mulPow2(dyPx * ysign, l + v.bits), 0);
    return v;
}

/** Zoom by 2^dlog2 (negative = zoom in) keeping the point at pixel offset (px,py) fixed. */
export function zoomAtPixel(v, dlog2, px, py, heightPx, ysign) {
    const target = Math.min(MAX_LOG2R, Math.max(MIN_LOG2R, v.log2r + dlog2));
    dlog2 = target - v.log2r;
    // Old centre + p*ps = new centre + p*ps*2^d  ⇒  centre += p*ps*(1 - 2^d)
    const k = 1 - 2 ** dlog2;
    translatePixels(v, px * k, py * k, heightPx, ysign);
    v.log2r = target;
    return normalizeBits(v);
}

/** Complex-plane offset between two views, in units of 2^-k (as doubles). */
export function centerDelta(a, b, k) {
    const bits = Math.max(a.bits, b.bits);
    const dx = bf.rescale(a.cx, a.bits, bits) - bf.rescale(b.cx, b.bits, bits);
    const dy = bf.rescale(a.cy, a.bits, bits) - bf.rescale(b.cy, b.bits, bits);
    return [bf.toNumberScaled(dx, bits, k), bf.toNumberScaled(dy, bits, k)];
}

/**
 * Where does the current view's pixel grid sit inside a previous view's?
 * Returns { shift: [x,y] in previous-view pixels (y-up), scale: curPixel/prevPixel }.
 */
export function relativeTransform(prev, prevHeight, cur, curHeight, ysign) {
    const lp = log2PixelSize(prev, prevHeight);
    const [sx, sy] = centerDelta(cur, prev, -lp);
    return { shift: [sx, sy * ysign], scale: 2 ** (log2PixelSize(cur, curHeight) - lp) };
}

/** Number of decimal digits needed to pin the centre to ~1/16 pixel. */
export function digitsFor(v) {
    return Math.max(6, Math.ceil((-v.log2r + 16) * Math.log10(2)));
}

export function serialize(v) {
    const d = digitsFor(v);
    return { x: bf.toDecimal(v.cx, v.bits, d), y: bf.toDecimal(v.cy, v.bits, d), z: +v.log2r.toFixed(4) };
}

/** Zoom factor relative to a reference half-height (for display). */
export function zoomFactorLog10(v, homeLog2r) {
    return (homeLog2r - v.log2r) * Math.log10(2);
}

/** View that fits a box {x, y, hw, hh} into a canvas of the given aspect ratio. */
export function viewForBox(box, aspect) {
    const hh = Math.max(box.hh, box.hw / aspect);
    return makeView(box.x, box.y, Math.log2(hh));
}

/** Format a zoom factor like "1.5 × 10^42" or "350×". */
export function formatZoom(log10z) {
    if (log10z < 5) return `${(10 ** log10z).toLocaleString(undefined, { maximumFractionDigits: log10z < 1 ? 2 : 0 })}×`;
    const e = Math.floor(log10z);
    const m = 10 ** (log10z - e);
    return `${m.toFixed(2)} × 10${toSuperscript(e)}`;
}

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function toSuperscript(n) {
    return String(n).split('').map(c => SUP[c] ?? c).join('');
}
