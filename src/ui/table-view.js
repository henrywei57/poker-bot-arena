// Renders a table snapshot (see GameSession.snapshot) and animates the
// difference from the previous one: cards fly from the deck, flip over,
// bets slide into the pot, the pot slides to the winner.

import { h } from './dom.js';
import { cardEl, setCard } from './cards.js';
import { formatChips } from '../util.js';

const ACTION_LABEL = { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise' };

export class TableView {
  constructor(host, opts = {}) {
    this.opts = opts;
    this.root = h('div', { class: 'tv' });
    this.stage = h('div', { class: 'tv-stage' });
    this.root.append(this.stage);
    host.append(this.root);
    this.maxSeats = 0;
    this.heroSeat = -1;
    this.prev = null;
    this.k = 1;
    this.portrait = false;
    this.ro = new ResizeObserver(() => this._checkOrientation());
    this.ro.observe(this.root);
  }

  destroy() { this.ro.disconnect(); this.root.remove(); }

  _checkOrientation() {
    const w = this.root.clientWidth;
    const portrait = w > 0 && w < 640;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.root.classList.toggle('portrait', portrait);
      if (this.maxSeats) this._position();
    }
  }

  _build(maxSeats, hero) {
    this.maxSeats = maxSeats;
    this.heroSeat = hero;
    this.stage.replaceChildren();
    this.felt = h('div', { class: 'felt' });
    this.feltInner = h('div', { class: 'felt-inner' });
    this.logo = h('div', { class: 'felt-logo' }, h('span', null, '♠'), ' Poker Bot Arena');
    this.boardEl = h('div', { class: 'board' });
    this.boardSlots = [];
    for (let i = 0; i < 5; i++) {
      const slot = h('div', { class: 'board-slot' });
      this.boardEl.append(slot);
      this.boardSlots.push({ el: slot, card: null });
    }
    this.potEl = h('div', { class: 'pot' }, h('span', { class: 'chip-icon' }), h('b', null, ''));
    this.sideEl = h('div', { class: 'side-pots' });
    this.msgEl = h('div', { class: 'felt-msg' });
    this.deckEl = h('div', { class: 'deck' });
    this.statusEl = h('div', { class: 'tv-status' });
    this.feltInner.append(this.logo, this.msgEl, this.boardEl, this.potEl, this.sideEl, this.deckEl);
    this.felt.append(this.feltInner);
    this.stage.append(this.felt);
    this.dealerEl = h('div', { class: 'dealer-btn', title: 'Dealer button' }, 'D');
    this.stage.append(this.dealerEl);
    this.seats = [];
    this.bets = [];
    for (let s = 0; s < maxSeats; s++) {
      const bet = h('div', { class: 'bet' }, h('span', { class: 'chips' }), h('b', null, ''));
      const seat = {
        el: h('div', { class: 'seat empty', dataset: { seat: s } }),
        cardsEl: h('div', { class: 'seat-cards' }),
        cards: [null, null],
        avatar: h('div', { class: 'avatar' }),
        name: h('div', { class: 'name' }),
        stack: h('div', { class: 'stack' }),
        timer: h('div', { class: 'timer' }, h('i')),
        tag: h('div', { class: 'tag' }),
        handName: h('div', { class: 'hand-name' }),
        bubble: h('div', { class: 'bubble' }),
        win: h('div', { class: 'win-amt' }),
        sayId: null, timerId: null, bubbleTimer: null,
      };
      const plate = h('div', { class: 'plate' }, seat.avatar, h('div', { class: 'meta' }, seat.name, seat.stack), seat.timer);
      seat.el.append(seat.cardsEl, plate, seat.tag, seat.handName, seat.bubble, seat.win);
      this.stage.append(seat.el, bet);
      this.seats.push(seat);
      this.bets.push({ el: bet, amount: 0 });
    }
    this.stage.append(this.statusEl);
    this._position();
  }

  _display(seat) { return (seat - this.heroSeat + this.maxSeats) % this.maxSeats; }

  _angle(seat) { return Math.PI / 2 + (this._display(seat) * 2 * Math.PI) / this.maxSeats; }

  _position() {
    const [RX, RY] = this.portrait ? [41, 42] : [44, 40];
    for (let s = 0; s < this.maxSeats; s++) {
      const a = this._angle(s);
      const c = Math.cos(a), sn = Math.sin(a);
      Object.assign(this.seats[s].el.style, { left: `${50 + RX * c}%`, top: `${50 + RY * sn}%` });
      this.seats[s].el.classList.toggle('top-half', sn < -0.2);
      this.seats[s].el.classList.toggle('left-side', c < -0.3);
      this.seats[s].el.classList.toggle('right-side', c > 0.3);
      const bx = this.portrait ? 0.6 : 0.64, by = this.portrait ? 0.6 : 0.56;
      Object.assign(this.bets[s].el.style, { left: `${50 + RX * bx * c}%`, top: `${50 + RY * by * sn}%` });
    }
    if (this.prev) this._placeDealer(this.prev.button);
  }

  _placeDealer(seat) {
    if (seat == null || seat < 0 || seat >= this.maxSeats) { this.dealerEl.style.opacity = '0'; return; }
    const [RX, RY] = this.portrait ? [41, 42] : [44, 40];
    const a = this._angle(seat) + (this.portrait ? 0.32 : 0.24);
    Object.assign(this.dealerEl.style, { opacity: '1', left: `${50 + RX * 0.72 * Math.cos(a)}%`, top: `${50 + RY * 0.7 * Math.sin(a)}%` });
  }

  /** Main entry point. opts.speed: number or 'instant'. */
  render(snap, opts = {}) {
    const speed = opts.speed ?? 1;
    this.k = speed === 'instant' ? 0 : 1 / speed;
    this.root.style.setProperty('--k', String(this.k));
    this.root.classList.toggle('no-anim', this.k === 0 || !!opts.noAnim);
    this.root.classList.toggle('show-empty', !!opts.showEmpty);
    const youSeat = snap.seats.find((s) => s && (s.you || s.mine));
    const hero = opts.heroSeat ?? (youSeat ? youSeat.seat : 0);
    if (snap.maxSeats !== this.maxSeats || hero !== this.heroSeat) {
      this._build(snap.maxSeats, hero);
      this.prev = null;
    }
    const prev = this.prev;
    const anim = this.k > 0 && !opts.noAnim && document.visibilityState !== 'hidden';
    const newHand = !prev || prev.handNumber !== snap.handNumber || prev.tableId !== snap.tableId;
    const best = new Set(snap.best || []);
    const showdown = snap.handDone && snap.seats.some((s) => s && s.handName);

    // Board
    snap.board.forEach((c, i) => {
      const slot = this.boardSlots[i];
      if (slot.card && slot.card._card === c && !newHand) return;
      if (slot.card) slot.card.remove();
      const el = cardEl(-1, 'board-card');
      slot.el.append(el);
      slot.card = el;
      const fresh = !prev || newHand || (prev.board || []).length <= i;
      if (anim && fresh) {
        const firstNew = prev && !newHand ? prev.board.length : 0;
        const delay = (i - firstNew) * 110 * this.k;
        this._fly(el, this.deckEl, delay, 380 * this.k);
        setTimeout(() => setCard(el, c), delay + 260 * this.k);
      } else setCard(el, c);
    });
    for (let i = snap.board.length; i < 5; i++) {
      const slot = this.boardSlots[i];
      if (slot.card) { slot.card.remove(); slot.card = null; }
    }
    this.boardSlots.forEach((slot) => {
      if (!slot.card) return;
      slot.card.classList.toggle('best', showdown && best.has(slot.card._card));
      slot.card.classList.toggle('dim', showdown && best.size > 0 && !best.has(slot.card._card));
    });

    // Pot
    const potAmount = snap.handDone ? 0 : snap.pot;
    this.potEl.classList.toggle('show', potAmount > 0);
    this.potEl.querySelector('b').textContent = formatChips(potAmount);
    this.sideEl.textContent = snap.sidePots && snap.sidePots.length > 1
      ? snap.sidePots.map((p, i) => `${i ? `Side ${i}` : 'Main'} ${formatChips(p)}`).join('  ·  ') : '';
    this.msgEl.textContent = snap.message || '';
    this.msgEl.classList.toggle('show', !!snap.message);
    this.logo.classList.toggle('hide', !!snap.message);
    this.statusEl.textContent = snap.status || '';
    this.statusEl.classList.toggle('show', !!snap.status);

    // Dealing order for the fly-in delay
    const inHand = snap.seats.filter((s) => s && s.inHand).map((s) => s.seat)
      .sort((a, b) => ((a - snap.button - 1 + snap.maxSeats) % snap.maxSeats) - ((b - snap.button - 1 + snap.maxSeats) % snap.maxSeats));

    // Seats
    for (let s = 0; s < this.maxSeats; s++) {
      const data = snap.seats[s];
      const ui = this.seats[s];
      const pd = prev ? prev.seats[s] : null;
      const samePlayer = pd && data && pd.id === data.id;
      ui.el.classList.toggle('empty', !data);
      if (!data) {
        ui.cards.forEach((c) => c && c.remove());
        ui.cards = [null, null];
        ui.name.textContent = this.opts.emptyLabel || 'Empty seat';
        ui.stack.textContent = '';
        ui.avatar.textContent = '';
        ui.el.className = 'seat empty' + this._sideClasses(ui.el);
        this._setBet(s, 0, prev, newHand, anim);
        continue;
      }
      ui.el.classList.toggle('hero', s === this.heroSeat && (data.you || data.mine));
      ui.el.classList.toggle('acting', snap.toAct === s);
      ui.el.classList.toggle('folded', data.folded);
      ui.el.classList.toggle('out', !data.inHand);
      ui.el.classList.toggle('allin', data.allIn);
      ui.el.classList.toggle('winner', !!(snap.handDone && data.winner));
      ui.el.classList.toggle('away', !!data.away);
      ui.el.style.setProperty('--seat-color', data.color);
      if (ui.avatar.textContent !== data.avatar) ui.avatar.textContent = data.avatar;
      ui.name.textContent = data.name + (data.you && data.name !== 'You' ? ' (you)' : '');
      ui.stack.textContent = data.busted ? 'Busted' : data.allIn && data.stack === 0 ? 'All-in' : formatChips(data.stack);

      // Cards
      if (newHand || !samePlayer) { ui.cards.forEach((c) => c && c.remove()); ui.cards = [null, null]; }
      for (let k = 0; k < 2; k++) {
        const want = data.cards[k];
        let el = ui.cards[k];
        if (want === undefined) { if (el) { el.remove(); ui.cards[k] = null; } continue; }
        if (!el) {
          el = cardEl(-1, 'seat-card');
          el.style.setProperty('--k-i', String(k));
          ui.cardsEl.append(el);
          ui.cards[k] = el;
          if (anim) {
            const order = inHand.indexOf(s);
            const delay = (k * inHand.length + Math.max(0, order)) * 75 * this.k;
            this._fly(el, this.deckEl, delay, 340 * this.k);
            if (want >= 0) setTimeout(() => setCard(el, want), delay + 300 * this.k);
          } else setCard(el, want);
        } else if (el._card !== want) {
          setCard(el, want);
        }
        el.classList.toggle('best', showdown && best.has(want));
        el.classList.toggle('dim', showdown && best.size > 0 && want >= 0 && !best.has(want) && !!data.handName);
      }

      // Action tag
      const a = data.action;
      if (a && !snap.handDone) {
        const label = a.allIn && a.type !== 'fold' && a.type !== 'check' ? 'All-in' : ACTION_LABEL[a.type] || a.type;
        const amt = a.type === 'call' ? a.amount : a.type === 'bet' || a.type === 'raise' ? a.to : 0;
        ui.tag.textContent = amt && !(a.allIn && a.type !== 'call') ? `${label} ${formatChips(amt)}` : label;
        ui.tag.className = `tag show ${a.allIn && a.type !== 'fold' ? 'allin' : a.type}`;
      } else if (data.away) {
        ui.tag.textContent = 'Away'; ui.tag.className = 'tag show away';
      } else {
        ui.tag.className = 'tag';
      }

      ui.handName.textContent = data.handName || '';
      ui.handName.classList.toggle('show', !!data.handName);

      // Winnings
      if (snap.handDone && data.won > 0) {
        ui.win.textContent = `+${formatChips(data.won)}`;
        if (!prev?.handDone || newHand) {
          ui.win.classList.remove('show');
          void ui.win.offsetWidth;
          ui.win.classList.add('show');
          if (anim) this._chips(this.potEl, ui.avatar, 520 * this.k, 160 * this.k);
        }
      } else ui.win.classList.remove('show');

      // Bubble
      if (data.say && data.say.id !== ui.sayId) {
        ui.sayId = data.say.id;
        ui.bubble.textContent = data.say.text;
        ui.bubble.classList.add('show');
        clearTimeout(ui.bubbleTimer);
        ui.bubbleTimer = setTimeout(() => ui.bubble.classList.remove('show'), Math.max(900, 2600 * (this.k || 0.1)));
      }

      // Turn timer
      if (data.timer && data.timer.id !== ui.timerId) {
        ui.timerId = data.timer.id;
        const bar = ui.timer.firstChild;
        ui.timer.classList.add('show');
        bar.getAnimations().forEach((x) => x.cancel());
        const from = Math.max(0, Math.min(1, data.timer.left / data.timer.total));
        bar.animate([{ transform: `scaleX(${from})` }, { transform: 'scaleX(0)' }], { duration: data.timer.left, easing: 'linear', fill: 'forwards' });
      } else if (!data.timer) {
        ui.timerId = null;
        ui.timer.classList.remove('show');
      }

      this._setBet(s, data.bet, prev, newHand, anim);
    }

    this._placeDealer(snap.button);
    this.prev = snap;
  }

  _sideClasses(el) {
    return ['top-half', 'left-side', 'right-side'].filter((c) => el.classList.contains(c)).map((c) => ` ${c}`).join('');
  }

  _setBet(s, amount, prev, newHand, anim) {
    const b = this.bets[s];
    const before = b.amount;
    b.amount = amount;
    b.el.classList.toggle('show', amount > 0);
    if (amount > 0) {
      b.el.querySelector('b').textContent = formatChips(amount);
      b.el.querySelector('.chips').dataset.n = String(Math.min(4, 1 + Math.floor(Math.log10(Math.max(1, amount)) / 1.2)));
      if (anim && amount > before) b.el.animate([{ transform: 'translate(-50%,-50%) scale(1.25)' }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 220 * this.k });
    } else if (before > 0 && anim && !newHand) {
      this._chips(b.el, this.potEl, 420 * this.k, 0);
    }
  }

  /** Animate `el` flying in from the centre of `from`. */
  _fly(el, from, delay, duration) {
    const a = from.getBoundingClientRect(), b = el.getBoundingClientRect();
    if (!b.width) return;
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    el.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(.5) rotate(-28deg)`, opacity: 0 },
      { transform: `translate(${dx * 0.15}px, ${dy * 0.15}px) scale(1.04) rotate(-4deg)`, opacity: 1, offset: 0.8 },
      { transform: 'none', opacity: 1 },
    ], { duration, delay, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'backwards' });
  }

  /** A little stack of chips sliding from one element to another. */
  _chips(fromEl, toEl, duration, delay) {
    const st = this.stage.getBoundingClientRect();
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    if (!a.width || !b.width || !st.width) return;
    const x0 = a.left + a.width / 2 - st.left, y0 = a.top + a.height / 2 - st.top;
    const x1 = b.left + b.width / 2 - st.left, y1 = b.top + b.height / 2 - st.top;
    const g = h('div', { class: 'chip-ghost', style: { left: `${x0}px`, top: `${y0}px` } }, h('i'), h('i'), h('i'));
    this.stage.append(g);
    const anim = g.animate([
      { transform: 'translate(-50%, -50%)', opacity: 1 },
      { transform: `translate(calc(-50% + ${x1 - x0}px), calc(-50% + ${y1 - y0}px))`, opacity: 0.9 },
    ], { duration, delay, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'forwards' });
    anim.onfinish = () => g.remove();
    anim.oncancel = () => g.remove();
    // Background tabs may never finish the animation: clean up regardless.
    setTimeout(() => g.remove(), duration + delay + 400);
  }
}
