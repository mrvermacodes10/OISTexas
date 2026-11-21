// Poker hand evaluator. `evaluate` scores the best 5-card hand out of 5–7 cards directly
// (fast enough for Monte Carlo AI); `bestFive` returns the actual five cards for display.
import { Card, rankValue } from "./cards";

export const CATEGORY_NAMES = [
  "High Card",
  "Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
] as const;

const SUIT_IX: Record<string, number> = { S: 0, H: 1, D: 2, C: 3 };

/** Score layout: category << 20 | five 4-bit tiebreak ranks. Higher is better; equal = tie. */
const pack = (cat: number, k: number[]) => (cat << 20) | ((k[0] ?? 0) << 16) | ((k[1] ?? 0) << 12) | ((k[2] ?? 0) << 8) | ((k[3] ?? 0) << 4) | (k[4] ?? 0);

/** Highest straight in a rank bitmask (bit r set for rank r, 2..14). Returns top rank or 0. Ace counts low for A-2-3-4-5. */
function straightTop(mask: number): number {
  if (mask & (1 << 14)) mask |= 1 << 1; // ace low
  for (let top = 14; top >= 5; top--) {
    const need = 0b11111 << (top - 4);
    if ((mask & need) === need) return top;
  }
  return 0;
}

/** Evaluate rank values + suit indices. Exposed for the AI's fast path. */
export function evaluateRaw(ranks: number[], suits: number[]): number {
  const n = ranks.length;
  const counts = new Array(15).fill(0);
  const suitCount = [0, 0, 0, 0];
  const suitMask = [0, 0, 0, 0];
  let mask = 0;
  for (let i = 0; i < n; i++) {
    counts[ranks[i]]++;
    suitCount[suits[i]]++;
    suitMask[suits[i]] |= 1 << ranks[i];
    mask |= 1 << ranks[i];
  }

  // Flush / straight flush
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCount[s] >= 5) flushSuit = s;
  if (flushSuit >= 0) {
    const sf = straightTop(suitMask[flushSuit]);
    if (sf) return pack(8, [sf]);
  }

  // Group ranks by count, high to low.
  const quads: number[] = [], trips: number[] = [], pairs: number[] = [], singles: number[] = [];
  for (let r = 14; r >= 2; r--) {
    const c = counts[r];
    if (c === 4) quads.push(r);
    else if (c === 3) trips.push(r);
    else if (c === 2) pairs.push(r);
    else if (c === 1) singles.push(r);
  }
  const highestExcept = (...ex: number[]) => {
    for (let r = 14; r >= 2; r--) if (counts[r] && !ex.includes(r)) return r;
    return 0;
  };

  if (quads.length) return pack(7, [quads[0], highestExcept(quads[0])]);
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const t = trips[0];
    const p = Math.max(trips[1] ?? 0, pairs[0] ?? 0);
    return pack(6, [t, p]);
  }
  if (flushSuit >= 0) {
    const k: number[] = [];
    for (let r = 14; r >= 2 && k.length < 5; r--) if (suitMask[flushSuit] & (1 << r)) k.push(r);
    return pack(5, k);
  }
  const st = straightTop(mask);
  if (st) return pack(4, [st]);
  if (trips.length) {
    const t = trips[0];
    const k = [t];
    for (let r = 14; r >= 2 && k.length < 3; r--) if (counts[r] && r !== t) k.push(r);
    return pack(3, k);
  }
  if (pairs.length >= 2) return pack(2, [pairs[0], pairs[1], highestExcept(pairs[0], pairs[1])]);
  if (pairs.length === 1) {
    const k = [pairs[0]];
    for (let r = 14; r >= 2 && k.length < 4; r--) if (counts[r] === 1) k.push(r);
    return pack(1, k);
  }
  return pack(0, singles.slice(0, 5));
}

/** Score of the best five-card hand available in `cards` (5 to 7 cards). */
export function evaluate(cards: Card[]): number {
  if (cards.length < 5 || cards.length > 7) throw new Error("evaluate needs 5-7 cards");
  return evaluateRaw(cards.map((c) => rankValue(c.rank)), cards.map((c) => SUIT_IX[c.suit]));
}

export const categoryOf = (score: number) => score >> 20;
export const handName = (score: number) => CATEGORY_NAMES[categoryOf(score)];

const RANK_WORD: Record<number, [string, string]> = {
  2: ["Two", "Twos"], 3: ["Three", "Threes"], 4: ["Four", "Fours"], 5: ["Five", "Fives"], 6: ["Six", "Sixes"], 7: ["Seven", "Sevens"],
  8: ["Eight", "Eights"], 9: ["Nine", "Nines"], 10: ["Ten", "Tens"], 11: ["Jack", "Jacks"], 12: ["Queen", "Queens"], 13: ["King", "Kings"], 14: ["Ace", "Aces"],
};
/** Human description, e.g. "Full House, Kings over Fives". */
export function describe(score: number): string {
  const cat = categoryOf(score);
  const k = [16, 12, 8, 4, 0].map((s) => (score >> s) & 15);
  const w = (r: number, plural = false) => RANK_WORD[r][plural ? 1 : 0];
  switch (cat) {
    case 8: return k[0] === 14 ? "Royal Flush" : `Straight Flush, ${w(k[0])} high`;
    case 7: return `Four of a Kind, ${w(k[0], true)}`;
    case 6: return `Full House, ${w(k[0], true)} over ${w(k[1], true)}`;
    case 5: return `Flush, ${w(k[0])} high`;
    case 4: return `Straight, ${w(k[0])} high`;
    case 3: return `Three of a Kind, ${w(k[0], true)}`;
    case 2: return `Two Pair, ${w(k[0], true)} and ${w(k[1], true)}`;
    case 1: return `Pair of ${w(k[0], true)}`;
    default: return `High Card, ${w(k[0])}`;
  }
}

/** The best five cards (for highlighting at showdown). Brute force over combinations. */
export function bestFive(cards: Card[]): { score: number; cards: Card[] } {
  let best = { score: -1, cards: [] as Card[] };
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const s = evaluate(five);
            if (s > best.score) best = { score: s, cards: five };
          }
  return best;
}
