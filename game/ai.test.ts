import { describe, expect, it } from "vitest";
import { cards, makeDeck, shuffle, Card } from "./cards";
import { chooseAction, equity, recordStats, Difficulty, OppStats } from "./ai";
import { applyAction, startHand, stepRunout, viewFor, HandState, legalFor } from "./holdem";

/** Plays one hand between bots. Returns the finished state. */
export function playHand(seats: { id: string; stack: number }[], dealer: string, diff: Record<string, Difficulty>, stats: Record<string, OppStats> = {}, timing?: { ms: number; n: number; max: number }, deck?: Card[]): HandState {
  let s = startHand(seats, dealer, { small: 10, big: 20 }, 1, deck);
  while (s.status !== "complete") {
    if (s.status === "runout") { s = stepRunout(s); continue; }
    const id = s.players[s.toAct].id;
    const t0 = performance.now();
    const a = chooseAction(viewFor(s, id), diff[id], stats);
    const dt = performance.now() - t0;
    if (timing && diff[id] === "hard") { timing.ms += dt; timing.n++; timing.max = Math.max(timing.max, dt); }
    const r = applyAction(s, id, a);
    if (!r.ok) throw new Error(`${diff[id]} bot made illegal move ${JSON.stringify(a)}: ${r.error} legal=${JSON.stringify(legalFor(s, id))}`);
    s = r.state;
  }
  return s;
}

/** Duplicate heads-up match: every deck is played twice with the bots swapping seats, cancelling card luck.
 *  Bots keep public stats on each other across the match, like at a real table. */
export function match(a: Difficulty, b: Difficulty, deals: number) {
  const timing = { ms: 0, n: 0, max: 0 };
  const diff: Record<string, Difficulty> = { X: a, Y: b };
  const stats: Record<string, OppStats> = {};
  let net = 0, sq = 0;
  for (let h = 0; h < deals; h++) {
    const deck = shuffle(makeDeck());
    let pair = 0;
    for (const swap of [false, true]) {
      const seats = swap ? [{ id: "Y", stack: 2000 }, { id: "X", stack: 2000 }] : [{ id: "X", stack: 2000 }, { id: "Y", stack: 2000 }];
      const s = playHand(seats, seats[0].id, diff, stats, timing, deck);
      recordStats(stats, ["X", "Y"], s.log);
      const d = s.players.find((p) => p.id === "X")!.stack - 2000;
      net += d;
      pair += d;
    }
    sq += (pair / 40) ** 2;
  }
  const mean = net / (deals * 2) / 20;
  const se = Math.sqrt(Math.max(0, sq / deals - (mean * 2) ** 2)) / 2 / Math.sqrt(deals);
  return { bbPerHand: mean, se, timing };
}

describe("equity", () => {
  it("is sensible", () => {
    expect(equity(cards("AS AH"), [], 1, 4000)).toBeGreaterThan(0.8);
    expect(equity(cards("7C 2D"), [], 1, 4000)).toBeLessThan(0.4);
    expect(equity(cards("AS KS"), cards("QS JS 10S"), 3, 500)).toBe(1); // royal flush
    expect(Math.abs(equity(cards("2C 3D"), cards("AS AH AD AC KS"), 1, 2000) - 0.5)).toBeLessThan(0.02); // board plays: always a split
  });
});

describe("bots", () => {
  it("always choose legal actions in multi-way games of every difficulty", () => {
    const ds: Difficulty[] = ["easy", "medium", "hard"];
    for (let h = 0; h < 120; h++) {
      const n = 2 + (h % 7);
      const seats = Array.from({ length: n }, (_, i) => ({ id: "b" + i, stack: 50 + Math.floor(Math.random() * 3000) }));
      const diff = Object.fromEntries(seats.map((s, i) => [s.id, ds[(h + i) % 3]]));
      playHand(seats, "b" + (h % n), diff);
    }
  }, 120000);
  it("stronger bots beat weaker ones (duplicate deals, seats swapped)", () => {
    const he = match("hard", "easy", 150);
    const me = match("medium", "easy", 800);
    console.log(`hard vs easy ${he.bbPerHand.toFixed(2)}±${he.se.toFixed(2)} bb/hand, medium vs easy ${me.bbPerHand.toFixed(2)}±${me.se.toFixed(2)}`);
    expect(he.bbPerHand).toBeGreaterThan(0);
    expect(me.bbPerHand).toBeGreaterThan(0);
  }, 300000);
});
