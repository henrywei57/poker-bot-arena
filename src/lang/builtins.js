// Every built-in name a Kicker bot can read, with its documentation. The
// in-app reference and docs/LANGUAGE.md are generated from this table, so a
// built-in cannot exist without being documented.

import { handClass } from '../engine/cards.js';
import { analyzeHand, equity, topPct, chenScore, madeName } from '../engine/equity.js';
import { parseRange, HAND_CLASS_RE } from './ranges.js';

export const VARIABLES = {};
export const FUNCTIONS = {};
export const GROUPS = [];

function group(name, blurb) { GROUPS.push({ name, blurb, vars: [], fns: [] }); }
function v(name, type, example, doc, get) {
  VARIABLES[name] = { name, type, example, doc, get, group: GROUPS[GROUPS.length - 1].name };
  GROUPS[GROUPS.length - 1].vars.push(name);
}
function f(name, sig, min, max, doc, fn) {
  FUNCTIONS[name] = { name, sig, min, max, doc, fn, group: GROUPS[GROUPS.length - 1].name };
  GROUPS[GROUPS.length - 1].fns.push(name);
}

const PRIOR_HANDS = 5;
const DEFAULT_STATS = { vpip: 0.3, pfr: 0.15, af: 1.5 };

/** Per-decision context: lazily computes and memoizes every built-in. */
export class Ctx {
  constructor(view, bot) {
    this.view = view;
    this.bot = bot;
    this.memo = new Map();
  }
  get(name) {
    if (this.memo.has(name)) return this.memo.get(name);
    const val = VARIABLES[name].get(this, this.view);
    this.memo.set(name, val);
    return val;
  }
  get me() { return this.view.players[this.view.idx]; }
  get L() { return this.view.legal; }
  analysis() {
    if (!this._an) this._an = analyzeHand(this.view.hole, this.view.board);
    return this._an;
  }
  liveOpponents() {
    return this.view.players.filter((p, j) => j !== this.view.idx && !p.folded);
  }
  equityVs(opponents, iterations) {
    const { view, bot } = this;
    const key = `${view.handNumber}|${view.board.length}|${opponents}|${iterations}|${view.hole}`;
    const cached = bot.cache.get(key);
    if (cached !== undefined) return cached;
    const e = equity(view.hole, view.board, opponents, iterations, bot.mcRng);
    bot.cache.set(key, e);
    return e;
  }
  orderStart() {
    const { view } = this;
    if (view.street === 'preflop') return view.n === 2 ? view.sbIdx : (view.bbIdx + 1) % view.n;
    return (view.buttonIdx + 1) % view.n;
  }
  oppStat(key) {
    const opps = this.liveOpponents();
    if (!opps.length) return DEFAULT_STATS[key];
    let sum = 0;
    for (const o of opps) {
      const s = o.stats;
      const h = s ? s.hands : 0;
      const val = s && h ? s[key] : DEFAULT_STATS[key];
      sum += (val * h + DEFAULT_STATS[key] * PRIOR_HANDS) / (h + PRIOR_HANDS);
    }
    return sum / opps.length;
  }
}

// ---------------------------------------------------------------- your cards
group('Your cards', 'What you were dealt.');
v('hand', 'text', '"AKs"', 'Your starting hand in poker notation: "AA", "AKs" (suited), "T9o" (offsuit). Check it against a range with `hand in "TT+, AQs+"`.',
  (c, w) => handClass(w.hole[0], w.hole[1]));
v('high', 'number', '14', 'Rank of your higher card: 2..10, J = 11, Q = 12, K = 13, A = 14.',
  (c, w) => Math.max(w.hole[0] >> 2, w.hole[1] >> 2) + 2);
v('low', 'number', '9', 'Rank of your lower card (same scale as `high`).',
  (c, w) => Math.min(w.hole[0] >> 2, w.hole[1] >> 2) + 2);
v('suited', 'yes/no', 'true', 'Both your cards are the same suit.', (c, w) => (w.hole[0] & 3) === (w.hole[1] & 3));
v('pocket_pair', 'yes/no', 'false', 'Your two cards are the same rank.', (c, w) => (w.hole[0] >> 2) === (w.hole[1] >> 2));
v('connected', 'yes/no', 'true', 'Your cards are next to each other in rank (98, JT, and A2 counts).', (c, w) => {
  const a = w.hole[0] >> 2, b = w.hole[1] >> 2;
  return Math.abs(a - b) === 1 || (Math.max(a, b) === 12 && Math.min(a, b) === 0);
});
v('gap', 'number', '1', 'Ranks missing between your cards: 0 for connectors (98), 1 for one-gappers (97). -1 for a pocket pair.', (c, w) => {
  const a = w.hole[0] >> 2, b = w.hole[1] >> 2;
  return a === b ? -1 : Math.abs(a - b) - 1;
});
v('top_pct', 'number', '4.5', 'How good your starting hand is: the percent of all hands at least this strong. AA = 0.45, AKs = 3, 72o = 99. Smaller is better. See also `top(n)`.',
  (c, w) => topPct(w.hole));
v('chen', 'number', '10', "Bill Chen's starting-hand score, from -1 (72o) to 20 (AA).", (c, w) => chenScore(w.hole));

// ---------------------------------------------------------- board and hand
group('Board & made hand', 'What the community cards do for you. Before the flop most of these are false / 0.');
v('board_cards', 'number', '3', 'Number of community cards: 0, 3, 4 or 5.', (c, w) => w.board.length);
v('made', 'text', '"two pair"', 'Your best hand: "high card", "pair", "two pair", "trips", "straight", "flush", "full house", "quads" or "straight flush".',
  (c) => madeName(c.analysis().madeRank));
v('made_rank', 'number', '2', 'Your best hand as a number: 0 high card, 1 pair, 2 two pair, 3 trips, 4 straight, 5 flush, 6 full house, 7 quads, 8 straight flush.',
  (c) => c.analysis().madeRank);
v('board_rank', 'number', '1', 'The same scale for the board on its own (1 means the board is paired).', (c) => c.analysis().boardRank);
v('hit', 'yes/no', 'true', 'Your cards make your hand better than the board alone (made_rank > board_rank). Before the flop: you have a pocket pair.',
  (c) => c.analysis().hit);
v('top_pair', 'yes/no', 'true', 'One of your cards pairs the highest card on the board.', (c) => c.analysis().topPair);
v('overpair', 'yes/no', 'false', 'You have a pocket pair higher than every board card.', (c) => c.analysis().overpair);
v('flush_draw', 'yes/no', 'false', 'Four cards to a flush, using at least one of yours (flop or turn only).', (c) => c.analysis().flushDraw);
v('straight_draw', 'yes/no', 'false', 'Open-ended straight draw (two ranks complete it) using your cards.', (c) => c.analysis().straightDraw);
v('gutshot', 'yes/no', 'false', 'Inside straight draw (exactly one rank completes it).', (c) => c.analysis().gutshot);
v('draw', 'yes/no', 'false', '`flush_draw or straight_draw`.', (c) => c.analysis().flushDraw || c.analysis().straightDraw);
v('outs', 'number', '9', 'Rough number of cards that complete your draws.', (c) => c.analysis().outs);
v('board_paired', 'yes/no', 'false', 'Two or more board cards share a rank.', (c) => c.analysis().boardPaired);
v('board_flushy', 'yes/no', 'false', 'Three or more board cards share a suit, so a flush is possible.', (c) => c.analysis().boardFlushy);
v('board_connected', 'yes/no', 'false', 'Three board cards fit inside a five-rank window, so a straight is possible.', (c) => c.analysis().boardConnected);
v('board_high', 'number', '13', 'Highest board card rank (2..14), 0 before the flop.', (c) => c.analysis().boardHigh);

// ---------------------------------------------------------------- strength
group('Strength', 'Win chances, estimated by dealing out thousands of random hands.');
v('equity', 'number', '0.62', 'Chance to win (0..1) against every opponent still in the hand, assuming they hold random cards. Ties count as part-wins.',
  (c) => c.equityVs(c.liveOpponents().length, c.bot.iterations));
v('strength', 'number', '0.71', 'Chance to win (0..1) against ONE random hand. Steadier than `equity` when many players are in: AA = 0.85, 72o = 0.35.',
  (c) => c.equityVs(1, c.bot.iterations + 150));

// ------------------------------------------------------------------- chips
group('Chips & bets', 'All amounts are in chips unless the name ends in _bb (big blinds).');
v('pot', 'number', '450', 'All chips in the pot, including bets in front of players this round.', (c) => c.L.pot);
v('to_call', 'number', '100', 'Chips you need to put in to call (0 when you can check).', (c) => c.L.toCall);
v('stack', 'number', '2400', 'Chips you have behind (not counting what you already bet).', (c) => c.L.stack);
v('bb', 'number', '20', 'The big blind.', (c, w) => w.bb);
v('sb', 'number', '10', 'The small blind.', (c, w) => w.sb);
v('ante', 'number', '0', 'The ante (tournaments, later levels).', (c, w) => w.ante || 0);
v('stack_bb', 'number', '120', 'Your stack in big blinds.', (c, w) => c.L.stack / w.bb);
v('pot_odds', 'number', '0.25', 'to_call / (pot + to_call): the share of the final pot you are paying. Calling is profitable when your equity is higher.',
  (c) => (c.L.toCall > 0 ? c.L.toCall / (c.L.pot + c.L.toCall) : 0));
v('spr', 'number', '4.2', 'Stack-to-pot ratio: stack / pot.', (c) => (c.L.pot > 0 ? c.L.stack / c.L.pot : 99));
v('current_bet', 'number', '200', 'The bet everyone has to match this round.', (c) => c.L.currentBet);
v('my_bet', 'number', '20', 'What you already put in this round.', (c) => c.L.streetBet);
v('invested', 'number', '60', 'What you put in this whole hand.', (c) => c.me.totalBet);
v('min_raise', 'number', '400', 'Smallest legal raise, as the total you would raise to.', (c) => c.L.minRaiseTo);
v('max_raise', 'number', '2420', 'Largest raise (all-in), as a total.', (c) => c.L.maxRaiseTo);
v('effective_stack', 'number', '1800', 'The smaller of your stack and the biggest opponent stack still in the hand: the most you can win or lose.', (c) => {
  const opp = Math.max(0, ...c.liveOpponents().map((p) => p.stack + p.streetBet));
  return Math.min(c.L.stack + c.L.streetBet, opp);
});
v('effective_bb', 'number', '90', '`effective_stack` in big blinds.', (c, w) => c.get('effective_stack') / w.bb);
v('can_check', 'yes/no', 'true', 'Checking is free (nobody has bet).', (c) => c.L.toCall === 0);
v('can_raise', 'yes/no', 'true', 'You are allowed to raise (false when everyone else is all-in, for example).', (c) => c.L.canRaise);
v('facing_bet', 'yes/no', 'false', 'Someone bet and you must call, raise or fold.', (c) => c.L.toCall > 0);

// --------------------------------------------------------------- situation
group('Position & action', 'Where you sit and what happened so far.');
v('street', 'text', '"flop"', 'Current round: "preflop", "flop", "turn" or "river".', (c, w) => w.street);
v('preflop', 'yes/no', 'false', 'It is before the flop.', (c, w) => w.street === 'preflop');
v('flop', 'yes/no', 'true', 'It is the flop.', (c, w) => w.street === 'flop');
v('turn', 'yes/no', 'false', 'It is the turn.', (c, w) => w.street === 'turn');
v('river', 'yes/no', 'false', 'It is the river.', (c, w) => w.street === 'river');
v('postflop', 'yes/no', 'true', 'Flop, turn or river.', (c, w) => w.street !== 'preflop');
v('players', 'number', '6', 'Players dealt into this hand.', (c, w) => w.n);
v('active', 'number', '3', 'Players still in the hand (not folded), you included.', (c, w) => w.players.filter((p) => !p.folded).length);
v('opponents', 'number', '2', 'Opponents still in the hand.', (c) => c.liveOpponents().length);
v('position', 'number', '0.8', 'Your seat relative to the button: 0 = first to act after the flop (small blind), 1 = the button (acts last).',
  (c, w) => (w.n > 1 ? ((w.idx - w.buttonIdx - 1 + w.n) % w.n) / (w.n - 1) : 1));
v('in_position', 'yes/no', 'true', 'You act last after the flop among players still in.', (c, w) => {
  const k = (j) => (j - w.buttonIdx - 1 + w.n) % w.n;
  return w.players.every((p, j) => j === w.idx || p.folded || k(j) < k(w.idx));
});
v('on_button', 'yes/no', 'false', 'You are the dealer.', (c, w) => w.idx === w.buttonIdx);
v('in_blinds', 'yes/no', 'false', 'You posted the small or big blind this hand.', (c, w) => w.idx === w.sbIdx || w.idx === w.bbIdx);
v('is_sb', 'yes/no', 'false', 'You are the small blind.', (c, w) => w.idx === w.sbIdx);
v('is_bb', 'yes/no', 'false', 'You are the big blind.', (c, w) => w.idx === w.bbIdx);
v('behind', 'number', '2', 'Players still to act after you this round who could still bet (not folded or all-in).', (c, w) => {
  const s = c.orderStart();
  const ord = (j) => (j - s + w.n) % w.n;
  return w.players.filter((p, j) => j !== w.idx && !p.folded && !p.allIn && ord(j) > ord(w.idx)).length;
});
v('raises', 'number', '1', 'Bets and raises made this round so far (blinds do not count).', (c, w) => w.raises);
v('limpers', 'number', '0', 'Before the flop: players who just called the big blind before anyone raised.', (c, w) => {
  if (w.street !== 'preflop') return 0;
  let k = 0;
  for (const a of w.actions) {
    if (a.street !== 'preflop') continue;
    if (a.type === 'raise' || a.type === 'bet') break;
    if (a.type === 'call') k++;
  }
  return k;
});
v('callers', 'number', '1', 'Players who called the latest bet or raise this round.', (c, w) => {
  let k = 0;
  for (const a of w.actions) {
    if (a.street !== w.street) continue;
    if (a.type === 'raise' || a.type === 'bet') k = 0;
    else if (a.type === 'call') k++;
  }
  return k;
});
v('aggressor', 'yes/no', 'false', 'You made the latest bet or raise this round.', (c, w) => w.aggressor[w.street] === w.idx);
v('was_aggressor', 'yes/no', 'true', 'You made the last bet or raise of the previous round (e.g. you raised preflop: a continuation bet spot).', (c, w) => {
  const order = ['preflop', 'flop', 'turn', 'river'];
  const k = order.indexOf(w.street);
  return k > 0 && w.aggressor[order[k - 1]] === w.idx;
});
v('first_action', 'yes/no', 'true', 'This is your first decision of the hand.', (c, w) => !w.actions.some((a) => a.idx === w.idx));
v('hand_number', 'number', '57', 'Hands played at this table so far.', (c, w) => w.handNumber);

// --------------------------------------------------------------- opponents
group('Opponents', 'Averages over the opponents still in the hand, learned from what they did in earlier hands. They start near typical values (vpip 0.30, pfr 0.15, aggr 1.5) and move toward what each player really does.');
v('opp_vpip', 'number', '0.30', 'How often they put money in before the flop by choice (0..1). High = loose.', (c) => c.oppStat('vpip'));
v('opp_pfr', 'number', '0.15', 'How often they raise before the flop (0..1).', (c) => c.oppStat('pfr'));
v('opp_aggr', 'number', '1.5', 'Aggression: (bets + raises) / calls. Above 2 is aggressive, below 1 is passive.', (c) => c.oppStat('af'));
v('opp_hands', 'number', '40', 'Fewest hands seen of any opponent still in (how much to trust the stats).', (c) => {
  const opps = c.liveOpponents();
  return opps.length ? Math.min(...opps.map((o) => (o.stats ? o.stats.hands : 0))) : 0;
});

// -------------------------------------------------------------- tournament
group('Tournament', 'Zero / false outside tournaments.');
v('tournament', 'yes/no', 'false', 'You are playing a tournament.', (c, w) => !!w.tournament);
v('players_left', 'number', '0', 'Players still in the tournament.', (c, w) => (w.tournament ? w.tournament.playersLeft : 0));
v('level', 'number', '0', 'Blind level (1 = first).', (c, w) => (w.tournament ? w.tournament.level : 0));

// --------------------------------------------------------------- functions
group('Functions', 'Call these with parentheses.');
const num = (x, name) => {
  if (typeof x !== 'number' || Number.isNaN(x)) throw new TypeError(`${name}() needs numbers`);
  return x;
};
f('top', 'top(pct)', 1, 1, 'True when your starting hand is in the best `pct` percent of hands. `top(10)` is roughly 88+, ATs+, KQs, AJo+.',
  (c, pct) => c.get('top_pct') <= num(pct, 'top'));
f('random', 'random()', 0, 0, 'A random number from 0 up to (not including) 1.', (c) => c.bot.rng());
f('chance', 'chance(p)', 1, 1, 'True with probability p. `chance(0.3)` is true about 30% of the time. Use it to mix up your play.',
  (c, p) => c.bot.rng() < num(p, 'chance'));
f('pick', 'pick(a, b, ...)', 1, 50, 'One of the values, chosen at random. Great for `say pick("Nice hand", "Lucky!")`.',
  (c, ...xs) => xs[Math.floor(c.bot.rng() * xs.length)]);
f('min', 'min(a, b, ...)', 1, 50, 'The smallest value.', (c, ...xs) => Math.min(...xs.map((x) => num(x, 'min'))));
f('max', 'max(a, b, ...)', 1, 50, 'The largest value.', (c, ...xs) => Math.max(...xs.map((x) => num(x, 'max'))));
f('abs', 'abs(x)', 1, 1, 'Absolute value.', (c, x) => Math.abs(num(x, 'abs')));
f('round', 'round(x, digits)', 1, 2, 'Round to the nearest whole number, or to `digits` decimal places.',
  (c, x, d = 0) => { const k = 10 ** num(d, 'round'); return Math.round(num(x, 'round') * k) / k; });
f('floor', 'floor(x)', 1, 1, 'Round down.', (c, x) => Math.floor(num(x, 'floor')));
f('ceil', 'ceil(x)', 1, 1, 'Round up.', (c, x) => Math.ceil(num(x, 'ceil')));
f('clamp', 'clamp(x, lo, hi)', 3, 3, 'x, kept between lo and hi.', (c, x, lo, hi) => Math.min(num(hi, 'clamp'), Math.max(num(lo, 'clamp'), num(x, 'clamp'))));
f('between', 'between(x, lo, hi)', 3, 3, 'True when lo <= x <= hi. Same as `lo <= x <= hi`.',
  (c, x, lo, hi) => num(x, 'between') >= num(lo, 'between') && num(x, 'between') <= num(hi, 'between'));
f('mod', 'mod(a, b)', 2, 2, 'Remainder of a / b (0 if b is 0). `mod(hand_number, 10) == 0` is true every tenth hand.',
  (c, a, b) => (num(b, 'mod') === 0 ? 0 : ((num(a, 'mod') % b) + b) % b));
f('in_range', 'in_range(hand, range)', 2, 2, 'Same as `hand in range`: is the hand class in a range like "TT+, AQs+, KQs"?',
  (c, h, r) => {
    if (typeof h !== 'string' || !HAND_CLASS_RE.test(h)) throw new TypeError('in_range() needs a hand like "AKs" first');
    return parseRange(String(r)).has(h);
  });
f('equity_vs', 'equity_vs(n)', 1, 1, 'Chance to win against exactly n random hands (1..8), whoever is still in.',
  (c, n) => c.equityVs(Math.max(1, Math.min(8, Math.round(num(n, 'equity_vs')))), c.bot.iterations));

export const BUILTIN_NAMES = [...Object.keys(VARIABLES), ...Object.keys(FUNCTIONS)];
