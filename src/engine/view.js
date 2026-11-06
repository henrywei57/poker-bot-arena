// What a player is allowed to know when it is their turn: their own cards,
// the board, chip counts and the public action. Bots get exactly this, so
// they cannot peek at anyone's hole cards.

export function buildView(hand, idx, extra = {}) {
  const p = hand.players[idx];
  return {
    handNumber: hand.handNumber,
    street: hand.street,
    hole: p.hole,
    board: hand.board,
    idx,
    seat: p.seat,
    n: hand.n,
    buttonIdx: hand.buttonIdx,
    sbIdx: hand.sbIdx,
    bbIdx: hand.bbIdx,
    legal: hand.legal(),
    sb: hand.sb,
    bb: hand.bb,
    ante: hand.ante,
    raises: hand.raises,
    aggressor: hand.aggressor,
    actions: hand.actions,
    players: hand.players.map((q, j) => ({
      idx: j, seat: q.seat, id: q.id, name: q.name,
      stack: q.stack, streetBet: q.streetBet, totalBet: q.totalBet,
      folded: q.folded, allIn: q.allIn,
      stats: extra.stats ? extra.stats.get(q.id) : null,
    })),
    tournament: extra.tournament || null,
  };
}
