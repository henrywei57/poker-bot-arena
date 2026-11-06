// Shared helpers with no DOM dependency. The engine, the language and the
// tests all import from here, so keep it plain JavaScript.

/** cyrb128: hashes any string into four 32-bit seeds. */
function hashSeed(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * Seeded random number generator (sfc32). Returns a function that yields
 * floats in [0, 1). The same seed always gives the same sequence, which is
 * what makes simulations reproducible.
 */
export function makeRng(seed) {
  let [a, b, c, d] = hashSeed(String(seed));
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  next.int = (n) => Math.floor(next() * n);
  next.fork = (label) => makeRng(`${seed}::${label}::${next()}`);
  return next;
}

export function randomSeed() {
  return Math.random().toString(36).slice(2, 10);
}

export function randomId(len = 8) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = new Uint8Array(len);
  (globalThis.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  for (let i = 0; i < len; i++) out += abc[bytes[i] % abc.length];
  return out;
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function formatChips(n) {
  if (n == null || Number.isNaN(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(Math.round(n));
  if (v >= 1e6) return sign + (v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace(/\.0+$/, '') + 'M';
  if (v >= 1e5) return sign + (v / 1e3).toFixed(0) + 'K';
  return sign + v.toLocaleString('en-US');
}

/** Edit distance, used for "did you mean" hints in the bot language. */
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function closestName(name, candidates) {
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    const d = levenshtein(name.toLowerCase(), c.toLowerCase());
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
}
