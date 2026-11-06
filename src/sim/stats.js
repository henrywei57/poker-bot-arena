// Per-player statistics, fed from hand events. Bots read the public ones
// (VPIP, PFR, aggression) through `opp_vpip` etc.; the results screens show
// the rest.

export class StatsTracker {
  constructor() {
    this.players = new Map();
  }

  entry(id, name) {
    let s = this.players.get(id);
    if (!s) {
      s = {
        id, name, hands: 0, vpipHands: 0, pfrHands: 0, aggr: 0, calls: 0,
        won: 0, showdowns: 0, showdownsWon: 0, handsWon: 0, biggestPot: 0,
        net: 0, buyIns: 0, history: [],
        vpip: 0, pfr: 0, af: 0,
      };
      this.players.set(id, s);
    }
    if (name) s.name = name;
    return s;
  }

  get(id) { return this.players.get(id) || null; }

  /** Call once per finished hand. */
  recordHand(hand) {
    const vp = new Set(), pr = new Set();
    for (const a of hand.actions) {
      const p = hand.players[a.idx];
      const s = this.entry(p.id, p.name);
      if (a.street === 'preflop' && (a.type === 'call' || a.type === 'raise' || a.type === 'bet')) vp.add(p.id);
      if (a.street === 'preflop' && (a.type === 'raise' || a.type === 'bet')) pr.add(p.id);
      if (a.type === 'raise' || a.type === 'bet') s.aggr++;
      if (a.type === 'call') s.calls++;
    }
    const showdown = hand.events.some((e) => e.type === 'showdown');
    for (const p of hand.players) {
      const s = this.entry(p.id, p.name);
      s.hands++;
      if (vp.has(p.id)) s.vpipHands++;
      if (pr.has(p.id)) s.pfrHands++;
      const net = p.stack - p.startStack;
      s.net += net;
      if (p.won > 0) { s.handsWon++; s.biggestPot = Math.max(s.biggestPot, p.won); }
      if (showdown && !p.folded) {
        s.showdowns++;
        if (p.won > 0) s.showdownsWon++;
      }
      s.vpip = s.vpipHands / s.hands;
      s.pfr = s.pfrHands / s.hands;
      s.af = s.calls ? s.aggr / s.calls : Math.min(5, s.aggr);
    }
  }

  /** Snapshot of everyone's running net (for the chip graph). */
  sample(handIndex, ids) {
    for (const id of ids) {
      const s = this.players.get(id);
      if (s) s.history.push([handIndex, s.net]);
    }
  }

  rows() {
    return [...this.players.values()];
  }
}
