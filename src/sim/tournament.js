// Freezeout tournaments: one or more tables, rising blinds, eliminations,
// and table balancing (tables break as players bust and the rest are kept
// within one player of each other). Every table plays one hand per "round".

import { Table } from '../engine/table.js';
import { shuffle } from '../engine/cards.js';
import { makeRng } from '../util.js';

/** [small blind, big blind, ante] per level for a 1,500-chip start. */
export const BLIND_LEVELS = [
  [10, 20, 0], [15, 30, 0], [25, 50, 0], [50, 100, 0], [75, 150, 0],
  [100, 200, 25], [150, 300, 25], [200, 400, 50], [300, 600, 75], [400, 800, 100],
  [600, 1200, 150], [800, 1600, 200], [1000, 2000, 250], [1500, 3000, 400], [2000, 4000, 500],
  [3000, 6000, 750], [4000, 8000, 1000], [6000, 12000, 1500], [8000, 16000, 2000], [10000, 20000, 3000],
];

export function levelAt(k) {
  if (k < BLIND_LEVELS.length) return BLIND_LEVELS[k];
  const m = 2 ** (k - BLIND_LEVELS.length + 1);
  const [s, b, a] = BLIND_LEVELS[BLIND_LEVELS.length - 1];
  return [s * m, b * m, a * m];
}

/** How many places are paid, and their share of the prize pool (percent). */
export function payouts(n) {
  if (n <= 3) return [100];
  if (n <= 6) return [65, 35];
  if (n <= 10) return [50, 30, 20];
  if (n <= 20) return [40, 25, 18, 10, 7];
  return [30, 20, 14, 10, 8, 6, 5, 4, 3];
}

const occupied = (t) => t.seats.filter(Boolean).length;

export class Tournament {
  /**
   * @param entrants  player objects { id, name, ... }; stacks are set here
   * @param opts.blindScale multiplies every blind level (to match a different starting stack)
   */
  constructor({ entrants, startingStack = 1500, maxPerTable = 9, handsPerLevel = 10, seed = 'tour', blindScale }) {
    if (entrants.length < 2) throw new Error('A tournament needs at least two players');
    this.rng = makeRng(seed);
    this.entrants = entrants;
    this.N = entrants.length;
    this.startingStack = startingStack;
    this.maxPerTable = maxPerTable;
    this.handsPerLevel = handsPerLevel;
    this.blindScale = blindScale ?? startingStack / 1500;
    this.round = 0;
    this.finish = [];
    this.log = [];
    const numTables = Math.ceil(this.N / maxPerTable);
    this.tables = [];
    for (let i = 0; i < numTables; i++) {
      const t = new Table({ maxSeats: maxPerTable, smallBlind: 10, bigBlind: 20, rng: this.rng.fork(`table${i}`) });
      t.id = i + 1;
      this.tables.push(t);
    }
    shuffle(entrants.slice(), this.rng).forEach((p, k) => {
      p.stack = startingStack;
      p.place = null;
      this._seat(this.tables[k % numTables], p);
    });
    this.applyBlinds();
  }

  _seat(table, p) {
    const empty = [];
    table.seats.forEach((s, i) => { if (!s) empty.push(i); });
    table.sit(empty[Math.floor(this.rng() * empty.length)], p);
  }

  get level() { return Math.floor(this.round / this.handsPerLevel); }

  blinds() {
    const [s, b, a] = levelAt(this.level);
    const r = (x) => (x === 0 ? 0 : Math.max(1, Math.round(x * this.blindScale)));
    return [r(s), Math.max(2, r(b)), r(a)];
  }

  applyBlinds() {
    const [sb, bb, ante] = this.blinds();
    for (const t of this.tables) t.setBlinds(sb, bb, ante);
  }

  remaining() {
    const out = [];
    for (const t of this.tables) for (const p of t.seats) if (p && p.stack > 0) out.push(p);
    return out;
  }

  isOver() { return this.remaining().length <= 1; }

  tableOf(id) { return this.tables.find((t) => t.seats.some((p) => p && p.id === id)) || null; }

  /** Tables that can deal this round. */
  playable() { return this.tables.filter((t) => t.canDeal()); }

  info() {
    const [sb, bb, ante] = this.blinds();
    return { playersLeft: this.remaining().length, level: this.level + 1, entrants: this.N, sb, bb, ante, tables: this.tables.length };
  }

  /** Call after every playable table finished its hand. Returns log lines. */
  endRound() {
    const lines = [];
    const busted = [];
    for (const t of this.tables) {
      t.seats.forEach((p, seat) => {
        if (p && p.stack === 0) {
          const hp = t.hand?.players.find((q) => q.ref === p);
          busted.push({ p, t, seat, start: hp ? hp.startStack : 0 });
        }
      });
    }
    busted.sort((a, b) => a.start - b.start);
    for (const b of busted) {
      b.t.leave(b.seat);
      this.finish.push(b.p.id);
      b.p.place = this.N - this.finish.length + 1;
      lines.push(`${b.p.name} is out in ${ordinal(b.p.place)} place`);
    }
    const left = this.remaining();
    if (left.length === 1) {
      left[0].place = 1;
      lines.push(`${left[0].name} wins the tournament!`);
    }
    const before = this.level;
    this.round++;
    this.applyBlinds();
    if (this.level !== before && left.length > 1) {
      const [sb, bb, ante] = this.blinds();
      lines.push(`Blinds up: level ${this.level + 1}, ${sb}/${bb}${ante ? ` ante ${ante}` : ''}`);
    }
    if (left.length > 1) lines.push(...this.balance());
    return lines;
  }

  balance() {
    const lines = [];
    this.tables = this.tables.filter((t) => occupied(t) > 0);
    while (this.tables.length > 1) {
      const total = this.tables.reduce((s, t) => s + occupied(t), 0);
      if (total > (this.tables.length - 1) * this.maxPerTable) break;
      const smallest = this.tables.reduce((a, b) => (occupied(b) < occupied(a) ? b : a));
      const rest = this.tables.filter((t) => t !== smallest);
      smallest.seats.forEach((p, seat) => {
        if (!p) return;
        smallest.leave(seat);
        const dest = rest.reduce((a, b) => (occupied(b) < occupied(a) ? b : a));
        this._seat(dest, p);
      });
      this.tables = rest;
      lines.push(this.tables.length === 1 ? 'Final table!' : `Table ${smallest.id} breaks`);
    }
    for (let guard = 0; guard < 100; guard++) {
      const sorted = [...this.tables].sort((a, b) => occupied(b) - occupied(a));
      if (sorted.length < 2) break;
      const big = sorted[0], small = sorted[sorted.length - 1];
      if (occupied(big) - occupied(small) < 2) break;
      const seat = this._nextBigBlindSeat(big);
      const p = big.leave(seat);
      this._seat(small, p);
      lines.push(`${p.name} moves from table ${big.id} to table ${small.id}`);
    }
    return lines;
  }

  _nextBigBlindSeat(t) {
    const seats = [];
    t.seats.forEach((p, i) => { if (p) seats.push(i); });
    if (t.button < 0 || seats.length < 3) return seats[0];
    const after = (s) => seats.find((x) => x > s) ?? seats[0];
    return after(after(t.button));
  }

  /** Everyone, best first: survivors by chips, then by finishing place. */
  standings() {
    return this.entrants.slice().sort((a, b) => {
      const pa = a.place, pb = b.place;
      if (pa == null && pb == null) return b.stack - a.stack;
      if (pa == null) return -1;
      if (pb == null) return 1;
      return pa - pb;
    });
  }
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
