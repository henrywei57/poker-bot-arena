// Hand-strength helpers the bots use: preflop lookups, Monte Carlo equity
// after the flop, the Chen formula and board/draw analysis.

import { handClass, RANKS } from './cards.js';
import { evaluate, STRAIGHT_HIGH, CATEGORY_KEYS } from './evaluator.js';
import { equityMonteCarlo, equityRiverExact } from './montecarlo.js';
import { PREFLOP_EQUITY, TOP_PCT } from './preflop-table.js';

export { PREFLOP_EQUITY, TOP_PCT };

export function preflopEquity(hole, opponents) {
  const opp = Math.max(1, Math.min(8, opponents));
  return PREFLOP_EQUITY[handClass(hole[0], hole[1])][opp - 1];
}

export function topPct(hole) {
  return TOP_PCT[handClass(hole[0], hole[1])];
}

/** Win probability against `opponents` random hands. */
export function equity(hole, board, opponents, iterations, rng) {
  if (opponents <= 0) return 1;
  if (board.length === 0) return preflopEquity(hole, opponents);
  if (board.length === 5 && opponents === 1) return equityRiverExact(hole, board);
  return equityMonteCarlo(hole, board, opponents, iterations, rng);
}

/** Bill Chen's starting-hand score (-1 .. 20). */
export function chenScore(hole) {
  const r1 = Math.max(hole[0] >> 2, hole[1] >> 2);
  const r2 = Math.min(hole[0] >> 2, hole[1] >> 2);
  const pts = (r) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
  let score = pts(r1);
  if (r1 === r2) return Math.max(5, score * 2);
  if ((hole[0] & 3) === (hole[1] & 3)) score += 2;
  const gap = r1 - r2 - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && r1 < 10) score += 1;
  return Math.ceil(score);
}

function rankMaskOf(cards) {
  let m = 0;
  for (const c of cards) m |= 1 << (c >> 2);
  return m;
}

/** Ranks (0..12) that would complete a straight that is not already made. */
function straightOuts(cards) {
  const mask = rankMaskOf(cards);
  if (STRAIGHT_HIGH[mask] >= 0) return [];
  const outs = [];
  for (let r = 0; r < 13; r++) {
    if (!(mask & (1 << r)) && STRAIGHT_HIGH[mask | (1 << r)] >= 0) outs.push(r);
  }
  return outs;
}

/**
 * Everything the bot language knows about the current made hand and board.
 * Works preflop too (made = pair for pocket pairs, no draws).
 */
export function analyzeHand(hole, board) {
  const all = [...hole, ...board];
  const hr = [hole[0] >> 2, hole[1] >> 2];
  const pocketPair = hr[0] === hr[1];
  const out = {
    madeRank: pocketPair ? 1 : 0, boardRank: 0, hit: pocketPair,
    topPair: false, overpair: false, flushDraw: false, straightDraw: false, gutshot: false,
    outs: 0, boardPaired: false, boardFlushy: false, boardConnected: false, boardHigh: 0,
    score: 0,
  };
  if (board.length < 3) return out;
  const score = evaluate(all);
  out.score = score;
  out.madeRank = score >> 20;
  out.boardRank = evaluate(board) >> 20;
  out.hit = out.madeRank > out.boardRank;
  const boardRanks = board.map((c) => c >> 2);
  const top = Math.max(...boardRanks);
  out.boardHigh = top + 2;
  out.topPair = !pocketPair && (hr[0] === top || hr[1] === top);
  out.overpair = pocketPair && hr[0] > top;
  out.boardPaired = new Set(boardRanks).size < boardRanks.length;
  const suitCounts = [0, 0, 0, 0];
  for (const c of board) suitCounts[c & 3]++;
  out.boardFlushy = Math.max(...suitCounts) >= 3;
  const bm = rankMaskOf(board);
  const bmLow = (bm << 1) | ((bm >> 12) & 1);
  for (let lo = 0; lo <= 9; lo++) {
    let k = 0;
    for (let b = lo; b < lo + 5; b++) if (bmLow & (1 << b)) k++;
    if (k >= 3) { out.boardConnected = true; break; }
  }
  if (board.length < 5) {
    if (out.madeRank < 5) {
      const all4 = [0, 0, 0, 0];
      for (const c of all) all4[c & 3]++;
      for (let s = 0; s < 4; s++) {
        if (all4[s] === 4 && ((hole[0] & 3) === s || (hole[1] & 3) === s)) out.flushDraw = true;
      }
    }
    if (out.madeRank < 4) {
      const mine = straightOuts(all);
      const boards = new Set(straightOuts(board));
      const own = mine.filter((r) => !boards.has(r));
      if (own.length >= 2) out.straightDraw = true;
      else if (own.length === 1) out.gutshot = true;
      out.outs = (out.flushDraw ? 9 : 0) + own.length * 4 - (out.flushDraw && own.length ? own.length : 0);
    } else if (out.flushDraw) {
      out.outs = 9;
    }
  }
  return out;
}

export const madeName = (rank) => CATEGORY_KEYS[rank];
export const rankChar = (r) => RANKS[r];
