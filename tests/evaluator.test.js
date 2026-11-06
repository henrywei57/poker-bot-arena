import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, describeScore, bestFive, categoryOf } from '../src/engine/evaluator.js';
import { cardsFromString, newDeck, shuffle } from '../src/engine/cards.js';
import { makeRng } from '../src/util.js';

// An independent, slow 5-card evaluator written differently on purpose:
// it sorts ranks into groups and returns a comparable array.
function slow5(cards) {
  const ranks = cards.map((c) => c >> 2).sort((a, b) => b - a);
  const suits = cards.map((c) => c & 3);
  const flush = suits.every((s) => s === suits[0]);
  const uniq = [...new Set(ranks)];
  let straightHigh = -1;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq.join(',') === '12,3,2,1,0') straightHigh = 3;
  }
  const groups = {};
  for (const r of ranks) groups[r] = (groups[r] || 0) + 1;
  const byGroup = Object.entries(groups).map(([r, n]) => [n, Number(r)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const shape = byGroup.map((g) => g[0]).join('');
  const order = byGroup.map((g) => g[1]);
  if (straightHigh >= 0 && flush) return [8, straightHigh];
  if (shape === '41') return [7, ...order];
  if (shape === '32') return [6, ...order];
  if (flush) return [5, ...ranks];
  if (straightHigh >= 0) return [4, straightHigh];
  if (shape === '311') return [3, ...order];
  if (shape === '221') return [2, ...order];
  if (shape === '2111') return [1, ...order];
  return [0, ...ranks];
}
const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? -1) - (b[i] ?? -1); if (d) return d; } return 0; };
function slowBest7(cards) {
  let best = null;
  for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) {
    const five = cards.filter((_, i) => i !== a && i !== b);
    const v = slow5(five);
    if (!best || cmp(v, best) > 0) best = v;
  }
  return best;
}

test('7-card evaluator agrees with brute force on 20,000 random pairs of hands', () => {
  const rng = makeRng('eval-test');
  for (let i = 0; i < 20000; i++) {
    const d = shuffle(newDeck(), rng);
    const a = d.slice(0, 7), b = d.slice(7, 14);
    const fast = Math.sign(evaluate(a) - evaluate(b));
    const slow = Math.sign(cmp(slowBest7(a), slowBest7(b)));
    if (fast !== slow) assert.fail(`Mismatch on ${a} vs ${b}: fast ${fast} slow ${slow}`);
    assert.equal(categoryOf(evaluate(a)), slowBest7(a)[0]);
  }
});

test('evaluator agrees with brute force on boards built to hit rare hands', () => {
  // Force lots of pairs/trips/flushes by drawing from a tiny pool of ranks or suits.
  const rng = makeRng('rare');
  for (let i = 0; i < 20000; i++) {
    const pool = shuffle(newDeck(), rng).filter((c) => (i % 2 ? (c >> 2) < 6 : (c & 3) < 2));
    const a = pool.slice(0, 7), b = pool.slice(7, 14);
    if (b.length < 7) continue;
    assert.equal(Math.sign(evaluate(a) - evaluate(b)), Math.sign(cmp(slowBest7(a), slowBest7(b))), `${a} vs ${b}`);
  }
});

test('known hands rank and describe correctly', () => {
  const s = (str) => evaluate(cardsFromString(str));
  assert.equal(describeScore(s('As Ks Qs Js Ts 2d 3c')), 'Royal Flush');
  assert.equal(describeScore(s('Ah 2d 3c 4s 5h 9d Kc')), 'Straight, Five high');
  assert.equal(describeScore(s('Kh Kd Kc 7s 7h 2d 3c')), 'Full House, Kings full of Sevens');
  assert.equal(describeScore(s('Kh Kd Kc 7s 7h 7d 3c')), 'Full House, Kings full of Sevens');
  assert.equal(describeScore(s('Qh Qd 9c 9s 4h 4d Ac')), 'Two Pair, Queens and Nines');
  assert.equal(describeScore(s('2h 2d 2c 2s Ah Kd Qc')), 'Four Twos');
  assert.equal(describeScore(s('Ah 9h 7h 4h 2h Kd Qc')), 'Flush, Ace high');
  // The wheel loses to a six-high straight; steel wheel is a straight flush.
  assert.ok(s('Ah 2d 3c 4s 5h 9d Kc') < s('6h 2d 3c 4s 5h 9d Kc'));
  assert.equal(categoryOf(s('Ah 2h 3h 4h 5h 9d Kc')), 8);
  // Third pair can play as the kicker: QQ 99 44 A -> kicker A beats QQ 99 44 3.
  assert.ok(s('Qh Qd 9c 9s 4h 4d Ac') > s('Qh Qd 9c 9s 4h 4d 3c'));
  // Board plays: both players split.
  assert.equal(s('As Ks Qs Js Ts 2d 3c'), s('As Ks Qs Js Ts 4d 5c'));
});

test('bestFive returns the five cards of the best hand', () => {
  const cards = cardsFromString('Ah Kh Qh Jh Th 2c 2d');
  const five = bestFive(cards);
  assert.equal(five.length, 5);
  assert.equal(evaluate(five), evaluate(cards));
  assert.ok(!five.includes(cards[5]));
});
