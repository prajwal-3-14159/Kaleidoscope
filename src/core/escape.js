// Reference (CPU, 64-bit) implementation of all fractal maths.
// The GPU shaders mirror these functions; tests compare the two.
//
// Every pixel produces a 4-vector of "data" that the colouring stage turns into colour:
//   [0] mu     smooth (continuous) escape count, or -1 if the point never escaped
//   [1] log2de log2 of the distance estimate to the set, in pixels
//   [2] angle  direction of the potential gradient (surface normal for 3D lighting), radians
//   [3] extra  exterior: arg(z)/2π + 0.5 at escape; interior: min |z|² over the orbit

import { BAIL2, LOG2_BAIL2, integerPower } from './fractals.js';
import { makeFastToNumber, fromNumber, isqrt, toNumberScaled } from './bigfixed.js';

const LN2 = Math.LN2;

/** z^p and p·z^(p-1) for a complex z (integer p exact; otherwise principal branch). */
function powDeriv(x, y, p, pInt, out) {
    if (pInt === 2) {
        out[0] = x * x - y * y; out[1] = 2 * x * y;
        out[2] = 2 * x; out[3] = 2 * y;
        return;
    }
    if (pInt > 0) {
        let ax = x, ay = y; // a = z^(p-1)
        for (let i = 2; i < pInt; i++) {
            const t = ax * x - ay * y;
            ay = ax * y + ay * x;
            ax = t;
        }
        out[0] = ax * x - ay * y; out[1] = ax * y + ay * x;
        out[2] = pInt * ax; out[3] = pInt * ay;
        return;
    }
    const r2 = x * x + y * y;
    if (r2 === 0) { out[0] = out[1] = out[2] = out[3] = 0; return; }
    const lr = 0.5 * Math.log(r2);
    const th = Math.atan2(y, x);
    const m = Math.exp(p * lr);
    out[0] = m * Math.cos(p * th); out[1] = m * Math.sin(p * th);
    const m1 = p * Math.exp((p - 1) * lr);
    out[2] = m1 * Math.cos((p - 1) * th); out[3] = m1 * Math.sin((p - 1) * th);
}

/**
 * One step of f(z) = post(pow(pre(z))) without the +c, plus its 2×2 Jacobian.
 * out = [fx, fy, j00, j01, j10, j11] (row-major).
 */
export function foldStep(fold, p, pInt, x, y, out, tmp) {
    let sx = 1, sy = 1;
    let wx = x, wy = y;
    if (fold.preX) { if (x < 0) sx = -1; wx = Math.abs(x); }
    if (fold.preY) { if (y < 0) sy = -1; wy = Math.abs(y); }
    if (fold.conj) { wy = -wy; sy = -sy; }
    powDeriv(wx, wy, p, pInt, tmp);
    let fx = tmp[0], fy = tmp[1];
    const a = tmp[2], b = tmp[3];
    let tx = 1, ty = 1;
    if (fold.postRe) { if (fx < 0) tx = -1; fx = Math.abs(fx); }
    if (fold.postIm === 1) { if (fy < 0) ty = -1; fy = Math.abs(fy); }
    else if (fold.postIm === -1) { ty = fy < 0 ? 1 : -1; fy = -Math.abs(fy); }
    out[0] = fx; out[1] = fy;
    // Df = diag(tx,ty) · [[a,-b],[b,a]] · diag(sx,sy)
    out[2] = tx * a * sx; out[3] = -tx * b * sy;
    out[4] = ty * b * sx; out[5] = ty * a * sy;
}

/** Fill `out` with escape data given the final z, Jacobian (with exponent) and count. */
function finishEscape(n, zx, zy, j00, j01, j10, j11, ej, log2p, log2pixel, ysign, out) {
    const l2 = Math.log2(zx * zx + zy * zy); // log2 |z|²
    out[0] = n - Math.log2(l2 / LOG2_BAIL2) / log2p;
    const lnz = 0.5 * l2 * LN2;
    const jn = Math.sqrt(0.5 * (j00 * j00 + j01 * j01 + j10 * j10 + j11 * j11));
    out[1] = 0.5 * l2 + Math.log2(lnz) - Math.log2(jn) - ej - log2pixel;
    // Gradient of the potential log|z| w.r.t. c is ∝ Jᵀ z.
    const gx = j00 * zx + j10 * zy;
    const gy = j01 * zx + j11 * zy;
    out[2] = Math.atan2(gy * ysign, gx);
    out[3] = Math.atan2(zy, zx) / (2 * Math.PI) + 0.5;
}

const J_RENORM = 2 ** 60;

/**
 * Direct iteration in double precision.
 * cx,cy: pixel's complex coordinate. For Julia sets, (jx,jy) is the constant c.
 */
export function iterateDirect(fold, p, isJulia, cx, cy, jx, jy, maxIter, log2pixel, ysign, out, scratch) {
    const pInt = integerPower(p);
    const log2p = Math.log2(p);
    const st = scratch || new Float64Array(10);
    const tmp = st.subarray(6, 10);
    let x = cx, y = cy, Cx = cx, Cy = cy, n = 1;
    if (isJulia) { Cx = jx; Cy = jy; n = 0; }
    // Jacobian dz/dc (Mandelbrot: z1 = c ⇒ J = I) or dz/dz0 (Julia: J = I).
    let j00 = 1, j01 = 0, j10 = 0, j11 = 1, ej = 0;
    let trap = Infinity;
    for (;;) {
        const r2 = x * x + y * y;
        if (r2 > BAIL2) { finishEscape(n, x, y, j00, j01, j10, j11, ej, log2p, log2pixel, ysign, out); return; }
        if (n >= maxIter) { out[0] = -1; out[1] = 0; out[2] = 0; out[3] = trap; return; }
        if (r2 < trap) trap = r2;
        foldStep(fold, p, pInt, x, y, st, tmp);
        const a = st[2], b = st[3], c = st[4], d = st[5];
        let n00 = a * j00 + b * j10, n01 = a * j01 + b * j11;
        let n10 = c * j00 + d * j10, n11 = c * j01 + d * j11;
        if (!isJulia) { const s = 2 ** -ej; n00 += s; n11 += s; }
        j00 = n00; j01 = n01; j10 = n10; j11 = n11;
        if (Math.abs(j00) + Math.abs(j01) + Math.abs(j10) + Math.abs(j11) > J_RENORM) {
            j00 /= J_RENORM; j01 /= J_RENORM; j10 /= J_RENORM; j11 /= J_RENORM; ej += 60;
        }
        x = st[0] + Cx; y = st[1] + Cy; n++;
    }
}

/** |c + d| - |c| computed without cancellation. */
export function diffabs(c, d) {
    if (c >= 0) return c + d >= 0 ? d : -(2 * c + d);
    return c + d > 0 ? 2 * c + d : -d;
}

/**
 * Perturbation iteration (power 2 only) against a high-precision reference orbit.
 * orbit: Float64Array of interleaved Z values, orbitLen entries.
 * For Julia sets, orbit starts at the view centre and `crit` is the orbit of the
 * critical point 0 (used after rebasing); for Mandelbrot-type, crit is unused.
 * (dx,dy): pixel minus reference, in complex units (c-offset or z0-offset).
 * Uses Zhuoran's rebasing to avoid glitches.
 */
export function iteratePerturb(fold, isJulia, dx, dy, orbit, orbitLen, crit, critLen, maxIter, log2pixel, ysign, out, scratch) {
    const st = scratch || new Float64Array(10);
    const tmp = st.subarray(6, 10);
    let orb = orbit, len = orbitLen;
    let ddx = 0, ddy = 0; // current delta
    let dcx = dx, dcy = dy;
    let n = 1, m = 0;
    let j00 = 1, j01 = 0, j10 = 0, j11 = 1, ej = 0;
    if (isJulia) { ddx = dx; ddy = dy; dcx = 0; dcy = 0; n = 0; }
    else { ddx = dx; ddy = dy; m = 1; } // z1 = c ⇒ Z1 = C, delta = dc
    let trap = Infinity;
    const preX = fold.preX, preY = fold.preY, conj = fold.conj, postRe = fold.postRe, postIm = fold.postIm;
    for (;;) {
        let Zx = orb[2 * m], Zy = orb[2 * m + 1];
        const zx = Zx + ddx, zy = Zy + ddy;
        const r2 = zx * zx + zy * zy;
        if (r2 > BAIL2) { finishEscape(n, zx, zy, j00, j01, j10, j11, ej, 1, log2pixel, ysign, out); return; }
        if (n >= maxIter) { out[0] = -1; out[1] = 0; out[2] = 0; out[3] = trap; return; }
        if (r2 < trap) trap = r2;
        // Rebase onto an orbit starting at 0 when the pixel's orbit gets closer to 0
        // than to the reference, or when the reference has run out.
        if (m > 0 && (r2 < ddx * ddx + ddy * ddy || m >= len - 1)) {
            if (isJulia) { orb = crit; len = critLen; }
            m = 0; Zx = 0; Zy = 0; ddx = zx; ddy = zy;
        }
        // Jacobian from the full z.
        foldStep(fold, 2, 2, zx, zy, st, tmp);
        const a = st[2], b = st[3], c = st[4], d = st[5];
        let n00 = a * j00 + b * j10, n01 = a * j01 + b * j11;
        let n10 = c * j00 + d * j10, n11 = c * j01 + d * j11;
        if (!isJulia) { const s = 2 ** -ej; n00 += s; n11 += s; }
        j00 = n00; j01 = n01; j10 = n10; j11 = n11;
        if (Math.abs(j00) + Math.abs(j01) + Math.abs(j10) + Math.abs(j11) > J_RENORM) {
            j00 /= J_RENORM; j01 /= J_RENORM; j10 /= J_RENORM; j11 /= J_RENORM; ej += 60;
        }
        // Delta step: δ' = post(pre(Z+δ)²) - post(pre(Z)²) + δc
        let Wx = Zx, Wy = Zy, wx = ddx, wy = ddy;
        if (preX) { wx = diffabs(Wx, wx); Wx = Math.abs(Wx); }
        if (preY) { wy = diffabs(Wy, wy); Wy = Math.abs(Wy); }
        if (conj) { Wy = -Wy; wy = -wy; }
        let nx = 2 * (Wx * wx - Wy * wy) + (wx * wx - wy * wy);
        let ny = 2 * (Wx * wy + Wy * wx) + 2 * wx * wy;
        if (postRe) nx = diffabs(Wx * Wx - Wy * Wy, nx);
        if (postIm === 1) ny = diffabs(2 * Wx * Wy, ny);
        else if (postIm === -1) ny = -diffabs(2 * Wx * Wy, ny);
        ddx = nx + dcx; ddy = ny + dcy;
        m++; n++;
    }
}

/**
 * High-precision reference orbit (power 2) using BigInt fixed point.
 * Start z0 (BigInt pair), parameter c (BigInt pair), all at `bits` precision.
 * Returns Float64Array of interleaved Z_0..Z_{len-1}; stops after the first escaped
 * value or at maxIter+1 entries.
 */
export function referenceOrbit(fold, z0x, z0y, cx, cy, bits, maxIter, onProgress) {
    const B = BigInt(bits);
    const toNum = makeFastToNumber(bits);
    let cap = 1024;
    let buf = new Float64Array(cap * 2);
    let x = z0x, y = z0y;
    let len = 0;
    for (let i = 0; i <= maxIter; i++) {
        const fx = toNum(x), fy = toNum(y);
        if (len === cap) {
            cap *= 2;
            const nb = new Float64Array(cap * 2);
            nb.set(buf);
            buf = nb;
        }
        buf[2 * len] = fx; buf[2 * len + 1] = fy; len++;
        if (fx * fx + fy * fy > BAIL2) break;
        if (fold.preX && x < 0n) x = -x;
        if (fold.preY && y < 0n) y = -y;
        if (fold.conj) y = -y;
        const x2 = (x * x) >> B;
        const y2 = (y * y) >> B;
        const xy = (x * y) >> (B - 1n);
        let nx = x2 - y2, ny = xy;
        if (fold.postRe && nx < 0n) nx = -nx;
        if (fold.postIm === 1 && ny < 0n) ny = -ny;
        else if (fold.postIm === -1 && ny > 0n) ny = -ny;
        x = nx + cx; y = ny + cy;
        if (onProgress && (i & 4095) === 0) onProgress(i);
    }
    return buf.subarray(0, len * 2);
}

// ---------------------------------------------------------------------------
// Sierpiński triangle (exact, arbitrarily deep)
// ---------------------------------------------------------------------------
// The equilateral gasket with vertices (0,0), (1,0), (½, √3/2) is the affine image
// of the right-angled one where a point (u,v) ∈ [0,1)² belongs iff the binary digits
// of u and v are never both 1 at the same position (Pascal's triangle mod 2).
// u = x − y/√3, v = 2y/√3.

const INV_SQRT3 = 1 / Math.sqrt(3);

// Removal level: a point is removed at level k when, after k-1 subdivisions, it falls
// into the middle triangle. In digit terms that is the position of the last (0,0)
// digit pair before the first position where both digits are 1 (level 0 = outside
// the main triangle).

function lowBitIndex(x) { return (x & -x).toString(2).length - 1; }

/**
 * Prepare the local frame for a view. Deep zoom works by peeling off the first K
 * binary digits in BigInt, then iterating only the remaining digits in floats.
 * Returns { K, lu, lv, scale, status[9], lastZero[9] } indexed by neighbouring cell
 * (a,b) ∈ {-1,0,1}² as (a+1)+3(b+1): status -1 = keep iterating, otherwise the
 * removal level; lastZero = level of the last (0,0) digit pair inside the prefix.
 */
export function sierpinskiFrame(cx, cy, bits, log2pixel) {
    const K = Math.max(0, Math.min(bits - 8, Math.floor(-log2pixel) - 12));
    const B = BigInt(bits);
    const sqrt3 = isqrt(3n << (2n * B));                 // √3 · 2^bits
    const invSqrt3 = (1n << (2n * B)) / sqrt3;           // 2^bits / √3
    const u = cx - ((cy * invSqrt3) >> B);
    const v = (2n * cy * invSqrt3) >> B;
    const shift = BigInt(bits - K);
    const iu = u >> shift, iv = v >> shift;
    const lu = toNumberScaled(u - (iu << shift), bits, K);
    const lv = toNumberScaled(v - (iv << shift), bits, K);
    const maxCell = 1n << BigInt(K);
    const mask = maxCell - 1n;
    const status = new Float64Array(9);
    const lastZero = new Float64Array(9);
    for (let b = -1; b <= 1; b++) {
        for (let a = -1; a <= 1; a++) {
            const i = (a + 1) + 3 * (b + 1);
            const A = iu + BigInt(a), Bv = iv + BigInt(b);
            if (A < 0n || Bv < 0n || A >= maxCell || Bv >= maxCell) { status[i] = 0; continue; }
            const zeros = ~(A | Bv) & mask;
            const conflict = A & Bv;
            if (conflict === 0n) {
                status[i] = -1;
                lastZero[i] = zeros === 0n ? 0 : K - lowBitIndex(zeros);
            } else {
                const q = conflict.toString(2).length - 1;   // most significant clash
                const above = zeros >> BigInt(q + 1);
                status[i] = above === 0n ? 0 : K - (q + 1 + lowBitIndex(above));
            }
        }
    }
    return { K, lu, lv, scale: 2 ** (log2pixel + K), status, lastZero };
}

/** Sierpiński data for a pixel offset (px,py) in pixels from the view centre. */
export function iterateSierpinski(frame, px, py, out) {
    const qx = px * frame.scale, qy = py * frame.scale;
    const lu = frame.lu + qx - qy * INV_SQRT3;
    const lv = frame.lv + 2 * qy * INV_SQRT3;
    const a = Math.max(-1, Math.min(1, Math.floor(lu)));
    const b = Math.max(-1, Math.min(1, Math.floor(lv)));
    const idx = (a + 1) + 3 * (b + 1);
    out[1] = 10; out[2] = 0; out[3] = 0;
    if (frame.status[idx] >= 0) { out[0] = frame.status[idx]; return; }
    let u = lu - a, v = lv - b;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) { out[0] = 0; return; }
    let last = frame.lastZero[idx];
    for (let k = 1; k <= 50; k++) {
        u *= 2; v *= 2;
        const bu = u >= 1 ? 1 : 0, bv = v >= 1 ? 1 : 0;
        if (bu && bv) { out[0] = last; return; }
        if (!bu && !bv) last = frame.K + k;
        u -= bu; v -= bv;
    }
    out[0] = -1;
}

export { fromNumber };
