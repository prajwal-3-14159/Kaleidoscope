// Turns per-pixel fractal data (see escape.js) into colour.
// This is the CPU twin of the GPU colorize shader in gl/shaders.js — keep them in sync.

import { LUT_SIZE } from './palettes.js';

export const MAPPINGS = { sqrt: 0, log: 1, linear: 2 };
export const SHADINGS = { flat: 0, filaments: 1, relief: 2 };

/** Palette position (in cycles) for a smooth escape count. */
export function mapMu(mu, mapping) {
    // Shifted so the outermost band (mu ≈ 1) sits at the start of the palette.
    if (mapping === 0) return (Math.sqrt(mu) - 1) * 0.25;
    if (mapping === 1) return (Math.log2(mu + 1) - 1) * 0.3;
    return (mu - 1) / 48;
}

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** Linear-RGB version of the sRGB LUT, with linear interpolation between entries. */
export function makeLinearLut(lut8) {
    const out = new Float32Array(LUT_SIZE * 3);
    for (let i = 0; i < LUT_SIZE; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] = srgbToLinear(lut8[i * 4 + j] / 255);
    return out;
}

function sampleLut(lut, t, out) {
    let x = (t - Math.floor(t)) * LUT_SIZE - 0.5;
    if (x < 0) x += LUT_SIZE;
    const i0 = Math.floor(x) % LUT_SIZE;
    const i1 = (i0 + 1) % LUT_SIZE;
    const f = x - Math.floor(x);
    for (let j = 0; j < 3; j++) out[j] = lut[i0 * 3 + j] * (1 - f) + lut[i1 * 3 + j] * f;
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Colour one pixel. `s` = { lut (linear Float32Array), mapping, density, offset,
 * shading, lightX, lightY, interiorGlow }. Writes linear RGB into out[0..2].
 */
export function colorizePixel(mu, log2de, angle, extra, s, out) {
    if (mu < 0) {
        if (s.interiorGlow) {
            sampleLut(s.lut, Math.sqrt(Math.sqrt(extra)) * 0.5 + s.offset, out);
            const k = 0.18;
            out[0] *= k; out[1] *= k; out[2] *= k;
        } else {
            out[0] = out[1] = out[2] = 0;
        }
        return;
    }
    sampleLut(s.lut, mapMu(mu, s.mapping) * s.density + s.offset, out);
    if (s.shading === 1) {
        // Filaments: brighten pixels within a few pixels of the set boundary.
        const de = 2 ** log2de;
        const g = 1 - smoothstep(0, 4, de);
        for (let j = 0; j < 3; j++) out[j] = out[j] + (1 - out[j]) * g * 0.85;
    } else if (s.shading === 2) {
        // 3D relief: treat the potential as a height field, light it from (lightX, lightY).
        const h = 1.6;
        let nx = Math.cos(angle), ny = Math.sin(angle), nz = h;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= inv; ny *= inv; nz *= inv;
        let lx = s.lightX, ly = s.lightY, lz = 1.1;
        const il = 1 / Math.sqrt(lx * lx + ly * ly + lz * lz);
        lx *= il; ly *= il; lz *= il;
        const diff = Math.max(0, nx * lx + ny * ly + nz * lz);
        // Blinn-Phong highlight with the viewer looking straight down.
        let hx = lx, hy = ly, hz = lz + 1;
        const ih = 1 / Math.sqrt(hx * hx + hy * hy + hz * hz);
        const spec = Math.max(0, (nx * hx + ny * hy + nz * hz) * ih) ** 40;
        const de = 2 ** log2de;
        const ao = 0.35 + 0.65 * smoothstep(0, 3, de);
        for (let j = 0; j < 3; j++) out[j] = (out[j] * (0.2 + 1.05 * diff) + 0.45 * spec) * ao;
    }
}

export function toSrgb8(x) {
    return Math.round(255 * Math.min(1, Math.max(0, linearToSrgb(Math.max(0, x)))));
}
