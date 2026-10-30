// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as bf from '../src/core/bigfixed.js';
import { FRACTALS, getFractal, BAIL2 } from '../src/core/fractals.js';
import { iterateDirect, iteratePerturb, referenceOrbit, sierpinskiFrame, iterateSierpinski, diffabs } from '../src/core/escape.js';

const out = new Float64Array(4);
const M = getFractal('mandelbrot').fold;

function direct(fold, cx, cy, maxIter = 1000, p = 2, julia = false, jx = 0, jy = 0) {
    iterateDirect(fold, p, julia, cx, cy, jx, jy, maxIter, 0, 1, out);
    return Array.from(out);
}

test('bigfixed: decimal round trip and arithmetic', () => {
    const bits = 400;
    const s = '-0.743643887037158704752191506114774';
    const n = bf.fromDecimal(s, bits);
    assert.equal(bf.toDecimal(n, bits, 33), s);
    assert.equal(bf.toNumber(n, bits), -0.7436438870371587);
    assert.equal(bf.toNumber(bf.fromNumber(1e-300, 1200), 1200), 1e-300);
    assert.equal(bf.toNumberScaled(bf.fromNumber(3, 64), 64, -1), 1.5);
    assert.equal(bf.fromDecimal('1e-3', 64), bf.fromDecimal('0.001', 64));
    assert.equal(bf.toNumber(bf.mulByNumber(bf.fromNumber(2, 64), 0.375), 64), 0.75);
    assert.equal(bf.isqrt(10n ** 40n), 10n ** 20n);
    assert.equal(bf.bitLength(255n), 8);
    assert.equal(bf.bitLength(256n), 9);
});

test('mandelbrot: known interior points never escape', () => {
    for (const [x, y] of [[0, 0], [-1, 0], [-0.1, 0.1], [0, 1], [-2, 0], [0.25, 0]]) {
        assert.equal(direct(M, x, y, 2000)[0], -1, `c = ${x}+${y}i should be bounded`);
    }
});

test('mandelbrot: c = 1 escapes at iteration 5 (0,1,2,5,26,677)', () => {
    const [mu] = direct(M, 1, 0);
    assert.ok(mu > 4 && mu <= 5, `mu = ${mu}`);
});

test('mandelbrot: smooth count is continuous across iteration bands', () => {
    // Walk along the real axis outside the set; consecutive mu must not jump.
    let prev = null;
    for (let x = 0.3; x < 2; x += 0.0005) {
        const [mu] = direct(M, x, 0);
        if (prev !== null) assert.ok(Math.abs(mu - prev) < 0.5, `jump at x=${x}: ${prev} -> ${mu}`);
        prev = mu;
    }
});

test('mandelbrot: just outside the cusp escapes slowly', () => {
    const [mu] = direct(M, 0.2501, 0, 100000);
    assert.ok(mu > 250 && mu < 400, `mu = ${mu}`);
});

test('distance estimate is roughly the true distance', () => {
    // Distance from c = 2.5 to the set (rightmost point is 0.25 on the real axis) is 2.25.
    iterateDirect(M, 2, false, 2.5, 0, 0, 0, 1000, 0, 1, out);
    const de = 2 ** out[1];
    assert.ok(de > 2.25 / 4 && de < 2.25 * 4, `de = ${de}`);
});

test('julia: c = -1 basin contains 0, escapes at |z| = 2', () => {
    assert.equal(direct(M, 0, 0, 1000, 2, true, -1, 0)[0], -1);
    assert.ok(direct(M, 2, 0.5, 1000, 2, true, -1, 0)[0] >= 0);
});

test('higher integer power matches polar formula', () => {
    const fold = M;
    const a = direct(fold, 0.6, 0.6, 200, 3);
    iterateDirect(fold, 3.0000000001, false, 0.6, 0.6, 0, 0, 200, 0, 1, out);
    assert.ok(Math.abs(a[0] - out[0]) < 1e-4, `${a[0]} vs ${out[0]}`);
});

test('diffabs equals |c+d|-|c|', () => {
    for (const [c, d] of [[1, 0.5], [1, -3], [-1, 0.5], [-1, 3], [0, -2], [0, 2], [1e-20, -1e-20]]) {
        assert.ok(Math.abs(diffabs(c, d) - (Math.abs(c + d) - Math.abs(c))) < 1e-12);
    }
});

// Perturbation must agree with direct double-precision iteration at zooms where
// doubles are still accurate.
function perturbAgrees(fractal, cx, cy, radius, julia = false, jc = [0, 0]) {
    const bits = 128;
    const fold = fractal.fold;
    const CX = bf.fromNumber(cx, bits), CY = bf.fromNumber(cy, bits);
    const maxIter = 3000;
    let orbit, crit = null, critLen = 0;
    if (julia) {
        const JX = bf.fromNumber(jc[0], bits), JY = bf.fromNumber(jc[1], bits);
        orbit = referenceOrbit(fold, CX, CY, JX, JY, bits, maxIter);
        crit = referenceOrbit(fold, 0n, 0n, JX, JY, bits, maxIter);
        critLen = crit.length / 2;
    } else {
        orbit = referenceOrbit(fold, 0n, 0n, CX, CY, bits, maxIter);
    }
    let checked = 0, mismatched = 0;
    for (let i = 0; i < 400; i++) {
        const dx = (Math.sin(i * 12.9898) * 0.5) * radius * 2;
        const dy = (Math.sin(i * 78.233) * 0.5) * radius * 2;
        iterateDirect(fold, 2, julia, cx + dx, cy + dy, jc[0], jc[1], maxIter, 0, 1, out);
        const a = Array.from(out);
        iteratePerturb(fold, julia, dx, dy, orbit, orbit.length / 2, crit, critLen, maxIter, 0, 1, out);
        checked++;
        const bothInterior = a[0] < 0 && out[0] < 0;
        if (bothInterior || Math.abs(a[0] - out[0]) < 1e-3) continue;
        // Disagreement: plain doubles lose accuracy on chaotic orbits, so settle it
        // with a 400-bit BigInt iteration of the exact same point.
        const escapeIndex = (B) => {
            const P = [bf.fromNumber(cx + dx, B), bf.fromNumber(cy + dy, B)];
            const C = julia ? [bf.fromNumber(jc[0], B), bf.fromNumber(jc[1], B)] : P;
            const o = julia ? referenceOrbit(fold, P[0], P[1], C[0], C[1], B, maxIter)
                            : referenceOrbit(fold, 0n, 0n, C[0], C[1], B, maxIter);
            return o.length / 2 - 1; // index of first escaped value
        };
        const truthN = escapeIndex(400);
        // Points whose fate already changes between 53-bit (double) and 400-bit exact arithmetic
        // are beyond what any double-precision method can resolve; don't count them.
        if (escapeIndex(53) !== truthN) continue;
        const escapedTruth = truthN < maxIter;
        const ok = escapedTruth ? Math.abs(Math.ceil(out[0]) - truthN) <= 1 : out[0] < 0;
        if (!ok) mismatched++;
    }
    assert.ok(mismatched <= checked * 0.01, `${fractal.id}${julia ? ' julia' : ''}: ${mismatched}/${checked} perturbation errors`);
}

for (const f of FRACTALS.filter(f => f.kind === 'escape')) {
    test(`perturbation matches direct: ${f.id}`, () => {
        perturbAgrees(f, f.home.x + 0.1, f.home.y + 0.05, 0.01);
        perturbAgrees(f, -0.75, 0.1, 1e-4);
    });
    test(`perturbation matches direct: ${f.id} julia`, () => {
        perturbAgrees(f, 0.1, 0.05, 0.05, true, f.juliaC);
    });
}

test('reference orbit stops after escaping', () => {
    const o = referenceOrbit(M, 0n, 0n, bf.fromNumber(1, 64), 0n, 64, 100);
    assert.deepEqual(Array.from(o), [0, 0, 1, 0, 2, 0, 5, 0, 26, 0, 677, 0]);
    assert.ok(677 * 677 > BAIL2);
});

// Sierpiński: geometry checks in the equilateral frame.
function sier(x, y, bits = 96, log2pixel = -10) {
    const f = sierpinskiFrame(bf.fromNumber(x, bits), bf.fromNumber(y, bits), bits, log2pixel);
    iterateSierpinski(f, 0, 0, out);
    return out[0];
}

test('sierpinski: removal levels', () => {
    const h = Math.sqrt(3) / 2;
    assert.equal(sier(0.5, h / 3), 1, 'centroid lies in the first removed triangle');
    assert.equal(sier(0.25, h / 6), 2, 'centroid of bottom-left copy is removed at level 2');
    assert.equal(sier(0.5, -0.1), 0, 'below the triangle is outside');
    assert.equal(sier(0.9, 0.8), 0, 'above-right is outside');
    assert.equal(sier(0, 0), -1, 'corner is in the set');
    assert.equal(sier(0.5, 0), -1, 'bottom edge is in the set');
    assert.equal(sier(0.25, Math.sqrt(3) / 4), -1, 'left edge midpoint is in the set');
});

test('sierpinski: deep frame agrees with shallow evaluation', () => {
    const bits = 200;
    for (let i = 0; i < 200; i++) {
        const x = 0.2 + 0.6 * Math.abs(Math.sin(i * 3.1)), y = 0.6 * Math.abs(Math.sin(i * 1.7)) * 0.7;
        const shallow = sierpinskiFrame(bf.fromNumber(x, bits), bf.fromNumber(y, bits), bits, -8);
        const deep = sierpinskiFrame(bf.fromNumber(x, bits), bf.fromNumber(y, bits), bits, -40);
        iterateSierpinski(shallow, 0, 0, out); const a = out[0];
        iterateSierpinski(deep, 0, 0, out); const b = out[0];
        if (a >= 0 && a < 30) assert.equal(b, a, `point ${x},${y}`);
    }
});
