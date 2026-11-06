// No-limit Texas Hold'em rules engine.
//
// Table holds seats and moves the button between hands. Hand runs one hand
// as a small state machine:
//   phase 'betting'  -> someone must act: call hand.legal(), then hand.act()
//   phase 'roundEnd' -> betting is closed: call hand.advance() to deal the
//                       next street, run out the board, or settle the pot
//   phase 'done'     -> settled; stacks are written back to the players
// Every step appends to hand.events so a UI can animate and log it.
//
// Rules implemented:
//  - Heads-up: the button posts the small blind and acts first preflop,
//    last postflop.
//  - A big blind that is all-in for less still sets the bet at a full big
//    blind; the minimum raise is always at least the last full raise.
//  - An all-in for less than a full raise does not reopen the betting to
//    players who already acted, unless such raises add up to a full raise.
//  - Nobody may raise when every other live player is all-in.
//  - Uncalled chips are returned when a betting round closes.
//  - Side pots by contribution level; split pots share equally, odd chips
//    go to the first winners left of the button.

import { newDeck, shuffle } from './cards.js';
import { evaluate, describeScore, bestFive } from './evaluator.js';

export const STREETS = ['preflop', 'flop', 'turn', 'river'];

export class Table {
  constructor({ maxSeats = 9, smallBlind = 10, bigBlind = 20, ante = 0, rng }) {
    if (!rng) throw new Error('Table needs an rng');
    this.maxSeats = maxSeats;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.ante = ante;
    this.rng = rng;
    this.seats = new Array(maxSeats).fill(null);
    this.button = -1;
    this.handNumber = 0;
    this.hand = null;
  }

  sit(seat, player) {
    if (seat < 0 || seat >= this.maxSeats) throw new Error(`No seat ${seat}`);
    if (this.seats[seat]) throw new Error(`Seat ${seat} is taken`);
    this.seats[seat] = player;
    return seat;
  }

  leave(seat) {
    const p = this.seats[seat];
    this.seats[seat] = null;
    return p;
  }

  firstEmptySeat() {
    return this.seats.findIndex((s) => !s);
  }

  /** Seats that can be dealt in: occupied, with chips, not sitting out. */
  activeSeats() {
    const out = [];
    for (let i = 0; i < this.maxSeats; i++) {
      const p = this.seats[i];
      if (p && p.stack > 0 && !p.sittingOut) out.push(i);
    }
    return out;
  }

  canDeal() {
    return this.activeSeats().length >= 2 && (!this.hand || this.hand.done);
  }

  setBlinds(smallBlind, bigBlind, ante = 0) {
    this.smallBlind = smallBlind; this.bigBlind = bigBlind; this.ante = ante;
  }

  /** opts.deck: a fixed 52-card order (tests and replays). */
  startHand(opts = {}) {
    if (this.hand && !this.hand.done) throw new Error('A hand is already running');
    const active = this.activeSeats();
    if (active.length < 2) throw new Error('Need at least two players with chips');
    if (this.button < 0 || !active.length) {
      this.button = active[Math.floor(this.rng() * active.length)];
    } else {
      this.button = active.find((s) => s > this.button) ?? active[0];
    }
    this.handNumber++;
    this.hand = new Hand({
      table: this,
      seats: active,
      button: this.button,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      ante: this.ante,
      rng: this.rng,
      handNumber: this.handNumber,
      deck: opts.deck,
    });
    return this.hand;
  }
}

export class Hand {
  constructor({ table, seats, button, smallBlind, bigBlind, ante = 0, rng, handNumber = 1, deck }) {
    this.table = table;
    this.handNumber = handNumber;
    this.sb = smallBlind;
    this.bb = bigBlind;
    this.ante = ante;
    this.players = seats.map((seat) => {
      const ref = table.seats[seat];
      return {
        seat, ref, id: ref.id, name: ref.name,
        stack: ref.stack, startStack: ref.stack,
        hole: [], folded: false, allIn: false,
        streetBet: 0, totalBet: 0,
        acted: false, actedAt: 0,
        lastAction: null, shown: false, won: 0,
        score: 0, handName: '',
      };
    });
    this.n = this.players.length;
    this.buttonIdx = this.players.findIndex((p) => p.seat === button);
    if (this.buttonIdx < 0) throw new Error('Button seat is not dealt in');
    this.board = [];
    this.street = 'preflop';
    this.phase = 'betting';
    this.events = [];
    this.actions = [];
    this.currentBet = 0;
    this.lastRaiseSize = bigBlind;
    this.raises = 0;
    this.aggressor = { preflop: -1, flop: -1, turn: -1, river: -1 };
    this.toAct = -1;
    this.done = false;
    this.pots = [];
    this.deck = deck ? deck.slice() : shuffle(newDeck(), rng);
    this.deckPos = 0;
    this._start();
  }

  _draw() { return this.deck[this.deckPos++]; }
  next(i) { return (i + 1) % this.n; }
  idxOfSeat(seat) { return this.players.findIndex((p) => p.seat === seat); }
  get actor() { return this.toAct >= 0 ? this.players[this.toAct] : null; }

  _start() {
    const n = this.n, bi = this.buttonIdx;
    this.sbIdx = n === 2 ? bi : (bi + 1) % n;
    this.bbIdx = n === 2 ? (bi + 1) % n : (bi + 2) % n;
    this.events.push({
      type: 'start', handNumber: this.handNumber,
      button: this.players[bi].seat, sbSeat: this.players[this.sbIdx].seat, bbSeat: this.players[this.bbIdx].seat,
      sb: this.sb, bb: this.bb, ante: this.ante,
    });
    if (this.ante > 0) {
      for (const p of this.players) {
        const amt = Math.min(this.ante, p.stack);
        if (amt <= 0) continue;
        p.stack -= amt; p.totalBet += amt;
        if (p.stack === 0) p.allIn = true;
        this.events.push({ type: 'post', seat: p.seat, blind: 'ante', amount: amt, allIn: p.allIn });
      }
    }
    this._post(this.sbIdx, this.sb, 'sb');
    this._post(this.bbIdx, this.bb, 'bb');
    this.currentBet = this.bb;
    this.lastRaiseSize = this.bb;
    const start = (bi + 1) % n;
    for (let r = 0; r < 2; r++) for (let k = 0; k < n; k++) this.players[(start + k) % n].hole.push(this._draw());
    this.events.push({ type: 'deal' });
    const first = n === 2 ? this.sbIdx : (this.bbIdx + 1) % n;
    this.toAct = this._findActor(first);
    if (this.toAct < 0) this._endRound();
  }

  _post(idx, amount, blind) {
    const p = this.players[idx];
    const amt = Math.min(amount, p.stack);
    if (amt <= 0) return;
    this._commit(p, amt);
    this.events.push({ type: 'post', seat: p.seat, blind, amount: amt, allIn: p.allIn });
  }

  _commit(p, amt) {
    amt = Math.min(amt, p.stack);
    p.stack -= amt; p.streetBet += amt; p.totalBet += amt;
    if (p.stack === 0) p.allIn = true;
    return amt;
  }

  _othersCanAct(i) {
    for (let j = 0; j < this.n; j++) {
      if (j !== i && !this.players[j].folded && !this.players[j].allIn) return true;
    }
    return false;
  }

  _maxOtherBet(i) {
    let m = 0;
    for (let j = 0; j < this.n; j++) {
      if (j !== i && !this.players[j].folded) m = Math.max(m, this.players[j].streetBet);
    }
    return m;
  }

  _callTarget(i, others = this._othersCanAct(i)) {
    return others ? this.currentBet : Math.min(this.currentBet, this._maxOtherBet(i));
  }

  _toCall(i) {
    const p = this.players[i];
    return Math.max(0, Math.min(this._callTarget(i) - p.streetBet, p.stack));
  }

  _needsToAct(i) {
    const p = this.players[i];
    if (p.folded || p.allIn) return false;
    if (this._toCall(i) > 0) return true;
    return !p.acted && this._othersCanAct(i);
  }

  _findActor(from) {
    for (let k = 0; k < this.n; k++) {
      const i = (from + k) % this.n;
      if (this._needsToAct(i)) return i;
    }
    return -1;
  }

  liveCount() { return this.players.filter((p) => !p.folded).length; }
  potTotal() { return this.players.reduce((s, p) => s + p.totalBet, 0); }
  /** Chips already gathered into the middle (not counting bets in front of players). */
  collected() { return this.players.reduce((s, p) => s + p.totalBet - p.streetBet, 0); }

  /** Legal options for the player to act. */
  legal() {
    if (this.phase !== 'betting') return null;
    const i = this.toAct, p = this.players[i];
    const others = this._othersCanAct(i);
    const toCall = Math.max(0, Math.min(this._callTarget(i, others) - p.streetBet, p.stack));
    const reopened = !p.acted || this.currentBet - p.actedAt >= this.lastRaiseSize;
    const canRaise = others && p.stack > toCall && reopened;
    const maxRaiseTo = p.streetBet + p.stack;
    const minRaiseTo = Math.min(this.currentBet + this.lastRaiseSize, maxRaiseTo);
    return {
      idx: i, seat: p.seat, street: this.street,
      toCall, canCheck: toCall === 0, canRaise,
      minRaiseTo, maxRaiseTo,
      currentBet: this.currentBet, streetBet: p.streetBet, stack: p.stack,
      pot: this.potTotal(), bb: this.bb, sb: this.sb, isBet: this.currentBet === 0,
    };
  }

  /**
   * Apply an action for the player to act. type: fold | check | call | raise.
   * For raise, `amount` is the total the player's bet becomes this street
   * ("raise to"). Throws on anything illegal; see actions.js to turn loose
   * intents ("raise half pot") into legal actions first.
   */
  act(type, amount = 0) {
    if (this.phase !== 'betting') throw new Error('No action is expected right now');
    const i = this.toAct, p = this.players[i];
    const L = this.legal();
    let rec;
    switch (type) {
      case 'fold':
        p.folded = true;
        rec = { type: 'fold', amount: 0 };
        break;
      case 'check':
        if (L.toCall !== 0) throw new Error(`${p.name} cannot check facing ${L.toCall}`);
        rec = { type: 'check', amount: 0 };
        break;
      case 'call': {
        if (L.toCall === 0) { rec = { type: 'check', amount: 0 }; break; }
        const amt = this._commit(p, L.toCall);
        rec = { type: 'call', amount: amt };
        break;
      }
      case 'raise': {
        if (!L.canRaise) throw new Error(`${p.name} is not allowed to raise`);
        const to = Math.floor(Number(amount));
        if (!Number.isFinite(to) || to > L.maxRaiseTo) throw new Error(`Raise to ${amount} exceeds stack`);
        if (to < L.minRaiseTo) throw new Error(`Raise to ${to} is below the minimum ${L.minRaiseTo}`);
        if (to <= this.currentBet) throw new Error(`Raise to ${to} must exceed ${this.currentBet}`);
        const prevBet = this.currentBet;
        const add = this._commit(p, to - p.streetBet);
        const inc = to - prevBet;
        if (inc >= this.lastRaiseSize) {
          this.lastRaiseSize = inc;
          for (const q of this.players) if (q !== p && !q.folded && !q.allIn) q.acted = false;
        }
        this.currentBet = to;
        this.raises++;
        this.aggressor[this.street] = i;
        rec = { type: prevBet === 0 ? 'bet' : 'raise', amount: add, to };
        break;
      }
      default:
        throw new Error(`Unknown action "${type}"`);
    }
    p.acted = true;
    p.actedAt = this.currentBet;
    rec.allIn = p.allIn;
    rec.to = rec.to ?? p.streetBet;
    p.lastAction = rec;
    this.actions.push({ street: this.street, idx: i, seat: p.seat, ...rec });
    this.events.push({ ...rec, type: 'action', action: rec.type, seat: p.seat, street: this.street });

    if (this.liveCount() === 1) { this._endRound(); return; }
    const nxt = this._findActor(this.next(i));
    if (nxt >= 0) this.toAct = nxt;
    else this._endRound();
  }

  _endRound() {
    this.toAct = -1;
    this.phase = 'roundEnd';
    let maxIdx = -1;
    for (let i = 0; i < this.n; i++) {
      if (maxIdx < 0 || this.players[i].streetBet > this.players[maxIdx].streetBet) maxIdx = i;
    }
    let second = 0;
    for (let i = 0; i < this.n; i++) if (i !== maxIdx) second = Math.max(second, this.players[i].streetBet);
    const top = this.players[maxIdx];
    if (top && top.streetBet > second) {
      const refund = top.streetBet - second;
      top.streetBet -= refund; top.totalBet -= refund; top.stack += refund;
      if (top.stack > 0) top.allIn = false;
      this.events.push({ type: 'refund', seat: top.seat, amount: refund });
    }
    for (const p of this.players) p.streetBet = 0;
    this.events.push({ type: 'collect', pot: this.potTotal() });
  }

  /** Move past a closed betting round: next street, runout, or settle. */
  advance() {
    if (this.phase !== 'roundEnd') throw new Error('Betting is still open');
    const live = this.players.filter((p) => !p.folded);
    if (live.length === 1) return this._awardUncontested(live[0]);
    if (this.street === 'river') return this._showdown();
    const street = STREETS[STREETS.indexOf(this.street) + 1];
    this._draw(); // burn
    const cards = [];
    for (let k = 0; k < (street === 'flop' ? 3 : 1); k++) cards.push(this._draw());
    this.board.push(...cards);
    this.street = street;
    for (const p of this.players) { p.streetBet = 0; p.acted = false; p.actedAt = 0; p.lastAction = null; }
    this.currentBet = 0;
    this.lastRaiseSize = this.bb;
    this.raises = 0;
    const canAct = live.filter((p) => !p.allIn).length;
    const runout = canAct < 2;
    this.events.push({ type: 'board', street, cards, board: this.board.slice(), runout });
    if (!runout) {
      const a = this._findActor(this.next(this.buttonIdx));
      if (a >= 0) { this.toAct = a; this.phase = 'betting'; return; }
    }
    this.phase = 'roundEnd';
  }

  /**
   * Main pot and side pots from each player's total contribution.
   * collectedOnly: ignore bets still in front of players (for display mid-round).
   */
  computePots(collectedOnly = false) {
    const put = (p) => p.totalBet - (collectedOnly ? p.streetBet : 0);
    const liveIdx = [];
    for (let i = 0; i < this.n; i++) if (!this.players[i].folded) liveIdx.push(i);
    const levels = [...new Set(liveIdx.map((i) => put(this.players[i])))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const p of this.players) amount += Math.max(0, Math.min(put(p), level) - prev);
      const eligible = liveIdx.filter((i) => put(this.players[i]) >= level);
      if (amount > 0) pots.push({ amount, eligible });
      prev = level;
    }
    let leftover = 0;
    for (const p of this.players) leftover += Math.max(0, put(p) - prev);
    if (leftover > 0) {
      if (pots.length) pots[pots.length - 1].amount += leftover;
      else pots.push({ amount: leftover, eligible: liveIdx });
    }
    return pots;
  }

  _awardUncontested(p) {
    const amount = this.potTotal();
    p.stack += amount; p.won += amount;
    this.pots = [{ amount, eligible: [this.players.indexOf(p)] }];
    this.events.push({ type: 'award', potIndex: 0, amount, winners: [{ seat: p.seat, amount }], handName: null, uncontested: true });
    this._finish();
  }

  _showdown() {
    const live = this.players.filter((p) => !p.folded);
    for (const p of live) {
      const seven = [...p.hole, ...this.board];
      p.score = evaluate(seven);
      p.handName = describeScore(p.score);
      p.best = bestFive(seven);
      p.shown = true;
    }
    this.events.push({
      type: 'showdown',
      hands: live.map((p) => ({ seat: p.seat, cards: p.hole.slice(), handName: p.handName, best: p.best })),
    });
    this.pots = this.computePots();
    const orderFromButton = (i) => (i - this.buttonIdx - 1 + this.n) % this.n;
    this.pots.forEach((pot, potIndex) => {
      let best = -1;
      for (const i of pot.eligible) best = Math.max(best, this.players[i].score);
      const winners = pot.eligible.filter((i) => this.players[i].score === best)
        .sort((a, b) => orderFromButton(a) - orderFromButton(b));
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      const paid = winners.map((i) => {
        const amt = share + (odd > 0 ? 1 : 0);
        if (odd > 0) odd--;
        this.players[i].stack += amt;
        this.players[i].won += amt;
        return { seat: this.players[i].seat, amount: amt };
      });
      this.events.push({ type: 'award', potIndex, amount: pot.amount, winners: paid, handName: describeScore(best), side: potIndex > 0 });
    });
    this._finish();
  }

  _finish() {
    this.phase = 'done';
    this.done = true;
    this.toAct = -1;
    for (const p of this.players) p.ref.stack = p.stack;
    this.events.push({ type: 'end', handNumber: this.handNumber });
  }
}
