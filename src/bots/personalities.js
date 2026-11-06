// Built-in opponents. Each one is an ordinary Kicker program, so they double
// as examples: open any of them in the Bot Lab and duplicate it to tweak.

const SHARK = `bot "Shark"
avatar "🦈"
color "#38d6ff"
desc "Tight-aggressive pro. Position-aware opening ranges, bets strong hands for value, folds when beaten."

# How wide to open depends on the seat: tight up front, loose on the button.
let open = 10
if position >= 0.85 then
  open = 26
elif position >= 0.6 then
  open = 18
elif position >= 0.35 then
  open = 13
end

on preflop
  if raises == 0 then
    when top(open) then raise 2.5 + limpers bb
    when is_sb and behind == 1 and top(35) then raise 3 bb    # steal the big blind
    when can_check then check
    when limpers > 0 and in_position and top(open + 10) then call
    fold
  elif raises == 1 then
    when top(3) then raise 3 x                                 # 3-bet the best hands
    when top(open / 2) and pot_odds < 0.35 then call
    when pocket_pair and effective_bb > 25 and to_call < stack * 0.1 then call   # set mining
    fold
  else
    when top(1.5) then allin
    when top(3) and pot_odds < 0.4 then call
    fold
  end
end

on postflop
  # Players who keep betting usually have something: trust equity less.
  let eq = equity - 0.04 * raises
  if can_check then
    when eq > 0.75 then bet 0.75 pot
    when eq > 0.55 and opponents <= 2 then bet 0.6 pot
    when was_aggressor and opponents == 1 and chance(0.65) then bet 0.5 pot   # continuation bet
    when draw and chance(0.35) then bet 0.55 pot                               # semi-bluff
    check
  else
    when eq > 0.85 then raise 2.5 x
    when draw and can_raise and eq > pot_odds and chance(0.3) then raise 2.5 x
    when eq > pot_odds + 0.05 then call
    fold
  end
end
`;

const ROCK = `bot "The Rock"
avatar "🪨"
color "#9fb3d1"
desc "Ultra-tight and passive. Waits for premium hands, then mostly calls. Almost never bluffs."

on preflop
  when hand in "QQ+, AKs, AKo" then raise 3 x
  when hand in "77+, AJs+, KQs, AQo+" and to_call <= stack * 0.15 then call
  when can_check then check
  fold
end

on postflop
  when made_rank >= 3 and hit then raise 0.5 pot
  when overpair or (top_pair and high >= 12) or (made_rank >= 2 and hit) then call
  when can_check then check
  when draw and pot_odds < 0.2 then call
  fold
end
`;

const MANIAC = `bot "Maniac"
avatar "🔥"
color "#ff5c7a"
desc "Loose-aggressive chaos. Raises constantly, bluffs often and never backs down quietly."

when first_action and chance(0.06) then say pick("Ship it!", "You can't handle this.", "I live for this.", "Raise it up!")

on preflop
  if raises == 0 then
    when top(55) then raise pick(3, 4, 5) bb
    when can_check then check
    when chance(0.3) then call
    fold
  elif raises <= 2 then
    when top(8) then raise 3 x
    when top(25) and chance(0.4) then raise 2.5 x
    when top(50) then call
    fold
  else
    when top(15) then allin
    when top(30) then call
    fold
  end
end

on postflop
  when equity > 0.65 then raise 1 pot
  when can_check and chance(0.55) then bet 0.75 pot
  when facing_bet and raises < 3 and chance(0.2) then raise 2.5 x    # pure bluff raise
  when equity > pot_odds or draw then call
  when to_call <= pot * 0.4 and chance(0.4) then call
  check
end
`;

const STATION = `bot "Calling Station"
avatar "📞"
color "#3ddc97"
desc "Loves to see cards. Calls with anything that might win, rarely raises, almost never folds."

when facing_bet and chance(0.03) then say pick("I call.", "Let's see it.", "You could be bluffing...")

on preflop
  when top(4) then raise 3 x
  when can_check then check
  when top(75) and to_call <= stack * 0.25 then call
  when top(30) then call
  fold
end

on postflop
  when made_rank >= 4 and hit then raise 0.5 pot
  when can_check then check
  when hit or draw or overpair then call
  when to_call <= pot * 0.35 then call
  when chance(0.2) then call
  fold
end
`;

const MATH = `bot "Mathematician"
avatar "🧮"
color "#f2c14e"
desc "Pure pot-odds logic. Calls only when equity beats the price, raises when equity is far above a fair share."

# A fair share of the pot: 1 in (players in the hand).
let fair = 1 / (opponents + 1)

on preflop
  when equity > fair * 1.9 and raises <= 2 then raise 3 x
  when equity > fair * 1.6 and raises == 0 then raise 2.5 bb
  when can_check then check
  when equity > pot_odds + 0.06 and equity > fair * 1.15 then call
  fold
end

on postflop
  # Expected value of calling, in chips.
  let ev_call = equity * (pot + to_call) - to_call
  when equity > 0.72 then raise 0.7 pot
  when can_check and equity > fair * 1.35 then bet 0.5 pot
  when can_check then check
  when ev_call > 0 then call
  fold
end
`;

const TRICKSTER = `bot "Trickster"
avatar "🎭"
color "#b38cff"
desc "Deceptive. Slow-plays monsters, check-raises, and fires bluffs when scary cards land."

keep bluffs = 0

on preflop
  when top(4) and raises == 0 and chance(0.5) then call     # limp-trap big pairs
  when top(18) and raises == 0 then raise 3 bb
  when top(5) then raise 3 x
  when top(16) and pot_odds < 0.3 then call
  when suited and connected and pot_odds < 0.2 then call
  when can_check then check
  fold
end

on flop
  when made_rank >= 3 and hit and can_check then check     # slow-play the monster
  when made_rank >= 3 and hit then call
end

on turn, river
  when made_rank >= 3 and hit and facing_bet and can_raise then raise 3 x   # spring the trap
  when made_rank >= 3 and hit then bet 0.8 pot
  if can_check and opponents == 1 and (board_flushy or board_paired) and chance(0.35) then
    bluffs = bluffs + 1
    when chance(0.5) then say pick("Scary card, huh?", "I think you're beat.", "Bluff number " + bluffs + "... or is it?")
    bet 0.75 pot
  end
end

on postflop
  when strength > 0.8 then bet 0.6 pot
  when equity > pot_odds + 0.05 then call
  when draw and pot_odds < 0.3 then call
  check
end
`;

const CHAMELEON = `bot "Chameleon"
avatar "🦎"
color "#5ee6c8"
desc "Adapts to the table. Steals from tight players, value-bets loose ones and respects aggressive ones."

# Read the players still in: how loose, how aggressive?
let loose = opp_vpip > 0.42
let tight = opp_vpip < 0.24
let wild = opp_aggr > 2.5

on preflop
  let open = 16
  if loose then open = 11 end
  if tight then open = 30 end
  if raises == 0 then
    when top(open) then raise 2.5 + limpers bb
    when can_check then check
    fold
  else
    let defend = 6
    if opp_pfr > 0.3 then defend = 14 end     # they raise light: defend wider
    when top(defend / 3) then raise 3 x
    when top(defend) and pot_odds < 0.4 then call
    fold
  end
end

on postflop
  let bluff = 0.2
  if tight then bluff = 0.45 end
  if loose then bluff = 0.05 end
  let value = 0.6
  if loose then value = 0.52 end
  if can_check then
    when equity > value then bet 0.7 pot
    when opponents == 1 and chance(bluff) then bet 0.6 pot
    check
  else
    let need = pot_odds
    if wild then need = pot_odds - 0.05 end
    when equity > 0.82 and can_raise then raise 2.5 x
    when equity > need then call
    fold
  end
end
`;

const MONKEY = `bot "Chaos Monkey"
avatar "🐒"
color "#ffa94d"
desc "Completely random. A baseline: any real strategy should beat it."

let r = random()
when r < 0.04 then say pick("Ook ook!", "Eee!", "Banana time.")
when r < 0.25 then fold
when r < 0.65 then call
when r < 0.94 then raise pick(0.5, 0.75, 1, 2) pot
allin
`;

export const STARTER_BOT = `# My first Kicker bot. Lines starting with # are comments.
bot "My Bot"
avatar "🤖"
color "#3d8bff"
desc "Describe your strategy here."

# This program runs top to bottom every time it is your turn.
# The first action it reaches (fold, check, call, raise, bet, allin) is the move.
# If it reaches none, it checks when that is free and folds otherwise.

on preflop
  when hand in "TT+, AQs+, AKo" then raise 3 x     # premium hand: raise
  when top(20) and to_call <= 3 * bb then call      # decent hand, cheap price: call
  check                                             # otherwise check, or fold to a bet
end

on postflop
  when strength > 0.8 then bet 0.75 pot             # very strong: bet for value
  when equity > pot_odds then call                  # the price is right: call
  check
end
`;

export const PERSONALITIES = [
  { id: 'shark', code: SHARK },
  { id: 'rock', code: ROCK },
  { id: 'maniac', code: MANIAC },
  { id: 'station', code: STATION },
  { id: 'math', code: MATH },
  { id: 'trickster', code: TRICKSTER },
  { id: 'chameleon', code: CHAMELEON },
  { id: 'monkey', code: MONKEY },
];
