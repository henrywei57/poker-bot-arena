// GameSession drives a live table: it deals hands, asks bots or people for
// decisions, paces everything for animation (1x..16x or instant), keeps the
// log and stats, and builds per-viewer snapshots the table view renders.
// The same snapshots are what an online host sends to its guests.

import { Table } from '../engine/table.js';
import { buildView } from '../engine/view.js';
import { resolveIntent, describeAction } from '../engine/actions.js';
import { prettyCard } from '../engine/cards.js';
import { StatsTracker } from './stats.js';
import { playHandSync } from './headless.js';
import { formatChips, makeRng, randomSeed } from '../util.js';

/** Milliseconds at 1x speed. */
const PACE = { deal: 700, think: 650, act: 260, street: 750, end: 1500, endShowdown: 2700, sayFor: 2600 };
export const SPEEDS = [0.5, 1, 2, 4, 8, 16, 'instant'];
const VALID_INTENTS = new Set(['fold', 'check', 'call', 'raise', 'bet', 'allin']);

/** "You checks" -> "You check": fix the verb when the player is called "You". */
function says(name, text) {
  if (name !== 'You') return `${name} ${text}`;
  return `You ${text.replace(/^(\w+?)(e?s)\b/, (m, stem, suf) => (stem === 'rebuy' || stem === 'show' || stem === 'win' || stem === 'split' ? stem : suf === 'es' && /(sh|ch|x|ss)$/.test(stem) ? stem : stem + (suf === 'es' ? 'e' : '')))}`;
}

export class GameSession {
  /**
   * cfg: {
   *   mode: 'play' | 'sim' | 'tournament' | 'online', title,
   *   players: [{ id, name, avatar, color, kind: 'bot'|'human'|'remote', agent, seat? }],
   *   maxSeats, sb, bb, ante, startingStack, handLimit, rebuy, speed, revealAll,
   *   turnTime (seconds, 0 = no limit), seed, tournament (Tournament), viewerId
   * }
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.mode = cfg.mode;
    this.seed = cfg.seed || randomSeed();
    this.rng = makeRng(`${this.seed}:session`);
    this.stats = new StatsTracker();
    this.listeners = new Set();
    this.finishListeners = new Set();
    this.log = [];
    this.logId = 0;
    this.speed = cfg.speed ?? 1;
    this.revealAll = !!cfg.revealAll;
    this.paused = false;
    this.stopped = false;
    this.running = false;
    this.finished = false;
    this.pending = null;
    this.waiters = [];
    this.waitSkip = null;
    this.changeWaiters = [];
    this.handsPlayed = 0;
    this.message = null;
    this.status = null;
    this.sayId = 0;
    this.says = new Map();
    this.errorsSeen = new Set();
    this.agents = new Map();
    this.players = new Map();
    this.cursor = 0;
    this.thinking = -1;
    this.tour = cfg.tournament || null;

    for (const p of cfg.players) {
      this.agents.set(p.id, p.agent || { kind: p.kind });
      this.players.set(p.id, p);
    }
    if (this.tour) {
      this.table = this._pickWatchedTable();
    } else {
      this.table = new Table({
        maxSeats: cfg.maxSeats || 9, smallBlind: cfg.sb, bigBlind: cfg.bb, ante: cfg.ante || 0,
        rng: makeRng(`${this.seed}:deck`),
      });
      for (const p of cfg.players) {
        p.stack = p.stack ?? cfg.startingStack;
        this.table.sit(p.seat ?? this.table.firstEmptySeat(), p);
      }
    }
    for (const p of cfg.players) this.stats.entry(p.id, p.name).buyIns = this.tour ? 0 : 1;
  }

  // ----------------------------------------------------------- listeners
  onUpdate(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onFinish(fn) { this.finishListeners.add(fn); return () => this.finishListeners.delete(fn); }
  emit() { for (const fn of this.listeners) { try { fn(this); } catch (e) { console.error(e); } } }

  addLog(text, kind = 'info') {
    const entry = { id: ++this.logId, text, kind, hand: this.table?.handNumber ?? 0 };
    this.log.push(entry);
    if (this.log.length > 600) this.log.splice(0, this.log.length - 500);
    return entry;
  }

  // ------------------------------------------------------------ controls
  get hasHumans() {
    for (const p of this.players.values()) {
      if ((p.kind === 'human' || p.kind === 'remote') && (!this.tour || this.tour.tableOf(p.id))) return true;
    }
    return false;
  }

  setSpeed(s) {
    if (!SPEEDS.includes(s)) return;
    if (s === 'instant' && this.hasHumans) return;
    this.speed = s;
    this._skipWait();
    this.emit();
  }

  pause() { this.paused = true; this.emit(); }
  resume() {
    this.paused = false;
    const w = this.waiters; this.waiters = [];
    w.forEach((r) => r());
    this.emit();
  }
  step() {
    const r = this.waiters.shift();
    this._skipWait();
    if (r) r();
  }
  stop() {
    this.stopped = true;
    this.paused = false;
    this.waiters.splice(0).forEach((r) => r());
    this._skipWait();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      const { resolve, legal } = this.pending;
      this.pending = null;
      resolve(resolveIntent({ type: 'check' }, legal));
    }
    this.changeWaiters.splice(0).forEach((r) => r());
    this.emit();
  }
  setRevealAll(v) { this.revealAll = !!v; this.emit(); }

  /** Something changed that a waiting online table cares about (a player joined). */
  notifyChange() { this.changeWaiters.splice(0).forEach((r) => r()); }

  _gate() {
    if (!this.paused || this.stopped) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  _wait(ms) {
    if (this.stopped || this.speed === 'instant' || ms <= 0) return Promise.resolve();
    const t = ms / this.speed;
    return new Promise((resolve) => {
      const id = setTimeout(done, t);
      function done() { clearTimeout(id); resolve(); }
      this.waitSkip = done;
    });
  }

  _skipWait() { const s = this.waitSkip; this.waitSkip = null; if (s) s(); }

  // ----------------------------------------------------------- the loop
  async run() {
    if (this.running) return;
    this.running = true;
    this.emit();
    try {
      while (!this.stopped) {
        if (this._isFinished()) break;
        this._beforeHand();
        if (this._isFinished()) break;
        if (this.tour && !this.table.canDeal()) this.table = this._pickWatchedTable();
        if (!this.table.canDeal()) {
          if (this.mode === 'online') {
            this.status = 'Waiting for players…';
            this.emit();
            await new Promise((r) => this.changeWaiters.push(r));
            continue;
          }
          break;
        }
        this.status = null;
        if (this.speed === 'instant' && !this.hasHumans) await this._instantBatch();
        else await this._playRound();
      }
    } catch (e) {
      console.error(e);
      this.addLog(`Something went wrong: ${e.message}`, 'error');
    } finally {
      this.running = false;
      if (!this.stopped) this.finished = true;
      this.pending = null;
      this.emit();
      for (const fn of this.finishListeners) fn(this);
    }
  }

  _isFinished() {
    if (this.tour) return this.tour.isOver();
    if (this.cfg.handLimit && this.handsPlayed >= this.cfg.handLimit) return true;
    if (this.mode === 'online') return false;
    const withChips = [...this.players.values()].filter((p) => p.stack > 0);
    if (!this.cfg.rebuy && withChips.length < 2) return true;
    if (this.mode === 'play' && !this.cfg.rebuy) {
      const me = [...this.players.values()].find((p) => p.kind === 'human');
      if (me && me.stack === 0) return true;
    }
    return false;
  }

  _beforeHand() {
    if (this.cfg.rebuy && !this.tour) {
      for (const p of this.players.values()) {
        if (p.stack === 0 && this.table.seats.includes(p)) {
          p.stack = this.cfg.startingStack;
          this.stats.entry(p.id, p.name).buyIns++;
          this.addLog(says(p.name, `rebuys for ${formatChips(p.stack)}`), 'minor');
        }
      }
    }
    if (this.cfg.beforeHand) this.cfg.beforeHand(this);
  }

  _agentFor = (id) => this.agents.get(id);

  _viewExtra() {
    return { stats: this.stats, tournament: this.tour ? this.tour.info() : null };
  }

  _onDecision(p, d) {
    if (d.error) {
      const key = `${p.id}|${d.error.line}|${d.error.message}`;
      if (!this.errorsSeen.has(key)) {
        this.errorsSeen.add(key);
        this.addLog(`⚠ ${p.name}: line ${d.error.line}: ${d.error.message}`, 'error');
      }
    }
    if (d.said) {
      this.says.set(p.id, { text: d.said, id: ++this.sayId, until: Date.now() + PACE.sayFor / (this.speed === 'instant' ? 16 : this.speed) });
      this.addLog(`💬 ${p.name}: “${d.said}”`, 'say');
    }
  }

  /** One hand at the watched table (plus, in tournaments, a hand at every other table). */
  async _playRound() {
    if (this.tour) this._playOtherTables();
    await this._playHandAnimated();
    if (!this.stopped) this._afterHand();
  }

  _playOtherTables() {
    for (const t of this.tour.playable()) {
      if (t === this.table) continue;
      playHandSync(t, this._agentFor, { ...this._viewExtra(), onDecision: () => {} });
      this.stats.recordHand(t.hand);
    }
  }

  async _instantBatch() {
    let last = performance.now();
    while (!this.stopped && this.speed === 'instant' && !this._isFinished()) {
      if (this.paused) { this.emit(); await this._gate(); continue; }
      this._beforeHand();
      if (this._isFinished() || !this.table.canDeal()) break;
      if (this.tour) this._playOtherTables();
      const hand = playHandSync(this.table, this._agentFor, { ...this._viewExtra(), onDecision: (p, d) => this._onDecision(p, d) });
      this.cursor = 0;
      this._processEvents(hand, true);
      this.stats.recordHand(hand);
      this._afterHand();
      if (performance.now() - last > 40) {
        this.emit();
        await new Promise((r) => setTimeout(r, 0));
        last = performance.now();
      }
    }
    this.emit();
  }

  _afterHand() {
    this.handsPlayed++;
    const ids = [...this.players.keys()];
    this.stats.sample(this.handsPlayed, ids);
    if (this.tour) {
      for (const line of this.tour.endRound()) this.addLog(line, 'tour');
      if (!this.tour.isOver()) {
        const next = this._pickWatchedTable();
        if (next !== this.table) {
          this.table = next;
          this.cursor = 0;
        }
      }
    }
  }

  _pickWatchedTable() {
    const human = [...this.players.values()].find((p) => p.kind === 'human' && this.tour.tableOf(p.id));
    if (human) return this.tour.tableOf(human.id);
    if (this.watchId) {
      const t = this.tour.tables.find((x) => x.id === this.watchId);
      if (t && t.canDeal()) return t;
    }
    if (this.table && this.tour.tables.includes(this.table) && this.table.canDeal()) return this.table;
    return this.tour.tables.find((t) => t.canDeal()) || this.tour.tables[0];
  }

  /** Tournament: choose which table to watch (takes effect next hand). */
  watchTable(id) {
    this.watchId = id;
    if (!this.table.hand || this.table.hand.done) {
      const t = this.tour?.tables.find((x) => x.id === id);
      if (t && !this.hasHumans) { this.table = t; this.cursor = 0; this.emit(); }
    }
  }

  async _playHandAnimated() {
    const hand = this.table.startHand();
    this.cursor = 0;
    this.message = null;
    this._processEvents(hand);
    this.emit();
    await this._wait(PACE.deal);
    while (!hand.done && !this.stopped) {
      await this._gate();
      if (this.stopped) return;
      if (hand.phase === 'roundEnd') {
        hand.advance();
        this._processEvents(hand);
        this.emit();
        if (!hand.done) await this._wait(PACE.street);
        continue;
      }
      const p = hand.actor;
      const agent = this.agents.get(p.id);
      const view = buildView(hand, hand.toAct, this._viewExtra());
      let d;
      if (agent.kind === 'bot') {
        this.thinking = p.seat;
        this.emit();
        await this._wait(PACE.think * (0.55 + this.rng() * 0.9));
        if (this.stopped) return;
        if (hand.toAct < 0 || hand.actor !== p) continue;
        d = agent.decide(view);
        this._onDecision(p, d);
      } else {
        d = await this._askPerson(p, view);
        if (this.stopped) return;
      }
      this.thinking = -1;
      hand.act(d.type, d.amount);
      this._processEvents(hand);
      this.emit();
      await this._wait(PACE.act);
    }
    if (this.stopped) return;
    this.stats.recordHand(hand);
    this.emit();
    const showdown = hand.players.some((q) => q.shown);
    await this._wait(showdown ? PACE.endShowdown : PACE.end);
  }

  _askPerson(p, view) {
    return new Promise((resolve) => {
      const player = this.players.get(p.id);
      const total = (this.cfg.turnTime || 0) * 1000;
      const pending = { playerId: p.id, seat: p.seat, legal: view.legal, resolve, total, deadline: total ? Date.now() + total : 0, timer: null };
      this.pending = pending;
      if (total) {
        pending.timer = setTimeout(() => {
          if (this.pending !== pending) return;
          this.addLog(`${player.name} ran out of time`, 'minor');
          this.act(p.id, { type: 'check' });
        }, total);
      }
      if (player.away) {
        setTimeout(() => { if (this.pending === pending) this.act(p.id, { type: 'check' }); }, 900);
      }
      this.emit();
    });
  }

  /** A person (local or remote) acts. Returns false if it isn't their turn. */
  act(playerId, intent) {
    const pending = this.pending;
    if (!pending || pending.playerId !== playerId) return false;
    if (!intent || !VALID_INTENTS.has(intent.type)) return false;
    const clean = { type: intent.type, unit: intent.unit === 'chips' ? 'chips' : undefined, value: Number(intent.value) || 0 };
    if (clean.type === 'raise' || clean.type === 'bet') clean.unit = 'chips';
    const a = resolveIntent(clean, pending.legal, { freeFold: true });
    clearTimeout(pending.timer);
    this.pending = null;
    pending.resolve(a);
    return true;
  }

  /** Seat a new player (online tables). They are dealt in from the next hand. */
  addPlayer(p, seat) {
    const s = seat ?? this.table.firstEmptySeat();
    if (s < 0 || this.table.seats[s]) throw new Error('No empty seat');
    p.stack = p.stack ?? this.cfg.startingStack;
    this.players.set(p.id, p);
    this.agents.set(p.id, p.agent || { kind: p.kind });
    this.table.sit(s, p);
    this.stats.entry(p.id, p.name).buyIns = 1;
    this.emit();
    this.notifyChange();
    return s;
  }

  /** Remove a player between hands. */
  removePlayer(id) {
    if (this.table.hand && !this.table.hand.done && this.table.hand.players.some((q) => q.id === id)) {
      throw new Error('Cannot remove a player in the middle of a hand');
    }
    const seat = this.table.seats.findIndex((x) => x && x.id === id);
    if (seat >= 0) this.table.leave(seat);
    this.players.delete(id);
    this.agents.delete(id);
    this.says.delete(id);
    this.emit();
  }

  /** Mark a remote player as disconnected (auto check/fold) or back. */
  setAway(playerId, away) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.away = away;
    if (away && this.pending?.playerId === playerId) {
      setTimeout(() => { if (this.pending?.playerId === playerId && p.away) this.act(playerId, { type: 'check' }); }, 900);
    }
    this.emit();
  }

  // ------------------------------------------------------------- events
  _processEvents(hand, quiet = false) {
    const name = (seat) => hand.players.find((q) => q.seat === seat)?.name ?? `Seat ${seat + 1}`;
    for (; this.cursor < hand.events.length; this.cursor++) {
      const e = hand.events[this.cursor];
      if (quiet && e.type !== 'award' && e.type !== 'end') continue;
      switch (e.type) {
        case 'start': {
          const lvl = this.tour ? ` · level ${this.tour.level + 1}` : '';
          const tbl = this.tour && this.tour.tables.length > 1 ? ` · table ${this.table.id}` : '';
          this.addLog(`Hand #${e.handNumber} · blinds ${formatChips(e.sb)}/${formatChips(e.bb)}${e.ante ? ` ante ${formatChips(e.ante)}` : ''}${lvl}${tbl}`, 'hand');
          break;
        }
        case 'action':
          this.addLog(says(name(e.seat), describeAction({ ...e, type: e.action }, formatChips)), e.action === 'fold' ? 'minor' : 'action');
          break;
        case 'board': {
          const label = e.street[0].toUpperCase() + e.street.slice(1);
          this.addLog(`${label}: ${e.board.map(prettyCard).join(' ')}`, 'street');
          break;
        }
        case 'refund':
          this.addLog(`${formatChips(e.amount)} uncalled returned to ${name(e.seat)}`, 'minor');
          break;
        case 'showdown':
          for (const s of e.hands) this.addLog(says(name(s.seat), `shows ${s.cards.map(prettyCard).join(' ')} · ${s.handName}`), 'show');
          break;
        case 'award': {
          if (quiet) break;
          const names = e.winners.map((w) => name(w.seat));
          const who = names.length > 1 ? `${names.join(' & ')} split` : says(names[0], 'wins');
          const pot = e.side ? ' side pot' : '';
          const text = `${who}${pot} ${formatChips(e.amount)}${e.handName ? ` with ${e.handName}` : ''}`;
          this.addLog(text, 'win');
          if (!e.side) this.message = text;
          break;
        }
        default: break;
      }
    }
  }

  // ------------------------------------------------------------ snapshot
  /** Everything the table view needs, as plain JSON, for one viewer. */
  snapshot(viewerId = this.cfg.viewerId, opts = {}) {
    const t = this.table;
    const hand = t.hand;
    const bySeat = new Map();
    if (hand) for (const hp of hand.players) if (t.seats[hp.seat] === hp.ref) bySeat.set(hp.seat, hp);
    const handDone = !!hand?.done;
    const winners = new Set();
    let best = [];
    if (handDone) {
      for (const e of hand.events) if (e.type === 'award') for (const w of e.winners) winners.add(w.seat);
      const mainAward = hand.events.find((e) => e.type === 'award' && !e.side);
      if (mainAward) for (const w of mainAward.winners) { const hp = bySeat.get(w.seat); if (hp?.best) best.push(...hp.best); }
    }
    const reveal = opts.revealAll ?? this.revealAll;
    const now = Date.now();
    const seats = t.seats.map((pl, seat) => {
      if (!pl) return null;
      const hp = bySeat.get(seat);
      const meta = this.players.get(pl.id) || pl;
      const mine = pl.id === viewerId || (opts.ownerOf && opts.ownerOf(pl.id) === viewerId);
      let cards = [];
      if (hp && hp.hole.length) {
        const visible = mine || hp.shown || reveal;
        if (hp.folded) cards = visible && !hp.shown ? hp.hole.slice() : [];
        else cards = visible ? hp.hole.slice() : [-1, -1];
      }
      const say = this.says.get(pl.id);
      const pend = this.pending && this.pending.playerId === pl.id ? this.pending : null;
      return {
        seat, id: pl.id, name: meta.name, avatar: meta.avatar || '🙂', color: meta.color || '#4c8dff',
        kind: meta.kind, stack: hp ? hp.stack : pl.stack, bet: hp && !handDone ? hp.streetBet : 0,
        inHand: !!hp, folded: !!hp?.folded, allIn: !!hp?.allIn && !handDone, cards,
        action: hp && !handDone ? hp.lastAction : null,
        won: handDone && hp ? hp.won : 0, net: handDone && hp ? hp.stack - hp.startStack : 0,
        handName: hp?.shown ? hp.handName : null, winner: winners.has(seat),
        say: say && say.until > now ? { text: say.text, id: say.id } : null,
        away: !!meta.away, you: pl.id === viewerId, mine: !!mine,
        timer: pend && pend.total ? { left: Math.max(0, pend.deadline - now), total: pend.total, id: pend.deadline } : null,
        busted: pl.stack === 0 && !hp,
      };
    });
    let prompt = null;
    if (this.pending && this.pending.playerId === viewerId) {
      const L = this.pending.legal;
      prompt = { ...L, timeLeft: this.pending.total ? Math.max(0, this.pending.deadline - now) : 0, total: this.pending.total };
    }
    // Side pots only exist once someone is all-in; show what is already in the middle.
    const anyAllIn = hand && !handDone && hand.players.some((p) => !p.folded && p.allIn);
    const pots = anyAllIn ? hand.computePots(true).map((p) => p.amount) : [];
    return {
      v: 1,
      title: this.cfg.title || '',
      mode: this.mode,
      tableId: t.id ?? 1,
      maxSeats: t.maxSeats,
      handNumber: t.handNumber,
      street: hand ? hand.street : null,
      board: hand ? hand.board.slice() : [],
      pot: hand ? (handDone ? 0 : hand.collected()) : 0,
      potTotal: hand ? hand.potTotal() : 0,
      sidePots: pots.length > 1 ? pots : [],
      button: hand ? hand.players[hand.buttonIdx].seat : t.button,
      toAct: hand && !handDone && hand.actor ? hand.actor.seat : -1,
      blinds: { sb: t.smallBlind, bb: t.bigBlind, ante: t.ante },
      seats,
      handDone,
      best,
      message: handDone ? this.message : null,
      status: this.status,
      prompt,
      viewerId,
      tournament: this.tour ? this.tour.info() : null,
    };
  }

  /** Rows for the leaderboard / results screen. */
  results() {
    const rows = [];
    for (const p of this.players.values()) {
      const s = this.stats.get(p.id) || this.stats.entry(p.id, p.name);
      rows.push({
        id: p.id, name: p.name, avatar: p.avatar, color: p.color, kind: p.kind, ref: p.ref,
        stack: p.stack, hands: s.hands, net: s.net,
        bb100: s.hands ? (s.net / (this.cfg.bb || 20)) / s.hands * 100 : 0,
        vpip: s.vpip, pfr: s.pfr, af: s.af, handsWon: s.handsWon,
        showdowns: s.showdowns, showdownsWon: s.showdownsWon, biggestPot: s.biggestPot,
        buyIns: s.buyIns, place: p.place ?? null, history: s.history,
      });
    }
    if (this.tour) {
      const order = this.tour.standings().map((p) => p.id);
      rows.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    } else rows.sort((a, b) => b.net - a.net);
    return rows;
  }
}
