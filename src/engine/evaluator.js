// Fast 5-to-7 card poker hand evaluator.
//
// evaluate(cards) returns an integer score; a higher score is a better hand
// and equal scores tie. Layout: category << 20 | five 4-bit rank nibbles.
// Categories: 0 high card, 1 pair, 2 two pair, 3 trips, 4 straight,
// 5 flush, 6 full house, 7 quads, 8 straight flush.

import { RANK_NAMES, RANK_PLURALS } from './cards.js';

export const CATEGORY_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];
/** Lower-case names the bot language exposes through `made`. */
export const CATEGORY_KEYS = [
  'high card', 'pair', 'two pair', 'trips', 'straight',
  'flush', 'full house', 'quads', 'straight flush',
];

// STRAIGHT_HIGH[rankMask] = rank index of the top card of the best straight
// in a 13-bit rank mask, or -1. The ace also plays low (A-2-3-4-5).
export const STRAIGHT_HIGH = new Int8Array(8192).fill(-1);
for (let mask = 0; mask < 8192; mask++) {
  const bits = (mask << 1) | ((mask >> 12) & 1); // bit 0 = low ace
  for (let hi = 12; hi >= 3; hi--) {
    const w = 0x1f << (hi - 3);
    if ((bits & w) === w) { STRAIGHT_HIGH[mask] = hi; break; }
  }
}

const counts = new Int8Array(13);
const suitCount = new Int8Array(4);
const suitMask = new Int32Array(4);

/** Packs up to `num` highest ranks present (excluding two ranks) as nibbles. */
function kickers(exA, exB, num) {
  let v = 0, got = 0;
  for (let r = 12; r >= 0 && got < num; r--) {
    if (r !== exA && r !== exB && counts[r] > 0) { v = (v << 4) | r; got++; }
  }
  return v << (4 * (num - got));
}

export function evaluate(cards, n = cards.length) {
  counts.fill(0); suitCount.fill(0); suitMask.fill(0);
  let rankMask = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const r = c >> 2, s = c & 3;
    counts[r]++; suitCount[s]++;
    suitMask[s] |= 1 << r;
    rankMask |= 1 << r;
  }
  let flush = -1;
  for (let s = 0; s < 4; s++) if (suitCount[s] >= 5) flush = s;
  if (flush >= 0) {
    const sf = STRAIGHT_HIGH[suitMask[flush]];
    if (sf >= 0) return (8 << 20) | (sf << 16);
  }
  let quad = -1, t1 = -1, t2 = -1, p1 = -1, p2 = -1;
  for (let r = 12; r >= 0; r--) {
    const k = counts[r];
    if (k === 4) quad = r;
    else if (k === 3) { if (t1 < 0) t1 = r; else if (t2 < 0) t2 = r; }
    else if (k === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
  }
  if (quad >= 0) return (7 << 20) | (quad << 16) | (kickers(quad, -1, 1) << 12);
  if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) {
    return (6 << 20) | (t1 << 16) | (Math.max(t2, p1) << 12);
  }
  if (flush >= 0) {
    const m = suitMask[flush];
    let v = 0, got = 0;
    for (let r = 12; r >= 0 && got < 5; r--) if (m & (1 << r)) { v = (v << 4) | r; got++; }
    return (5 << 20) | v;
  }
  const st = STRAIGHT_HIGH[rankMask];
  if (st >= 0) return (4 << 20) | (st << 16);
  if (t1 >= 0) return (3 << 20) | (t1 << 16) | (kickers(t1, -1, 2) << 8);
  if (p2 >= 0) return (2 << 20) | (p1 << 16) | (p2 << 12) | (kickers(p1, p2, 1) << 8);
  if (p1 >= 0) return (1 << 20) | (p1 << 16) | (kickers(p1, -1, 3) << 4);
  return kickers(-1, -1, 5);
}

export const categoryOf = (score) => score >> 20;

/** Human-readable description, e.g. "Two Pair, Kings and Sevens". */
export function describeScore(score) {
  const cat = score >> 20;
  const r = (i) => (score >> (16 - 4 * i)) & 15;
  switch (cat) {
    case 8: return r(0) === 12 ? 'Royal Flush' : `Straight Flush, ${RANK_NAMES[r(0)]} high`;
    case 7: return `Four ${RANK_PLURALS[r(0)]}`;
    case 6: return `Full House, ${RANK_PLURALS[r(0)]} full of ${RANK_PLURALS[r(1)]}`;
    case 5: return `Flush, ${RANK_NAMES[r(0)]} high`;
    case 4: return `Straight, ${RANK_NAMES[r(0)]} high`;
    case 3: return `Three ${RANK_PLURALS[r(0)]}`;
    case 2: return `Two Pair, ${RANK_PLURALS[r(0)]} and ${RANK_PLURALS[r(1)]}`;
    case 1: return `Pair of ${RANK_PLURALS[r(0)]}`;
    default: return `${RANK_NAMES[r(0)]} High`;
  }
}

/** The five cards that make the best hand (used to highlight winners). */
export function bestFive(cards) {
  if (cards.length <= 5) return cards.slice();
  let best = -1, bestCombo = null;
  const n = cards.length, pick = [0, 0, 0, 0, 0];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
    for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
      pick[0] = cards[a]; pick[1] = cards[b]; pick[2] = cards[c]; pick[3] = cards[d]; pick[4] = cards[e];
      const s = evaluate(pick, 5);
      if (s > best) { best = s; bestCombo = pick.slice(); }
    }
  return bestCombo;
}
