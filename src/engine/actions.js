// Turns loose intents ("raise 3 big blinds", "bet 75% of the pot", "check")
// into an action the engine accepts. Bots, the human action bar and online
// guests all go through here, so nothing illegal ever reaches Hand.act().
//
// intent = { type: 'fold' | 'check' | 'call' | 'raise' | 'bet' | 'allin',
//            unit?: 'chips' | 'bb' | 'pot' | 'x' | 'min' | 'max', value?: number }
// For raises, `chips` means "raise to this total". `pot` is a pot-sized raise
// fraction (call first, then raise value * the pot after calling). `x` is a
// multiple of the current bet (or of the big blind when nobody has bet).

export function raiseTarget(legal, unit = 'chips', value = 0) {
  const { currentBet, toCall, pot, bb } = legal;
  switch (unit) {
    case 'min': return legal.minRaiseTo;
    case 'max': return legal.maxRaiseTo;
    case 'bb': return value * bb;
    case 'pot': return currentBet + value * (pot + toCall);
    case 'x': return value * (currentBet > 0 ? currentBet : bb);
    default: return value;
  }
}

/**
 * @param intent  see above
 * @param legal   hand.legal()
 * @param opts.freeFold  if false (default), folding when checking is free becomes a check
 * @returns {{type: 'fold'|'check'|'call'|'raise', amount?: number}}
 */
export function resolveIntent(intent, legal, opts = {}) {
  const passive = () => (legal.toCall > 0 ? { type: 'call' } : { type: 'check' });
  const type = intent?.type;
  switch (type) {
    case 'fold':
      return legal.toCall === 0 && !opts.freeFold ? { type: 'check' } : { type: 'fold' };
    case 'check':
      return legal.toCall === 0 ? { type: 'check' } : { type: 'fold' };
    case 'call':
      return passive();
    case 'allin':
      return legal.canRaise ? { type: 'raise', amount: legal.maxRaiseTo } : passive();
    case 'raise':
    case 'bet': {
      if (!legal.canRaise) return passive();
      let to = raiseTarget(legal, intent.unit || 'min', Number(intent.value) || 0);
      if (!Number.isFinite(to)) to = legal.minRaiseTo;
      to = Math.round(to);
      if (to < legal.minRaiseTo) to = legal.minRaiseTo;
      if (to > legal.maxRaiseTo) to = legal.maxRaiseTo;
      return { type: 'raise', amount: to };
    }
    default:
      return legal.toCall === 0 ? { type: 'check' } : { type: 'fold' };
  }
}

/** Short label for logs: "raises to 600", "calls 200 (all-in)". */
export function describeAction(rec, fmt = String) {
  const allIn = rec.allIn ? ' (all-in)' : '';
  switch (rec.type) {
    case 'fold': return 'folds';
    case 'check': return 'checks';
    case 'call': return `calls ${fmt(rec.amount)}${allIn}`;
    case 'bet': return `bets ${fmt(rec.to)}${allIn}`;
    case 'raise': return `raises to ${fmt(rec.to)}${allIn}`;
    default: return rec.type;
  }
}
