import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, KickerBot } from '../src/lang/interpreter.js';
import { parseRange } from '../src/lang/ranges.js';
import { lex } from '../src/lang/lexer.js';
import { PERSONALITIES, STARTER_BOT } from '../src/bots/personalities.js';
import { KickerAgent } from '../src/bots/agent.js';
import { Table } from '../src/engine/table.js';
import { buildView } from '../src/engine/view.js';
import { cardsFromString } from '../src/engine/cards.js';
import { playHandSync } from '../src/sim/headless.js';
import { StatsTracker } from '../src/sim/stats.js';
import { makeRng } from '../src/util.js';

/** A decision spot: heads-up, hero on the button facing nothing preflop. */
function spot({ hole = 'As Kd', board = '', toCall = 0, pot = 30, street = 'preflop', stack = 1000 } = {}) {
  const b = board ? cardsFromString(board) : [];
  return {
    handNumber: 1, street, hole: cardsFromString(hole), board: b,
    idx: 0, seat: 0, n: 2, buttonIdx: 0, sbIdx: 0, bbIdx: 1,
    legal: { toCall, canCheck: toCall === 0, canRaise: true, minRaiseTo: 40, maxRaiseTo: stack, currentBet: toCall, streetBet: 0, stack, pot, bb: 20, sb: 10 },
    sb: 10, bb: 20, ante: 0, raises: toCall ? 1 : 0,
    aggressor: { preflop: -1, flop: -1, turn: -1, river: -1 }, actions: [],
    players: [
      { idx: 0, seat: 0, id: 'a', name: 'A', stack, streetBet: 0, totalBet: 0, folded: false, allIn: false, stats: null },
      { idx: 1, seat: 1, id: 'b', name: 'B', stack: 1000, streetBet: toCall, totalBet: toCall, folded: false, allIn: false, stats: null },
    ],
  };
}

function decide(src, view = spot()) {
  const c = compile(src);
  if (!c.ok) assert.fail(`compile failed: ${JSON.stringify(c.errors)}`);
  return new KickerBot(c, { seed: 'x' }).decide(view);
}

test('every built-in personality and the starter bot compile', () => {
  for (const p of [...PERSONALITIES, { id: 'starter', code: STARTER_BOT }]) {
    const c = compile(p.code);
    assert.ok(c.ok, `${p.id}: ${JSON.stringify(c.errors)}`);
    assert.ok(c.meta.name, `${p.id} has a name`);
  }
});

test('all personalities play 3,000 hands against each other without a single runtime error', () => {
  const rng = makeRng('arena');
  const table = new Table({ maxSeats: 8, smallBlind: 10, bigBlind: 20, rng });
  const agents = new Map();
  PERSONALITIES.forEach((p, i) => {
    table.sit(i, { id: p.id, name: p.id, stack: 2000 });
    agents.set(p.id, new KickerAgent(p.code, { seed: `s${i}`, iterations: 60 }));
  });
  const stats = new StatsTracker();
  const errors = [];
  let total = 0;
  for (let h = 0; h < 3000; h++) {
    for (const s of table.seats) if (s && s.stack === 0) s.stack = 2000; // rebuy
    total = table.seats.reduce((a, s) => a + s.stack, 0);
    playHandSync(table, (id) => agents.get(id), { stats, onDecision: (p, d) => { if (d.error) errors.push(`${p.id}: ${d.error.message} (line ${d.error.line})`); } });
    assert.equal(table.seats.reduce((a, s) => a + s.stack, 0), total);
  }
  assert.deepEqual(errors.slice(0, 5), []);
  // Personalities should actually differ: the maniac plays far more hands than the rock.
  assert.ok(stats.get('maniac').vpip > stats.get('rock').vpip + 0.2, `maniac ${stats.get('maniac').vpip} rock ${stats.get('rock').vpip}`);
});

test('first action reached wins; no action means check-or-fold', () => {
  assert.deepEqual(decide('call\nfold').intent, { type: 'call' });
  assert.equal(decide('let x = 1').defaulted, true);
  assert.deepEqual(decide('when false then raise pot\nwhen true then fold').intent, { type: 'fold' });
});

test('raise sizes parse into units', () => {
  const size = (s) => decide(s).intent;
  assert.deepEqual(size('raise 3 bb'), { type: 'raise', unit: 'bb', value: 3 });
  assert.deepEqual(size('raise 75% pot'), { type: 'raise', unit: 'pot', value: 0.75 });
  assert.deepEqual(size('bet pot'), { type: 'raise', unit: 'pot', value: 1 });
  assert.deepEqual(size('raise 2.5x'), { type: 'raise', unit: 'x', value: 2.5 });
  assert.deepEqual(size('raise to 300'), { type: 'raise', unit: 'chips', value: 300 });
  assert.deepEqual(size('raise min'), { type: 'raise', unit: 'min', value: 0 });
  assert.deepEqual(size('raise max'), { type: 'raise', unit: 'max', value: 0 });
  assert.deepEqual(size('raise 2 + 1 bb'), { type: 'raise', unit: 'bb', value: 3 });
  assert.deepEqual(size('raise bb * 4'), { type: 'raise', unit: 'chips', value: 80 });
  assert.deepEqual(size('raise min(3, 5) bb'), { type: 'raise', unit: 'bb', value: 3 });
  assert.deepEqual(size('raise'), { type: 'raise', unit: 'min', value: 0 });
});

test('if / elif / else, one-line if, and street blocks', () => {
  const src = `
    on preflop
      if high == 14 then
        if suited then raise 3 bb else call end
      elif pocket_pair
        fold
      else
        check
      end
    end
    on postflop: fold end`;
  assert.deepEqual(decide(src, spot({ hole: 'As Kd' })).intent, { type: 'call' });
  assert.deepEqual(decide(src, spot({ hole: 'As Ks' })).intent.unit, 'bb');
  assert.deepEqual(decide(src, spot({ hole: '9s 9d' })).intent, { type: 'fold' });
  assert.deepEqual(decide(src, spot({ hole: '9s 8d' })).intent, { type: 'check' });
  assert.deepEqual(decide(src, spot({ hole: '9s 8d', board: '2c 3d 4h', street: 'flop' })).intent, { type: 'fold' });
});

test('expressions: arithmetic, chained comparisons, percent, in, strings', () => {
  const val = (expr, v) => decide(`let r = ${expr}\nwhen r then call`, v).intent.type === 'call';
  assert.ok(val('1 + 2 * 3 == 7'));
  assert.ok(val('(1 + 2) * 3 == 9'));
  assert.ok(val('10 / 0 == 0'));
  assert.ok(val('0.2 < 30% < 0.4'));
  assert.ok(!val('1 < 3 < 2'));
  assert.ok(val('hand == "AKo"'));
  assert.ok(val('hand in "AQo+"'));
  assert.ok(val('hand not in "TT+, AKs"'));
  assert.ok(val('3 in [1, 2, 3]'));
  assert.ok(val('"ok" + 1 == "ok1"'));
  assert.ok(val('not false and (true or false)'));
  assert.ok(val('mod(7, 3) == 1 and round(2.567, 2) == 2.57 and clamp(5, 0, 3) == 3'));
  assert.ok(val('top(5) and top_pct < 5'));
  assert.ok(val('high == 14 and low == 13 and connected and gap == 0'));
});

test('board analysis built-ins', () => {
  const flop = (hole, board) => spot({ hole, board, street: 'flop' });
  const is = (expr, v) => decide(`when ${expr} then call`, v).intent.type === 'call';
  assert.ok(is('top_pair and hit and made == "pair"', flop('As 7d', 'Ah 9c 2d')));
  assert.ok(is('overpair and not top_pair', flop('Qs Qd', 'Jh 9c 2d')));
  assert.ok(is('flush_draw and draw and outs >= 9', flop('As 7s', 'Ks 9s 2d')));
  assert.ok(is('straight_draw and not gutshot', flop('8s 7d', '6h 5c Kd')));
  assert.ok(is('gutshot and not straight_draw', flop('8s 7d', '5h 4c Kd')));
  assert.ok(is('board_paired and not hit and made_rank == 1', flop('As Kd', '9h 9c 2d')));
  assert.ok(is('made == "full house" and hit', flop('9s 2s', '9h 9c 2d')));
  assert.ok(is('board_flushy and board_high == 13', flop('As Kd', 'Kh 9h 2h')));
  assert.ok(is('equity > 0.9 and strength > 0.9', flop('As Ad', 'Ah Ac 2d')));
});

test('keep variables persist between decisions; let does not', () => {
  const c = compile('keep n = 0\nn = n + 1\nlet t = 5\nt = t + 1\nlog n + "/" + t\ncall');
  const bot = new KickerBot(c, { seed: 'k' });
  bot.decide(spot());
  bot.decide(spot());
  const r = bot.decide(spot());
  assert.equal(r.logs[0].text, '3/6');
});

test('say and log are captured', () => {
  const r = decide('say "Hello " + hand\nlog pot\ncall');
  assert.equal(r.said, 'Hello AKo');
  assert.equal(r.logs[0].text, '30');
});

test('compile errors point at the line and suggest fixes', () => {
  const err = (src) => { const c = compile(src); assert.equal(c.ok, false, src); return c.errors[0]; };
  let e = err('when strenght > 0.5 then call');
  assert.match(e.message, /Unknown name `strenght`/);
  assert.match(e.hint, /strength/);
  e = err('\n\nif equity > 0.5 then\n  call\n');
  assert.match(e.message, /missing its `end`/);
  assert.equal(e.line, 3);
  e = err('if pot = 3 then call end');
  assert.match(e.message, /==/);
  e = err('let pot = 3');
  assert.match(e.message, /built-in/);
  e = err('when hand in "AK+, ZZ" then call');
  assert.match(e.message, /not a hand or range/);
  e = err('when random > 0.5 then call');
  assert.match(e.message, /random\(\)/);
  e = err('equity > 0.5');
  assert.match(e.message, /condition on its own/);
  e = err('when x > 1 then call');
  assert.match(e.message, /Unknown name `x`/);
  e = err('while true then call end');
  assert.match(e.message, /not part of Kicker/);
  e = err('when equity > 0.5 && pot > 3 then call');
  assert.match(e.message, /`and`/);
  e = err('when chance() then call');
  assert.match(e.message, /takes 1 value/);
  e = err('on flop\n  on turn\n    call\n  end\nend');
  assert.match(e.message, /top level/);
});

test('a bot that does not parse yet still shows its name', () => {
  const c = compile(['bot "Night Owl"', 'avatar "🦉"', 'color "#7dd3fc"', 'on preflop', '  fold', ''].join('\n'));
  assert.equal(c.ok, false);
  assert.deepEqual(c.meta, { name: 'Night Owl', avatar: '🦉', color: '#7dd3fc' });
});

test('runtime type errors are reported instead of crashing, and the bot check-folds', () => {
  const r = decide('let s = "abc"\nwhen s > 3 then call\nraise pot');
  assert.ok(r.error);
  assert.match(r.error.message, /compares numbers/);
  assert.equal(r.error.line, 2);
  assert.deepEqual(r.intent, { type: 'check' });
});

test('hand ranges expand correctly', () => {
  const set = (s) => [...parseRange(s)].sort();
  assert.deepEqual(set('TT+'), ['AA', 'JJ', 'KK', 'QQ', 'TT']);
  assert.deepEqual(set('ATs+'), ['AJs', 'AKs', 'AQs', 'ATs']);
  assert.deepEqual(set('A5s-A2s'), ['A2s', 'A3s', 'A4s', 'A5s']);
  assert.deepEqual(set('87s-54s'), ['54s', '65s', '76s', '87s']);
  assert.deepEqual(set('22-44'), ['22', '33', '44']);
  assert.deepEqual(set('KQ'), ['KQo', 'KQs']);
  assert.equal(parseRange('Axs').size, 12);
  assert.equal(parseRange('Kx').size, 24);
  assert.deepEqual(set('AKs-QJs'), ['AKs', 'KQs', 'QJs']);
  assert.throws(() => parseRange('AK-Q9'));
  assert.throws(() => parseRange('AKs-QJo'));
});

test('lexer tolerates anything in highlight mode', () => {
  const toks = lex('when "unterminated\n@@ # comment', { tolerant: true });
  assert.ok(toks.some((t) => t.t === 'comment'));
  assert.ok(toks.some((t) => t.t === 'err'));
});

test('bots only see their own hole cards', () => {
  const table = new Table({ maxSeats: 2, smallBlind: 10, bigBlind: 20, rng: makeRng('v') });
  table.sit(0, { id: 'a', name: 'A', stack: 1000 });
  table.sit(1, { id: 'b', name: 'B', stack: 1000 });
  const hand = table.startHand();
  const view = buildView(hand, hand.toAct);
  assert.equal(JSON.stringify(view).includes('"hole"'), true);
  for (const p of view.players) assert.equal(p.hole, undefined);
});
