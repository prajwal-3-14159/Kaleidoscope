// Arbitrary-precision fixed-point numbers built on BigInt.
// A value is a BigInt `n` together with a bit count `bits`; it represents n / 2^bits.
// Used for the view centre and reference orbits so zooming can go far past
// the ~16 significant digits of a JavaScript number.

const F64 = new DataView(new ArrayBuffer(8));

/** Split a finite double into an exact BigInt mantissa and binary exponent: x = mant * 2^exp. */
export function frexp(x) {
    F64.setFloat64(0, x);
    const hi = F64.getUint32(0);
    const lo = F64.getUint32(4);
    const sign = hi >>> 31 ? -1n : 1n;
    const expBits = (hi >>> 20) & 0x7ff;
    let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    let exp;
    if (expBits === 0) {
        exp = -1074; // subnormal
    } else {
        mant |= 1n << 52n;
        exp = expBits - 1075;
    }
    return { mant: sign * mant, exp };
}

/** Exact conversion of a double to fixed point (rounds toward -inf below 2^-bits). */
export function fromNumber(x, bits) {
    if (!Number.isFinite(x)) throw new RangeError(`Non-finite value: ${x}`);
    if (x === 0) return 0n;
    const { mant, exp } = frexp(x);
    const shift = exp + bits;
    return shift >= 0 ? mant << BigInt(shift) : mant >> BigInt(-shift);
}

/** Multiply x by 2^k without intermediate overflow/underflow. */
export function mulPow2(x, k) {
    while (k > 1000) { x *= 2 ** 1000; k -= 1000; }
    while (k < -1000) { x *= 2 ** -1000; k += 1000; }
    return x * 2 ** k;
}

export function bitLength(n) {
    if (n < 0n) n = -n;
    if (n === 0n) return 0;
    // toString(16) is fast enough for the occasional (non-hot-loop) use here.
    const hex = n.toString(16);
    return (hex.length - 1) * 4 + (32 - Math.clz32(parseInt(hex[0], 16)));
}

/** n / 2^bits * 2^k as a double, accurate to double precision for any magnitude. */
export function toNumberScaled(n, bits, k = 0) {
    if (n === 0n) return 0;
    const len = bitLength(n);
    const drop = Math.max(0, len - 62);
    const top = Number(n >> BigInt(drop));
    return mulPow2(top, drop - bits + k);
}

export function toNumber(n, bits) {
    return toNumberScaled(n, bits, 0);
}

/** Fast conversion for values of moderate magnitude (|x| > ~1e-30), used in hot loops. */
export function makeFastToNumber(bits) {
    const drop = Math.max(0, bits - 100);
    const dropBig = BigInt(drop);
    const scale = 2 ** (drop - bits);
    return (n) => Number(n >> dropBig) * scale;
}

/** Change precision. Increasing is exact; decreasing truncates toward -inf. */
export function rescale(n, fromBits, toBits) {
    if (toBits === fromBits) return n;
    return toBits > fromBits ? n << BigInt(toBits - fromBits) : n >> BigInt(fromBits - toBits);
}

/** Multiply a fixed-point value by a double exactly (result at the same precision). */
export function mulByNumber(n, x) {
    if (x === 0 || n === 0n) return 0n;
    const { mant, exp } = frexp(x);
    const prod = n * mant;
    return exp >= 0 ? prod << BigInt(exp) : prod >> BigInt(-exp);
}

const DEC_RE = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?\s*$/i;

/** Parse a decimal string ("-0.7436438870371587e-3") into fixed point. */
export function fromDecimal(str, bits) {
    const m = DEC_RE.exec(String(str));
    if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) throw new SyntaxError(`Bad number: ${str}`);
    const neg = m[1] === '-';
    const intPart = m[2] || '0';
    const fracPart = m[3] || '';
    const exp10 = (m[4] ? parseInt(m[4], 10) : 0) - fracPart.length;
    let digits = BigInt(intPart + fracPart);
    let result;
    if (exp10 >= 0) {
        result = (digits * 10n ** BigInt(exp10)) << BigInt(bits);
    } else {
        const den = 10n ** BigInt(-exp10);
        const num = digits << BigInt(bits);
        result = (num + den / 2n) / den; // round to nearest
    }
    return neg ? -result : result;
}

/** Format fixed point as a decimal string with `digits` fractional digits (trailing zeros trimmed). */
export function toDecimal(n, bits, digits) {
    const neg = n < 0n;
    let a = neg ? -n : n;
    const b = BigInt(bits);
    const intPart = a >> b;
    const frac = a - (intPart << b);
    const scaled = ((frac * 10n ** BigInt(digits)) + (1n << (b - 1n))) >> b;
    let fracStr;
    let ip = intPart;
    if (scaled >= 10n ** BigInt(digits)) { // rounding carried into integer part
        ip += 1n;
        fracStr = '';
    } else {
        fracStr = scaled.toString().padStart(digits, '0').replace(/0+$/, '');
    }
    const s = fracStr ? `${ip}.${fracStr}` : `${ip}`;
    return neg && (ip !== 0n || fracStr) ? `-${s}` : s;
}

/** Integer square root (floor). */
export function isqrt(n) {
    if (n < 0n) throw new RangeError('isqrt of negative');
    if (n < 2n) return n;
    let x = 1n << BigInt(Math.ceil(bitLength(n) / 2));
    while (true) {
        const y = (x + n / x) >> 1n;
        if (y >= x) return x;
        x = y;
    }
}
