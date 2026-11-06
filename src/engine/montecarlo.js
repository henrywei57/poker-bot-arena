// Equity estimation: how often a hand wins against random opponent hands.
// Ties count as a fractional win (1 / number of tied players).

import { evaluate } from './evaluator.js';

const hero = new Int32Array(7);
const opp = new Int32Array(7);
const deck = new Int32Array(52);

function buildDeck(hole, board) {
  const dead = new Uint8Array(52);
  for (const c of hole) dead[c] = 1;
  for (const c of board) dead[c] = 1;
  let n = 0;
  for (let c = 0; c < 52; c++) if (!dead[c]) deck[n++] = c;
  return n;
}

/** Monte Carlo equity of `hole` vs `opponents` random hands. */
export function equityMonteCarlo(hole, board, opponents, iterations, rng) {
  if (opponents <= 0) return 1;
  const D = buildDeck(hole, board);
  const boardLen = board.length;
  const need = (5 - boardLen) + opponents * 2;
  hero[0] = hole[0]; hero[1] = hole[1];
  for (let i = 0; i < boardLen; i++) hero[2 + i] = board[i];
  let total = 0;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (D - i));
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    let k = 0;
    for (let i = boardLen; i < 5; i++) hero[2 + i] = deck[k++];
    const hs = evaluate(hero, 7);
    for (let i = 2; i < 7; i++) opp[i] = hero[i];
    let ties = 1, lost = false;
    for (let o = 0; o < opponents; o++) {
      opp[0] = deck[k++]; opp[1] = deck[k++];
      const s = evaluate(opp, 7);
      if (s > hs) { lost = true; break; }
      if (s === hs) ties++;
    }
    if (!lost) total += 1 / ties;
  }
  return total / iterations;
}

/** Exact river equity against one random hand (enumerates all 990 holdings). */
export function equityRiverExact(hole, board) {
  const D = buildDeck(hole, board);
  hero[0] = hole[0]; hero[1] = hole[1];
  for (let i = 0; i < 5; i++) { hero[2 + i] = board[i]; opp[2 + i] = board[i]; }
  const hs = evaluate(hero, 7);
  let total = 0, count = 0;
  for (let a = 0; a < D; a++) {
    for (let b = a + 1; b < D; b++) {
      opp[0] = deck[a]; opp[1] = deck[b];
      const s = evaluate(opp, 7);
      if (s < hs) total += 1; else if (s === hs) total += 0.5;
      count++;
    }
  }
  return total / count;
}
