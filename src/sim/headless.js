// Runs hands with no animation and no waiting: the engine behind "Instant"
// simulations, tournament series and the Bot Lab tester.

import { buildView } from '../engine/view.js';

/**
 * Play the current hand at `table` to the end.
 * @param agentFor  (playerId) => agent with a synchronous decide(view)
 * @param opts.stats       StatsTracker (optional)
 * @param opts.tournament  info passed to bots (optional)
 * @param opts.onDecision  (player, decision) => void, e.g. to record errors
 */
export function playHandSync(table, agentFor, opts = {}) {
  const hand = table.hand && !table.hand.done ? table.hand : table.startHand();
  let guard = 0;
  while (!hand.done) {
    if (++guard > 2000) throw new Error('Hand did not finish');
    if (hand.phase === 'roundEnd') { hand.advance(); continue; }
    const p = hand.actor;
    const agent = agentFor(p.id);
    const view = buildView(hand, hand.toAct, opts);
    const d = agent.decide(view);
    if (opts.onDecision) opts.onDecision(p, d);
    hand.act(d.type, d.amount);
  }
  if (opts.stats) opts.stats.recordHand(hand);
  return hand;
}
