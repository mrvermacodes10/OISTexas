// Standard 52-card deck with crypto-secure shuffling.

export type Suit = "S" | "H" | "D" | "C";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";
export interface Card {
  id: string; // e.g. "10H", "AS"
  rank: Rank;
  suit: Suit;
}

export const SUITS: Suit[] = ["S", "H", "D", "C"];
export const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
/** Numeric rank value: 2..14 (ace high). */
export const rankValue = (r: Rank) => RANKS.indexOf(r) + 2;

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ id: rank + suit, rank, suit });
  return deck;
}

/** Parse "AS", "10H", "Td" style strings (handy for tests). */
export function card(s: string): Card {
  const suit = s.slice(-1).toUpperCase() as Suit;
  let rank = s.slice(0, -1).toUpperCase();
  if (rank === "T") rank = "10";
  if (!SUITS.includes(suit) || !RANKS.includes(rank as Rank)) throw new Error("Bad card " + s);
  return { id: rank + suit, rank: rank as Rank, suit };
}
export const cards = (s: string) => s.trim().split(/\s+/).map(card);

/** Unbiased crypto-random integer in [0, max). */
export function randomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
}

/** Fisher–Yates shuffle with crypto randomness. Returns a new array. */
export function shuffle<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
