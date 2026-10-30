// Computes high-precision reference orbits for perturbation rendering off the main thread.
import { referenceOrbit } from '../core/escape.js';

self.onmessage = (e) => {
    const { id, fold, julia, cx, cy, jx, jy, bits, maxIter } = e.data;
    const progress = (i) => self.postMessage({ id, type: 'progress', done: i, total: maxIter });
    let primary, crit = new Float64Array(0);
    if (julia) {
        primary = referenceOrbit(fold, cx, cy, jx, jy, bits, maxIter, progress);
        crit = referenceOrbit(fold, 0n, 0n, jx, jy, bits, maxIter, progress);
    } else {
        primary = referenceOrbit(fold, 0n, 0n, cx, cy, bits, maxIter, progress);
    }
    const len0 = primary.length / 2, len1 = crit.length / 2;
    const orbit = new Float64Array((len0 + len1) * 2);
    orbit.set(primary, 0);
    orbit.set(crit, len0 * 2);
    self.postMessage({ id, type: 'done', orbit, len0, len1, escaped: len0 <= maxIter }, [orbit.buffer]);
};
