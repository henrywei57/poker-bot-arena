// Card encoding: an integer 0..51. rank = card >> 2 (0 = deuce .. 12 = ace),
// suit = card & 3 (0 = spades, 1 = hearts, 2 = diamonds, 3 = clubs).

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];
export const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];
export const RANK_NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
export const RANK_PLURALS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

export const rankOf = (c) => c >> 2;
export const suitOf = (c) => c & 3;
export const makeCard = (rank, suit) => rank * 4 + suit;

export function cardFromString(s) {
  const r = RANKS.indexOf(String(s[0]).toUpperCase());
  const su = SUITS.indexOf(String(s[1]).toLowerCase());
  if (r < 0 || su < 0 || s.length !== 2) throw new Error(`Bad card "${s}"`);
  return makeCard(r, su);
}

export const cardToString = (c) => RANKS[c >> 2] + SUITS[c & 3];
export const cardsFromString = (s) => s.trim().split(/\s+/).filter(Boolean).map(cardFromString);
export const prettyCard = (c) => (RANKS[c >> 2] === 'T' ? '10' : RANKS[c >> 2]) + SUIT_SYMBOLS[c & 3];

export function newDeck() {
  return Array.from({ length: 52 }, (_, i) => i);
}

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/** Starting-hand class in standard notation: "AA", "AKs", "T9o". */
export function handClass(c1, c2) {
  let r1 = c1 >> 2, r2 = c2 >> 2;
  if (r1 === r2) return RANKS[r1] + RANKS[r2];
  if (r1 < r2) { const t = r1; r1 = r2; r2 = t; }
  return RANKS[r1] + RANKS[r2] + ((c1 & 3) === (c2 & 3) ? 's' : 'o');
}

/** All 169 starting-hand classes, pairs first then by high card. */
export function allHandClasses() {
  const out = [];
  for (let a = 12; a >= 0; a--) {
    for (let b = 12; b >= 0; b--) {
      if (a === b) out.push(RANKS[a] + RANKS[b]);
      else if (a > b) out.push(RANKS[a] + RANKS[b] + 's', RANKS[a] + RANKS[b] + 'o');
    }
  }
  return out;
}

export const classCombos = (cls) => (cls.length === 2 ? 6 : cls[2] === 's' ? 4 : 12);
