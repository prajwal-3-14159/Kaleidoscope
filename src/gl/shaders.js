// GLSL ES 3.00 shader sources. The compute shaders mirror core/escape.js and the
// colorize shader mirrors core/colorize.js — keep them in sync (tests compare them).

import { BAIL2, LOG2_BAIL2 } from '../core/fractals.js';

export const VERTEX = `#version 300 es
void main() {
    // Full-screen triangle without vertex buffers.
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `
precision highp float;
precision highp int;
precision highp sampler2D;

const float BAIL2 = ${BAIL2.toFixed(1)};
const float LOG2_BAIL2 = ${LOG2_BAIL2.toFixed(1)};

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

// Exact 2^k (no transcendental approximation), flushed to 0 below the normal range.
float p2(int k) {
    if (k < -126) return 0.0;
    if (k > 127) return 1.7e38;
    return intBitsToFloat((k + 127) << 23);
}

// x * 2^k, saturating at ±1e30 instead of overflowing.
float mulPow2(float x, int k) {
    if (x == 0.0) return 0.0;
    float lx = log2(abs(x));
    if (lx + float(k) > 100.0) return sign(x) * 1e30;
    if (lx + float(k) < -126.0) return 0.0;
    if (k > 120) { x *= p2(120); k -= 120; }
    else if (k < -120) { x *= p2(-120); k += 120; }
    return x * p2(k);
}
`;

/**
 * Compute shader: writes per-pixel data (mu, log2 DE, normal angle, extra).
 * mode: 'direct' | 'perturb' | 'sierpinski'
 */
export function computeFragment(fractal, { julia, mode }) {
    const f = fractal.fold || {};
    const defs = `
#define JULIA ${julia ? 1 : 0}
#define PRE_X ${f.preX ? 1 : 0}
#define PRE_Y ${f.preY ? 1 : 0}
#define CONJ ${f.conj ? 1 : 0}
#define POST_RE ${f.postRe ? 1 : 0}
#define POST_IM ${f.postIm || 0}
#define MODE_${mode.toUpperCase()} 1
`;
    return `#version 300 es
${defs}
${COMMON}

uniform vec2 u_origin;      // target pixel (0,0) relative to image centre, in target pixels
uniform vec2 u_jitter;      // sub-pixel sample offset
uniform float u_pxScale;    // target pixel -> full-resolution pixel
uniform float u_ysign;
uniform float u_log2pixel;  // log2 of full-resolution pixel size
uniform int u_maxIter;
uniform float u_power;
uniform int u_powerInt;
uniform vec2 u_juliaC;

// direct
uniform vec2 u_center;
uniform float u_pixel;

// perturbation
uniform sampler2D u_orbit;
uniform int u_len0;
uniform int u_len1;
uniform vec2 u_refShift;
uniform float u_pm;
uniform int u_ec;

// sierpinski
uniform vec2 u_sLocal;
uniform float u_sScale;
uniform float u_sStatus[9];
uniform float u_sLast[9];
uniform float u_sK;

out vec4 outData;

void powDeriv(vec2 w, out vec2 wp, out vec2 dw) {
    if (u_powerInt == 2) {
        wp = vec2(w.x * w.x - w.y * w.y, 2.0 * w.x * w.y);
        dw = 2.0 * w;
        return;
    }
    if (u_powerInt > 0) {
        vec2 a = w;
        for (int i = 2; i < 64; i++) {
            if (i >= u_powerInt) break;
            a = cmul(a, w);
        }
        wp = cmul(a, w);
        dw = float(u_powerInt) * a;
        return;
    }
    float r2 = dot(w, w);
    if (r2 == 0.0) { wp = vec2(0.0); dw = vec2(0.0); return; }
    float lr = 0.5 * log(r2);
    float th = atan(w.y, w.x);
    float p = u_power;
    wp = exp(p * lr) * vec2(cos(p * th), sin(p * th));
    dw = p * exp((p - 1.0) * lr) * vec2(cos((p - 1.0) * th), sin((p - 1.0) * th));
}

// f(z) without +c, and its Jacobian. GLSL matrices are column-major.
void fstep(vec2 z, out vec2 fz, out mat2 Df) {
    vec2 w = z;
    float sx = 1.0, sy = 1.0;
#if PRE_X
    if (z.x < 0.0) sx = -1.0;
    w.x = abs(z.x);
#endif
#if PRE_Y
    if (z.y < 0.0) sy = -1.0;
    w.y = abs(z.y);
#endif
#if CONJ
    w.y = -w.y; sy = -sy;
#endif
    vec2 wp, dw;
    powDeriv(w, wp, dw);
    float tx = 1.0, ty = 1.0;
#if POST_RE
    if (wp.x < 0.0) tx = -1.0;
    wp.x = abs(wp.x);
#endif
#if POST_IM == 1
    if (wp.y < 0.0) ty = -1.0;
    wp.y = abs(wp.y);
#elif POST_IM == -1
    ty = wp.y < 0.0 ? 1.0 : -1.0;
    wp.y = -abs(wp.y);
#endif
    fz = wp;
    Df = mat2(tx * dw.x * sx, ty * dw.y * sx,
              -tx * dw.y * sy, ty * dw.x * sy);
}

void renormJ(inout mat2 J, inout int ej) {
    float mx = max(max(abs(J[0].x), abs(J[0].y)), max(abs(J[1].x), abs(J[1].y)));
    if (mx > 1e18) { J *= p2(-60); ej += 60; }
}

vec4 escaped(int n, vec2 z, mat2 J, int ej, float log2p) {
    float m = max(abs(z.x), abs(z.y));
    vec2 zn = z / m;
    float l2 = 2.0 * log2(m) + log2(dot(zn, zn));
    float mu = float(n) - log2(l2 / LOG2_BAIL2) / log2p;
    float lnz = 0.5 * l2 * 0.6931471806;
    float jn = sqrt(0.5 * (dot(J[0], J[0]) + dot(J[1], J[1])));
    float log2de = 0.5 * l2 + log2(lnz) - log2(jn) - float(ej) - u_log2pixel;
    vec2 g = vec2(dot(J[0], zn), dot(J[1], zn));
    float ang = atan(g.y * u_ysign, g.x);
    return vec4(mu, log2de, ang, atan(z.y, z.x) / 6.2831853 + 0.5);
}

#ifdef MODE_DIRECT
vec4 compute(vec2 p) {
    vec2 c = u_center + p * u_pixel;
#if JULIA
    vec2 z = c; vec2 C = u_juliaC; int n = 0;
#else
    vec2 z = c; vec2 C = c; int n = 1;
#endif
    mat2 J = mat2(1.0);
    int ej = 0;
    float trap = 1e30;
    float log2p = log2(u_power);
    for (int it = 0; it < 100000000; it++) {
        float r2 = dot(z, z);
        if (r2 > BAIL2) return escaped(n, z, J, ej, log2p);
        if (n >= u_maxIter) break;
        trap = min(trap, r2);
        vec2 fz; mat2 Df;
        fstep(z, fz, Df);
        J = Df * J;
#if JULIA == 0
        J += mat2(p2(-ej));
#endif
        renormJ(J, ej);
        z = fz + C;
        n++;
    }
    return vec4(-1.0, 0.0, 0.0, trap);
}
#endif

#ifdef MODE_PERTURB
// The delta is kept as mantissa d and exponent e (true delta = d·2^e) so it can be
// far smaller than the 1e-38 limit of 32-bit floats.

vec2 orbitAt(int i) { return texelFetch(u_orbit, ivec2(i & 4095, i >> 12), 0).xy; }

void renorm(inout vec2 d, inout int e) {
    float m = max(abs(d.x), abs(d.y));
    if (m == 0.0 || (m < 65536.0 && m > 1.0 / 65536.0)) return;
    int k = clamp(int(floor(log2(m))), -120, 120);
    d *= p2(-k);
    e += k;
}

// |c + d·2^e| − |c|, in units of 2^e, without cancellation.
float diffabsS(float c, float d, int e) {
    float t = mulPow2(c, -e);
    if (c >= 0.0) return (t + d >= 0.0) ? d : -(2.0 * t + d);
    return (t + d > 0.0) ? (2.0 * t + d) : -d;
}

// δ' = post(pre(Z+δ)²) − post(pre(Z)²), in units of 2^e (se = 2^e).
vec2 deltaStep(vec2 Z, vec2 d, int e, float se) {
    vec2 W = Z;
#if PRE_X
    d.x = diffabsS(W.x, d.x, e); W.x = abs(W.x);
#endif
#if PRE_Y
    d.y = diffabsS(W.y, d.y, e); W.y = abs(W.y);
#endif
#if CONJ
    W.y = -W.y; d.y = -d.y;
#endif
    vec2 dn = 2.0 * cmul(W, d) + se * cmul(d, d);
#if POST_RE || POST_IM != 0
    vec2 W2 = cmul(W, W);
#endif
#if POST_RE
    dn.x = diffabsS(W2.x, dn.x, e);
#endif
#if POST_IM == 1
    dn.y = diffabsS(W2.y, dn.y, e);
#elif POST_IM == -1
    dn.y = -diffabsS(W2.y, dn.y, e);
#endif
    return dn;
}

vec4 compute(vec2 p) {
    vec2 dcm = (p + u_refShift) * u_pm;   // true pixel offset = dcm · 2^ec
    vec2 d = dcm;
    int e = u_ec;
    renorm(d, e);
    int base = 0;
    int len = u_len0;
#if JULIA
    int m = 0; int n = 0;
#else
    int m = 1; int n = 1;                 // z1 = c  ⇒  δ1 = δc
#endif
    mat2 J = mat2(1.0);
    int ej = 0;
    float trap = 1e30;
    for (int it = 0; it < 100000000; it++) {
        vec2 Z = orbitAt(base + m);
        float se = p2(e);
        vec2 dt = d * se;
        vec2 z = Z + dt;
        float r2 = dot(z, z);
        if (r2 > BAIL2) return escaped(n, z, J, ej, 1.0);
        if (n >= u_maxIter) break;
        trap = min(trap, r2);
        // Rebase onto an orbit that starts at 0 (Zhuoran's method).
        if (m > 0 && (r2 < dot(dt, dt) || m >= len - 1)) {
#if JULIA
            base = u_len0; len = u_len1;
#endif
            m = 0; Z = vec2(0.0);
            d = z; e = 0;
            renorm(d, e);
            se = p2(e);
        }
        vec2 fz; mat2 Df;
        fstep(z, fz, Df);
        J = Df * J;
#if JULIA == 0
        J += mat2(p2(-ej));
#endif
        renormJ(J, ej);
        d = deltaStep(Z, d, e, se);
#if JULIA == 0
        d += dcm * p2(u_ec - e);
#endif
        renorm(d, e);
        m++; n++;
    }
    return vec4(-1.0, 0.0, 0.0, trap);
}
#endif

#ifdef MODE_SIERPINSKI
vec4 compute(vec2 p) {
    vec2 q = p * u_sScale;
    float lu = u_sLocal.x + q.x - q.y * 0.5773502692;
    float lv = u_sLocal.y + q.y * 1.1547005384;
    float a = clamp(floor(lu), -1.0, 1.0);
    float b = clamp(floor(lv), -1.0, 1.0);
    int idx = int(a + 1.0) + 3 * int(b + 1.0);
    float st = u_sStatus[idx];
    if (st >= 0.0) return vec4(st, 10.0, 0.0, 0.0);
    float u = lu - a, v = lv - b;
    if (u < 0.0 || v < 0.0 || u >= 1.0 || v >= 1.0) return vec4(0.0, 10.0, 0.0, 0.0);
    float last = u_sLast[idx];
    for (int k = 1; k <= 22; k++) {
        u *= 2.0; v *= 2.0;
        bool bu = u >= 1.0, bv = v >= 1.0;
        if (bu && bv) return vec4(last, 10.0, 0.0, 0.0);
        if (!bu && !bv) last = u_sK + float(k);
        if (bu) u -= 1.0;
        if (bv) v -= 1.0;
    }
    return vec4(-1.0, 0.0, 0.0, 0.0);
}
#endif

void main() {
    vec2 p = (gl_FragCoord.xy + u_origin + u_jitter) * u_pxScale;
    p.y *= u_ysign;
    outData = compute(p);
}`;
}

/** Data -> linear colour. Mirrors core/colorize.js. */
export const COLORIZE = `#version 300 es
${COMMON}
uniform sampler2D u_data;
uniform sampler2D u_lut;      // sRGB texture: sampling returns linear colour
uniform int u_mapping;
uniform float u_density;
uniform float u_offset;
uniform int u_shading;
uniform vec2 u_light;
uniform int u_interiorGlow;
out vec4 outColor;

float mapMu(float mu) {
    // Shifted so the outermost band (mu ≈ 1) sits at the start of the palette.
    if (u_mapping == 0) return (sqrt(mu) - 1.0) * 0.25;
    if (u_mapping == 1) return (log2(mu + 1.0) - 1.0) * 0.3;
    return (mu - 1.0) / 48.0;
}

vec3 lut(float t) { return texture(u_lut, vec2(t, 0.5)).rgb; }

void main() {
    vec4 d = texelFetch(u_data, ivec2(gl_FragCoord.xy), 0);
    vec3 col;
    if (d.x < 0.0) {
        col = u_interiorGlow == 1 ? lut(sqrt(sqrt(d.w)) * 0.5 + u_offset) * 0.18 : vec3(0.0);
    } else {
        col = lut(mapMu(d.x) * u_density + u_offset);
        if (u_shading == 1) {
            float de = exp2(d.y);
            float g = 1.0 - smoothstep(0.0, 4.0, de);
            col = col + (1.0 - col) * g * 0.85;
        } else if (u_shading == 2) {
            vec3 n = normalize(vec3(cos(d.z), sin(d.z), 1.6));
            vec3 L = normalize(vec3(u_light, 1.1));
            float diff = max(0.0, dot(n, L));
            vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
            float spec = pow(max(0.0, dot(n, H)), 40.0);
            float ao = 0.35 + 0.65 * smoothstep(0.0, 3.0, exp2(d.y));
            col = (col * (0.2 + 1.05 * diff) + 0.45 * spec) * ao;
        }
    }
    outColor = vec4(col, 1.0);
}`;

const SRGB = `
vec3 toSrgb(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}`;

/** Composites the progressive render stages and outputs to the screen. */
export const PRESENT = `#version 300 es
${COMMON}
${SRGB}
uniform sampler2D u_accum;
uniform sampler2D u_preview;
uniform sampler2D u_prev;
uniform int u_stage;          // 0 preview in progress, 1 first full sample, 2 anti-aliasing, 3 done
uniform float u_doneY;        // fraction of rows (from the top) finished in the current stage
uniform float u_samples;      // completed full-resolution samples
uniform vec2 u_size;
uniform vec3 u_prevXform;     // shift.xy (previous-view pixels), scale
uniform vec2 u_prevSize;
uniform int u_hasPreview;
uniform int u_hasPrev;
uniform int u_linearOut;
out vec4 outColor;

vec3 prevColor() {
    if (u_hasPrev == 0) return vec3(0.0);
    vec2 p = gl_FragCoord.xy - u_size * 0.5;
    vec2 pp = u_prevXform.xy + p * u_prevXform.z;
    vec2 uv = (pp + u_prevSize * 0.5) / u_prevSize;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec3(0.0);
    return texture(u_prev, uv).rgb;
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_size;
    bool done = uv.y >= 1.0 - u_doneY;
    vec3 col;
    if (u_stage == 0) {
        col = done ? texture(u_preview, uv).rgb : prevColor();
    } else if (u_stage == 1) {
        col = done ? texelFetch(u_accum, ivec2(gl_FragCoord.xy), 0).rgb
                   : (u_hasPreview == 1 ? texture(u_preview, uv).rgb : prevColor());
    } else {
        float n = u_samples + ((u_stage == 2 && done) ? 1.0 : 0.0);
        col = texelFetch(u_accum, ivec2(gl_FragCoord.xy), 0).rgb / max(n, 1.0);
    }
    outColor = vec4(u_linearOut == 1 ? col : toSrgb(col), 1.0);
}`;

/** Draws a linear-colour texture into the current viewport (sRGB output). */
export const BLIT = `#version 300 es
${COMMON}
${SRGB}
uniform sampler2D u_tex;
uniform vec4 u_rect;   // viewport x, y, w, h
out vec4 outColor;
void main() {
    vec2 uv = (gl_FragCoord.xy - u_rect.xy) / u_rect.zw;
    outColor = vec4(toSrgb(texture(u_tex, uv).rgb), 1.0);
}`;
