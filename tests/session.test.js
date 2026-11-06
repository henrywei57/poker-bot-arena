import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../src/sim/session.js';
import { Tournament } from '../src/sim/tournament.js';
import { KickerAgent } from '../src/bots/agent.js';
import { PERSONALITIES } from '../src/bots/personalities.js';

const bot = (i, extra = {}) => {
  const p = PERSONALITIES[i % PERSONALITIES.length];
  return { id: `${p.id}#${i}`, name: `${p.id} ${i}`, kind: 'bot', agent: new KickerAgent(p.code, { seed: `b${i}`, iterations: 40 }), ...extra };
};

test('instant simulation plays exactly the requested number of hands', async () => {
  const s = new GameSession({ mode: 'sim', players: [0, 1, 2, 3].map((i) => bot(i)), sb: 10, bb: 20, startingStack: 2000, handLimit: 120, rebuy: true, speed: 'instant', seed: 'sim' });
  await s.run();
  assert.equal(s.handsPlayed, 120);
  assert.ok(s.finished);
  const rows = s.results();
  assert.equal(rows.length, 4);
  // Net results across players sum to zero (chips only move between them).
  assert.equal(rows.reduce((a, r) => a + r.net, 0), 0);
  const snap = s.snapshot('nobody');
  assert.equal(snap.seats.filter(Boolean).length, 4);
});

test('a human seat waits for input and only accepts its own turn', async () => {
  const me = { id: 'me', name: 'Me', kind: 'human' };
  const s = new GameSession({ mode: 'play', players: [me, bot(1)], sb: 10, bb: 20, startingStack: 1000, rebuy: true, speed: 16, handLimit: 3, seed: 'h', viewerId: 'me' });
  const done = s.run();
  let acted = 0;
  for (let guard = 0; guard < 400 && !s.finished; guard++) {
    await new Promise((r) => setTimeout(r, 5));
    if (s.pending?.playerId === 'me') {
      const snap = s.snapshot('me');
      assert.ok(snap.prompt, 'viewer sees a prompt on their turn');
      assert.equal(s.act('someone-else', { type: 'call' }), false);
      assert.equal(s.act('me', { type: 'call' }), true);
      acted++;
    } else {
      assert.equal(s.snapshot('me').prompt, null);
    }
  }
  await done;
  assert.ok(acted > 0);
  assert.ok(s.log.some((e) => e.kind === 'action' || e.kind === 'minor'), 'actions appear in the log');
  assert.ok(s.log.some((e) => / (calls|checks|folds|raises to|bets) /.test(` ${e.text} `)), 'log describes actions');
  assert.equal(s.handsPlayed, 3);
});

test('opponents hole cards stay hidden from a viewer until showdown', () => {
  const me = { id: 'me', name: 'Me', kind: 'human' };
  const s = new GameSession({ mode: 'play', players: [me, bot(1), bot(2)], sb: 10, bb: 20, startingStack: 1000, seed: 'hide', viewerId: 'me' });
  s.table.startHand();
  const snap = s.snapshot('me');
  for (const seat of snap.seats.filter(Boolean)) {
    if (seat.you) assert.ok(seat.cards.every((c) => c >= 0));
    else assert.deepEqual(seat.cards, [-1, -1]);
  }
  const all = s.snapshot('me', { revealAll: true });
  for (const seat of all.seats.filter(Boolean)) assert.ok(seat.cards.every((c) => c >= 0));
});

test('multi-table tournament runs to a single winner with every place assigned', async () => {
  for (const n of [2, 9, 10, 23]) {
    const entrants = Array.from({ length: n }, (_, i) => bot(i));
    const tour = new Tournament({ entrants, startingStack: 1500, maxPerTable: 9, handsPerLevel: 6, seed: `t${n}` });
    const s = new GameSession({ mode: 'tournament', players: entrants, tournament: tour, speed: 'instant', seed: `t${n}` });
    await s.run();
    assert.ok(tour.isOver(), `tournament of ${n} finished`);
    const places = entrants.map((p) => p.place).sort((a, b) => a - b);
    assert.deepEqual(places, Array.from({ length: n }, (_, i) => i + 1), `places for ${n}`);
    assert.equal(tour.remaining()[0].stack, n * 1500, 'winner holds every chip');
    assert.equal(s.results()[0].place, 1);
  }
});

test('tournament tables stay balanced', () => {
  const entrants = Array.from({ length: 25 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const tour = new Tournament({ entrants, startingStack: 1000, maxPerTable: 9, seed: 'bal' });
  assert.deepEqual(tour.tables.map((t) => t.seats.filter(Boolean).length).sort(), [8, 8, 9]);
  // Bust seven players from one table, then balance.
  let k = 0;
  for (const p of tour.tables[0].seats) if (p && k < 7) { p.stack = 0; k++; }
  tour.endRound();
  const counts = tour.tables.map((t) => t.seats.filter(Boolean).length);
  assert.equal(counts.reduce((a, b) => a + b), 18);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `balanced: ${counts}`);
  assert.equal(tour.tables.length, 2, '18 players fit on two tables');
});
