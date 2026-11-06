import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../src/engine/table.js';
import { resolveIntent } from '../src/engine/actions.js';
import { cardFromString, newDeck } from '../src/engine/cards.js';
import { makeRng } from '../src/util.js';

function makeTable(stacks, { sb = 10, bb = 20, ante = 0, seed = 't', button } = {}) {
  const t = new Table({ maxSeats: Math.max(stacks.length, 2), smallBlind: sb, bigBlind: bb, ante, rng: makeRng(seed) });
  stacks.forEach((s, i) => { if (s != null) t.sit(i, { id: `p${i}`, name: `P${i}`, stack: s }); });
  if (button != null) {
    // startHand moves the button to the next active seat, so park it one seat earlier.
    const active = t.activeSeats();
    const k = active.indexOf(button);
    t.button = active[(k - 1 + active.length) % active.length];
  }
  return t;
}

/**
 * Build a deck so that dealt hands come out as asked. `holes` is indexed by
 * the hand's player order (seat order); dealing starts left of the button.
 */
function stackDeck(hand0Order, buttonIdx, holes, board) {
  const n = hand0Order;
  const want = [];
  const start = (buttonIdx + 1) % n;
  const seq = [];
  for (let r = 0; r < 2; r++) for (let k = 0; k < n; k++) seq.push(holes[(start + k) % n][r]);
  const b = board.map(cardFromString);
  // burn, flop x3, burn, turn, burn, river
  const used = new Set([...seq.map(cardFromString), ...b]);
  const spare = newDeck().filter((c) => !used.has(c));
  want.push(...seq.map(cardFromString));
  want.push(spare.pop(), b[0], b[1], b[2], spare.pop(), b[3], spare.pop(), b[4]);
  return [...want, ...spare];
}

const totalChips = (t) => t.seats.reduce((s, p) => s + (p ? p.stack : 0), 0);

function playOut(hand, script) {
  // script: array of [type, amount?]; then everyone checks/calls to the end
  let k = 0;
  while (!hand.done) {
    if (hand.phase === 'roundEnd') { hand.advance(); continue; }
    const step = script[k++];
    if (step) hand.act(step[0], step[1]);
    else { const L = hand.legal(); hand.act(L.toCall ? 'call' : 'check'); }
  }
}

test('random play: chips are conserved and every hand finishes (up to 30,000 hands)', () => {
  const rng = makeRng('fuzz');
  for (let g = 0; g < 1500; g++) {
    const n = 2 + rng.int(8);
    const stacks = Array.from({ length: n }, () => (rng() < 0.25 ? 1 + rng.int(60) : 50 + rng.int(3000)));
    const t = makeTable(stacks, { ante: rng() < 0.3 ? 5 : 0, seed: `g${g}` });
    const start = totalChips(t);
    for (let h = 0; h < 20 && t.canDeal(); h++) {
      const hand = t.startHand();
      let steps = 0;
      while (!hand.done) {
        assert.ok(steps++ < 500, 'hand did not terminate');
        if (hand.phase === 'roundEnd') { hand.advance(); continue; }
        const L = hand.legal();
        assert.ok(L.toCall >= 0 && L.minRaiseTo <= L.maxRaiseTo);
        const r = rng();
        const intent = r < 0.15 ? { type: 'fold' } : r < 0.55 ? { type: 'call' } : r < 0.65 ? { type: 'allin' }
          : { type: 'raise', unit: 'chips', value: L.minRaiseTo + rng.int(Math.max(1, L.maxRaiseTo - L.minRaiseTo + 1)) };
        const a = resolveIntent(intent, L, { freeFold: rng() < 0.1 });
        hand.act(a.type, a.amount);
        for (const p of hand.players) assert.ok(p.stack >= 0 && Number.isInteger(p.stack));
      }
      const pots = hand.pots.reduce((s, p) => s + p.amount, 0);
      assert.equal(pots, hand.potTotal(), 'pots must add up to all contributions');
      assert.equal(totalChips(t), start, `chips changed in game ${g} hand ${h}`);
    }
  }
});

test('heads-up: button posts small blind, acts first preflop and last after the flop', () => {
  const t = makeTable([1000, 1000], { button: 0 });
  const h = t.startHand();
  assert.equal(h.players[h.buttonIdx].seat, 0);
  assert.equal(h.players[h.sbIdx].seat, 0);
  assert.equal(h.players[h.bbIdx].seat, 1);
  assert.equal(h.actor.seat, 0, 'button acts first preflop');
  h.act('call');
  assert.equal(h.actor.seat, 1, 'big blind gets the option');
  assert.equal(h.legal().canRaise, true);
  h.act('check');
  h.advance();
  assert.equal(h.street, 'flop');
  assert.equal(h.actor.seat, 1, 'big blind acts first after the flop');
});

test('three-handed blinds and preflop order', () => {
  const t = makeTable([1000, 1000, 1000], { button: 0 });
  const h = t.startHand();
  assert.equal(h.players[h.sbIdx].seat, 1);
  assert.equal(h.players[h.bbIdx].seat, 2);
  assert.equal(h.actor.seat, 0, 'button is first to act three-handed');
  const t2 = t.startHand.bind(t);
  playOut(h, [['fold'], ['fold']]);
  assert.equal(t.seats[2].stack, 1010, 'big blind wins the small blind');
  const h2 = t2();
  assert.equal(h2.players[h2.buttonIdx].seat, 1, 'button moves one seat');
});

test('minimum raise is the size of the last full raise', () => {
  const t = makeTable([5000, 5000, 5000], { button: 0 });
  const h = t.startHand();
  let L = h.legal();
  assert.equal(L.minRaiseTo, 40);
  h.act('raise', 60); // raise of 40
  L = h.legal();
  assert.equal(L.minRaiseTo, 100);
  assert.throws(() => h.act('raise', 90));
  h.act('raise', 250); // raise of 190
  assert.equal(h.legal().minRaiseTo, 440);
});

test('all-in for less than a full raise does not reopen betting', () => {
  // Seat 0 button opens to 100, seat 1 (SB) shoves 130 total: only 30 more.
  const t = makeTable([5000, 130, 5000], { button: 0 });
  const h = t.startHand();
  h.act('raise', 100);
  let L = h.legal();
  assert.equal(L.seat, 1);
  h.act('raise', 130); // all-in short raise
  L = h.legal();
  assert.equal(L.seat, 2, 'big blind has not acted, so may raise');
  assert.equal(L.canRaise, true);
  assert.equal(L.minRaiseTo, 210, 'min raise = 130 + last full raise (80)');
  h.act('call');
  L = h.legal();
  assert.equal(L.seat, 0);
  assert.equal(L.toCall, 30);
  assert.equal(L.canRaise, false, 'the opener may only call or fold');
});

test('short all-ins that add up to a full raise do reopen betting', () => {
  // Flop: P0 bets 100. P1 all-in 150, P2 all-in 210 (total +110 over 100) -> P0 may raise.
  const t = makeTable([5000, 170, 230, 5000], { button: 3 });
  const h = t.startHand();
  // preflop: P1 is SB? button 3 -> SB 0, BB 1, first P2
  h.act('call'); h.act('call'); h.act('call'); h.act('check');
  h.advance();
  assert.equal(h.street, 'flop');
  assert.equal(h.actor.seat, 0);
  h.act('raise', 100);
  h.act('raise', 150); // P1 all-in (stack 150 left)
  assert.equal(h.players[1].allIn, true);
  h.act('raise', 210); // P2 all-in
  h.act('call'); // P3
  const L = h.legal();
  assert.equal(L.seat, 0);
  assert.equal(L.canRaise, true, '150 + 60 = 110 more than P0 bet, at least a full raise of 100');
});

test('nobody can raise when every other player is all-in', () => {
  const t = makeTable([300, 5000], { button: 0 });
  const h = t.startHand();
  h.act('raise', 300); // button all-in
  const L = h.legal();
  assert.equal(L.canRaise, false);
  assert.equal(L.toCall, 280);
  assert.deepEqual(resolveIntent({ type: 'allin' }, L), { type: 'call' });
});

test('short big blind: others still owe a full big blind', () => {
  const t = makeTable([1000, 1000, 5], { button: 0 });
  const h = t.startHand();
  const L = h.legal();
  assert.equal(L.seat, 0);
  assert.equal(L.toCall, 20);
  assert.equal(L.minRaiseTo, 40);
});

test('heads-up short big blind: small blind is not asked to act on a dead bet', () => {
  const t = makeTable([1000, 5], { button: 0 });
  const h = t.startHand();
  assert.equal(h.phase, 'roundEnd', 'BB is all-in for less than the SB posted');
  playOut(h, []);
  assert.equal(totalChips(t), 1005);
});

test('side pots: three all-ins at different sizes', () => {
  // Order by seat: P0 100, P1 300, P2 500. Button P0 -> SB P1, BB P2.
  const holes = [['As', 'Ah'], ['Ks', 'Kh'], ['Qs', 'Qh']];
  const deck = stackDeck(3, 0, holes, ['2c', '7d', '9h', 'Jc', '3s']);
  const t = makeTable([100, 300, 500], { button: 0 });
  const h = t.startHand({ deck });
  h.act('raise', 100); // P0 all-in
  h.act('raise', 300); // P1 all-in
  assert.equal(h.legal().canRaise, false, 'both opponents are all-in');
  h.act('call'); // P2 calls 300 and keeps 200 behind
  playOut(h, []);
  // main 300 -> AA, side (300-100)*2 = 400 -> KK
  assert.deepEqual(h.pots.map((p) => p.amount), [300, 400]);
  assert.equal(t.seats[0].stack, 300);
  assert.equal(t.seats[1].stack, 400);
  assert.equal(t.seats[2].stack, 200);
});

test('an uncalled part of a bet is returned when the round closes', () => {
  const t = makeTable([5000, 300], { button: 0 });
  const h = t.startHand();
  h.act('raise', 1000);
  h.act('call'); // all-in for 300 total
  const refund = h.events.find((e) => e.type === 'refund');
  assert.deepEqual([refund.seat, refund.amount], [0, 700]);
  assert.equal(h.potTotal(), 600);
  playOut(h, []);
  assert.equal(totalChips(t), 5300);
});

test('split pot with an odd chip goes to the first winner left of the button', () => {
  // Board plays a straight; both players split. SB posts 5 so the pot is odd: 5 + 10 + ante 0... use 3 players.
  const holes = [['2c', '3d'], ['2d', '3c'], ['4h', '4d']];
  const deck = stackDeck(3, 0, holes, ['Ts', 'Js', 'Qd', 'Kh', 'Ac']);
  const t = makeTable([1000, 1000, 1000], { sb: 5, bb: 10, button: 0 });
  const h = t.startHand({ deck });
  h.act('call'); // P0 calls 10
  h.act('fold'); // P1 SB folds its 5
  h.act('check'); // P2 BB
  playOut(h, []);
  // Pot is 25: everyone has the board straight, P0 and P2 split 12/13.
  // First winner left of the button (P0) is P2.
  assert.equal(t.seats[2].stack, 1000 - 10 + 13);
  assert.equal(t.seats[0].stack, 1000 - 10 + 12);
});

test('everyone folds to the big blind: uncalled chips go back and the blind wins', () => {
  const t = makeTable([1000, 1000, 1000, 1000], { button: 0, ante: 5 });
  const h = t.startHand();
  h.act('fold'); h.act('fold'); h.act('fold');
  assert.equal(h.phase, 'roundEnd');
  h.advance();
  assert.ok(h.done);
  // BB (seat 2) wins SB 10 + 4 antes
  assert.equal(t.seats[2].stack, 1000 + 10 + 15);
  assert.equal(totalChips(t), 4000);
});

test('players all-in preflop run the board out with no more betting', () => {
  const t = makeTable([500, 500], { button: 0 });
  const h = t.startHand();
  h.act('raise', 500);
  h.act('call');
  assert.equal(h.phase, 'roundEnd');
  const streets = [];
  while (!h.done) { h.advance(); if (!h.done) { streets.push(h.street); assert.equal(h.phase, 'roundEnd'); } }
  assert.deepEqual(streets, ['flop', 'turn', 'river']);
  assert.equal(h.board.length, 5);
  assert.equal(totalChips(t), 1000);
});

test('busted players are skipped and the button skips empty seats', () => {
  const t = makeTable([1000, null, 0, 1000, 1000], { button: 0 });
  assert.deepEqual(t.activeSeats(), [0, 3, 4]);
  const h = t.startHand();
  assert.equal(h.n, 3);
  assert.equal(h.players[h.buttonIdx].seat, 0);
  assert.equal(h.players[h.sbIdx].seat, 3);
});

test('action events keep type "action" and record what was done', () => {
  const t = makeTable([1000, 1000, 1000], { button: 0 });
  const h = t.startHand();
  h.act('raise', 60);
  h.act('call');
  h.act('fold');
  const acts = h.events.filter((e) => e.type === 'action');
  assert.deepEqual(acts.map((e) => e.action), ['raise', 'call', 'fold']);
  assert.deepEqual(acts.map((e) => e.seat), [0, 1, 2]);
  assert.equal(acts[0].to, 60);
  assert.equal(acts[1].amount, 50);
});

test('display pots ignore uncalled bets and only split when someone is all-in', () => {
  const t = makeTable([1000, 1000, 1000], { button: 0 });
  const h = t.startHand();
  h.act('call'); h.act('call'); h.act('check');
  h.advance(); // flop, pot 60
  h.act('raise', 40); // bet in front of a player, not yet collected
  assert.deepEqual(h.computePots(true).map((p) => p.amount), [60]);
  assert.deepEqual(h.computePots().map((p) => p.amount), [60, 40]);
});
