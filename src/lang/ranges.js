// Hand range notation, e.g. "TT+, AJs+, KQo, 76s-54s, A5s-A2s, Ax s".
//   AA        one pocket pair         TT+      tens or better
//   22-66     pairs from 22 to 66     AKs      suited only
//   AKo       offsuit only            AK       suited and offsuit
//   ATs+      ATs, AJs, AQs, AKs      KTo-K7o  that run of offsuit kings
//   Axs       any suited ace          Kx       any king
//   87s-54s   suited connectors from 87s down to 54s

const R = '23456789TJQKA';
const ri = (ch) => R.indexOf(ch.toUpperCase());
const cache = new Map();

function classOf(a, b, kind) {
  if (a === b) return R[a] + R[b];
  if (a < b) { const t = a; a = b; b = t; }
  return R[a] + R[b] + kind;
}

function addHand(set, a, b, kinds) {
  if (a === b) { set.add(R[a] + R[b]); return; }
  for (const k of kinds) set.add(classOf(a, b, k));
}

function parseToken(tok, set) {
  const t = tok.replace(/\s+/g, '');
  let m;
  // Pairs: 77, 77+, 22-55
  if ((m = /^([2-9TJQKA])\1(\+)?$/i.exec(t))) {
    const r = ri(m[1]);
    for (let x = r; x <= (m[2] ? 12 : r); x++) set.add(R[x] + R[x]);
    return;
  }
  if ((m = /^([2-9TJQKA])\1-([2-9TJQKA])\2$/i.exec(t))) {
    const a = ri(m[1]), b = ri(m[2]);
    for (let x = Math.min(a, b); x <= Math.max(a, b); x++) set.add(R[x] + R[x]);
    return;
  }
  // Wildcard kicker: Ax, Axs, Kxo
  if ((m = /^([2-9TJQKA])x([so])?$/i.exec(t))) {
    const a = ri(m[1]);
    const kinds = m[2] ? [m[2].toLowerCase()] : ['s', 'o'];
    for (let b = 0; b < 13; b++) if (b !== a) addHand(set, a, b, kinds);
    return;
  }
  // Ranges of non-pairs: AKs-ATs, 87s-54s
  if ((m = /^([2-9TJQKA])([2-9TJQKA])([so])?-([2-9TJQKA])([2-9TJQKA])([so])?$/i.exec(t))) {
    let [a1, b1, a2, b2] = [ri(m[1]), ri(m[2]), ri(m[4]), ri(m[5])];
    if (a1 < b1) [a1, b1] = [b1, a1];
    if (a2 < b2) [a2, b2] = [b2, a2];
    if (a1 === b1 || a2 === b2) throw new Error(`"${tok}" mixes pairs and non-pairs`);
    const k1 = (m[3] || '').toLowerCase(), k2 = (m[6] || '').toLowerCase();
    if (k1 !== k2) throw new Error(`"${tok}": both ends need the same s/o suffix`);
    const kinds = k1 ? [k1] : ['s', 'o'];
    if (a1 === a2) {
      for (let b = Math.min(b1, b2); b <= Math.max(b1, b2); b++) addHand(set, a1, b, kinds);
    } else if (a1 - b1 === a2 - b2) {
      const gap = a1 - b1;
      for (let a = Math.min(a1, a2); a <= Math.max(a1, a2); a++) addHand(set, a, a - gap, kinds);
    } else {
      throw new Error(`"${tok}": a range needs the same top card (AKs-ATs) or the same gap (87s-54s)`);
    }
    return;
  }
  // Single non-pair, optionally with +: AK, AKs, ATo+
  if ((m = /^([2-9TJQKA])([2-9TJQKA])([so])?(\+)?$/i.exec(t))) {
    let a = ri(m[1]), b = ri(m[2]);
    if (a < b) [a, b] = [b, a];
    const kinds = m[3] ? [m[3].toLowerCase()] : ['s', 'o'];
    if (m[4]) for (let x = b; x < a; x++) addHand(set, a, x, kinds);
    else addHand(set, a, b, kinds);
    return;
  }
  throw new Error(`"${tok}" is not a hand or range. Examples: AA, TT+, AKs, ATo+, 87s-54s, Axs`);
}

/** Parse a range string into a Set of hand classes. Throws on bad syntax. */
export function parseRange(str) {
  if (cache.has(str)) return cache.get(str);
  const set = new Set();
  const parts = String(str).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Empty hand range');
  for (const p of parts) parseToken(p, set);
  cache.set(str, set);
  return set;
}

export const HAND_CLASS_RE = /^[2-9TJQKA]{2}[so]?$/;
export const looksLikeRange = (s) => /^[\s2-9TJQKAtjqkaxXsSoO+,;-]+$/.test(s) && /[2-9TJQKAtjqka]/.test(s);
