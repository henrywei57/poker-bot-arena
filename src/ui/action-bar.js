// Fold / check / call / raise controls for a human player, with a bet
// slider, pot-fraction presets and keyboard shortcuts (F, C, R, A).

import { h, btn } from './dom.js';
import { raiseTarget } from '../engine/actions.js';
import { formatChips } from '../util.js';

export class ActionBar {
  constructor(host, onAction) {
    this.onAction = onAction;
    this.prompt = null;
    this.root = h('div', { class: 'action-bar', 'aria-live': 'polite' });
    host.append(this.root);
    this.onKey = (e) => {
      if (!this.prompt || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        if (!(t.classList?.contains('raise-input') && e.key === 'Enter')) return;
      }
      const k = e.key.toLowerCase();
      if (k === 'f' && this.prompt.toCall > 0) { e.preventDefault(); this._send({ type: 'fold' }); }
      else if (k === 'c' || k === 'k') { e.preventDefault(); this._send({ type: this.prompt.toCall > 0 ? 'call' : 'check' }); }
      else if ((k === 'r' || k === 'b' || k === 'enter') && this.prompt.canRaise) { e.preventDefault(); this._raise(); }
      else if (k === 'a' && this.prompt.canRaise) { e.preventDefault(); this._send({ type: 'raise', unit: 'chips', value: this.prompt.maxRaiseTo }); }
    };
    document.addEventListener('keydown', this.onKey);
  }

  destroy() { document.removeEventListener('keydown', this.onKey); this.root.remove(); }

  _send(intent) {
    if (!this.prompt) return;
    this.prompt = null;
    this.root.classList.remove('show');
    this.onAction(intent);
  }

  _raise() {
    const v = Math.round(Number(this.input.value));
    this._send({ type: 'raise', unit: 'chips', value: Number.isFinite(v) ? v : this.prompt.minRaiseTo });
  }

  hide() {
    this.prompt = null;
    this.root.classList.remove('show');
  }

  show(prompt) {
    const same = this.prompt && this.promptKey === `${prompt.street}|${prompt.toCall}|${prompt.minRaiseTo}|${prompt.maxRaiseTo}|${prompt.pot}`;
    this.prompt = prompt;
    this.root.classList.add('show');
    if (same) return;
    this.promptKey = `${prompt.street}|${prompt.toCall}|${prompt.minRaiseTo}|${prompt.maxRaiseTo}|${prompt.pot}`;
    const p = prompt;
    const min = p.minRaiseTo, max = p.maxRaiseTo;
    const verb = p.isBet ? 'Bet' : 'Raise';
    const parts = [];
    if (p.toCall > 0) parts.push(btn('Fold', { kind: 'act fold', title: 'Fold (F)', onClick: () => this._send({ type: 'fold' }) }));
    parts.push(p.toCall > 0
      ? btn(`Call ${formatChips(p.toCall)}${p.toCall >= p.stack ? ' (all-in)' : ''}`, { kind: 'act call', title: 'Call (C)', onClick: () => this._send({ type: 'call' }) })
      : btn('Check', { kind: 'act call', title: 'Check (C)', onClick: () => this._send({ type: 'check' }) }));

    let raiseBox = null;
    if (p.canRaise) {
      const step = Math.max(1, Math.round(p.bb / 2));
      this.input = h('input', { type: 'number', class: 'raise-input', min, max, step: 1, value: min, 'aria-label': `${verb} to` });
      this.slider = h('input', { type: 'range', class: 'raise-slider', min, max, step: min === max ? 1 : step, value: min, 'aria-label': `${verb} amount` });
      const raiseBtn = btn('', { kind: 'act raise', title: `${verb} (R)`, onClick: () => this._raise() });
      const label = () => {
        const v = Math.min(max, Math.max(min, Math.round(Number(this.input.value) || min)));
        raiseBtn.querySelector('span')?.remove();
        raiseBtn.append(h('span', null, v >= max ? `All-in ${formatChips(max)}` : p.isBet ? `Bet ${formatChips(v)}` : `Raise to ${formatChips(v)}`));
      };
      this.slider.addEventListener('input', () => {
        let v = Number(this.slider.value);
        if (Number(this.slider.max) - v < step) v = max;
        this.input.value = v; label();
      });
      this.input.addEventListener('input', () => { this.slider.value = this.input.value; label(); });
      this.input.addEventListener('change', () => {
        const v = Math.min(max, Math.max(min, Math.round(Number(this.input.value) || min)));
        this.input.value = v; this.slider.value = v; label();
      });
      const set = (v) => { v = Math.min(max, Math.max(min, Math.round(v))); this.input.value = v; this.slider.value = v; label(); };
      const L = { currentBet: p.currentBet, toCall: p.toCall, pot: p.pot, bb: p.bb, minRaiseTo: min, maxRaiseTo: max };
      const presets = p.street === 'preflop' && p.currentBet <= p.bb
        ? [['2.5 BB', raiseTarget(L, 'bb', 2.5)], ['3 BB', raiseTarget(L, 'bb', 3)], ['4 BB', raiseTarget(L, 'bb', 4)], ['Pot', raiseTarget(L, 'pot', 1)]]
        : [['Min', min], ['½ Pot', raiseTarget(L, 'pot', 0.5)], ['¾ Pot', raiseTarget(L, 'pot', 0.75)], ['Pot', raiseTarget(L, 'pot', 1)]];
      const presetEls = presets.filter(([, v]) => v >= min && v < max).map(([lab, v]) => h('button', { type: 'button', class: 'chip-btn', onClick: () => set(v) }, lab));
      presetEls.push(h('button', { type: 'button', class: 'chip-btn allin', onClick: () => set(max) }, 'All-in'));
      label();
      raiseBox = h('div', { class: 'raise-box' },
        h('div', { class: 'presets' }, presetEls),
        h('div', { class: 'raise-row' }, this.slider, this.input),
        raiseBtn);
    }
    const info = h('div', { class: 'ab-info' },
      h('span', null, 'Pot ', h('b', null, formatChips(p.pot))),
      p.toCall > 0 ? h('span', null, 'To call ', h('b', null, formatChips(p.toCall))) : null,
      p.toCall > 0 ? h('span', { title: 'Share of the final pot you pay' }, 'Odds ', h('b', null, `${Math.round((p.toCall / (p.pot + p.toCall)) * 100)}%`)) : null,
      h('span', { class: 'kbd-hint' }, 'Keys: F fold · C check/call · R raise · A all-in'));
    this.root.replaceChildren(info, h('div', { class: 'ab-main' }, h('div', { class: 'ab-buttons' }, parts), raiseBox));
  }
}
