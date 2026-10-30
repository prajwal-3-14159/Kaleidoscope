// Cyclic colour palettes. Stops are interpolated in OKLab (perceptually even) and
// baked into a 256-entry lookup table shared by the GPU (as a texture) and the CPU.

export const PALETTES = [
    { id: 'classic', stops: ['#000764', '#206bcb', '#edffff', '#ffaa00', '#000200'] },
    { id: 'neon', stops: ['#0a0a1e', '#0080ff', '#8000ff', '#ff0080', '#ffe6ff'] },
    { id: 'fire', stops: ['#000000', '#780000', '#e65a00', '#ffc800', '#ffffc8', '#7a1000'] },
    { id: 'ocean', stops: ['#020818', '#004c99', '#009999', '#66ffb2', '#ffffff', '#0b3a66'] },
    { id: 'aurora', stops: ['#050314', '#1b3a6b', '#1fa98b', '#b4f07a', '#f2e6ff', '#7a3fbf'] },
    { id: 'ice', stops: ['#00010a', '#0a2a5a', '#3d8fd1', '#cdf3ff', '#ffffff', '#5a7bd1'] },
    { id: 'slate', stops: ['#0f172a', '#334155', '#64748b', '#94a3b8', '#f1f5f9', '#475569'] },
    { id: 'spectrum', stops: ['#ff3b3b', '#ffb000', '#d6ff3b', '#2bff88', '#21d4ff', '#4f5bff', '#c23bff'] },
];

export function getPalette(id) {
    return PALETTES.find(p => p.id === id) || PALETTES[0];
}

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToLinear(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => srgbToLinear(v / 255));
}

function linearToOklab([r, g, b]) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
}

function oklabToLinear([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
}

export const LUT_SIZE = 256;

/** RGBA8 sRGB lookup table (Uint8Array of LUT_SIZE*4), cyclic. */
export function buildLut(id) {
    const labs = getPalette(id).stops.map(h => linearToOklab(hexToLinear(h)));
    const n = labs.length;
    const out = new Uint8Array(LUT_SIZE * 4);
    for (let i = 0; i < LUT_SIZE; i++) {
        const t = (i / LUT_SIZE) * n;
        const k = Math.floor(t);
        const f = t - k;
        const e = f * f * (3 - 2 * f); // smoothstep easing hides the stop "kinks"
        const A = labs[k % n], B = labs[(k + 1) % n];
        const lin = oklabToLinear([0, 1, 2].map(j => A[j] + (B[j] - A[j]) * e));
        for (let j = 0; j < 3; j++) {
            out[i * 4 + j] = Math.round(255 * Math.min(1, Math.max(0, linearToSrgb(Math.max(0, lin[j])))));
        }
        out[i * 4 + 3] = 255;
    }
    return out;
}

/** CSS gradient for UI swatches. */
export function paletteCss(id) {
    const stops = getPalette(id).stops;
    return `linear-gradient(90deg, ${[...stops, stops[0]].join(', ')})`;
}
