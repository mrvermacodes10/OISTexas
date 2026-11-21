import { describe, expect, it } from "vitest";
import { Card, card, cards, makeDeck, shuffle, rankValue } from "./cards";
import { evaluate, describe as describeHand, bestFive, categoryOf } from "./evaluator";
import { Action, HandState, applyAction, buildPots, legalFor, startHand, stepRunout, viewFor, potTotal } from "./holdem";

// ---------- helpers ----------
const ev = (s: string) => evaluate(cards(s));

/** Build a deck so that seat i receives holes[i] and the board comes out as given. */
function rigged(holes: string[], board: string, sb: number): Card[] {
  const n = holes.length;
  const hs = holes.map(cards);
  const seq: Card[] = [];
  for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) seq.push(hs[(sb + i) % n][r]);
  const b = cards(board);
  const burn = () => ({ id: "burn", rank: "2", suit: "S" }) as Card; // placeholder replaced below
  seq.push(burn(), b[0], b[1], b[2], burn(), b[3], burn(), b[4]);
  const used = new Set(seq.filter((c) => c.id !== "burn").map((c) => c.id));
  const rest = makeDeck().filter((c) => !used.has(c.id));
  const fill = rest.splice(0, 3);
  let k = 0;
  const ordered = seq.map((c) => (c.id === "burn" ? fill[k++] : c));
  return [...rest, ...ordered.reverse()];
}

const seats = (...stacks: number[]) => stacks.map((stack, i) => ({ id: "p" + i, stack }));
const blinds = { small: 10, big: 20 };

function act(s: HandState, id: string, a: Action): HandState {
  const r = applyAction(s, id, a);
  if (!r.ok) throw new Error(`${id} ${JSON.stringify(a)}: ${r.error}`);
  return r.state;
}
const toAct = (s: HandState) => s.players[s.toAct]?.id;
const runout = (s: HandState) => {
  while (s.status === "runout") s = stepRunout(s);
  return s;
};
const totalChips = (s: HandState) => s.players.reduce((t, p) => t + p.stack, 0) + (s.status === "complete" ? 0 : potTotal(s));

// Independent reference evaluator for 5 cards: returns a comparable tuple.
function ref5(cs: Card[]): number[] {
  const r = cs.map((c) => rankValue(c.rank)).sort((a, b) => b - a);
  const flush = cs.every((c) => c.suit === cs[0].suit);
  const uniq = [...new Set(r)];
  let straight = 0;
  if (uniq.length === 5 && r[0] - r[4] === 4) straight = r[0];
  if (uniq.length === 5 && r[0] === 14 && r[1] === 5) straight = 5;
  const groups = uniq.map((v) => [r.filter((x) => x === v).length, v]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const shape = groups.map((g) => g[0]).join("");
  const kick = groups.map((g) => g[1]);
  if (straight && flush) return [8, straight];
  if (shape === "41") return [7, ...kick];
  if (shape === "32") return [6, ...kick];
  if (flush) return [5, ...r];
  if (straight) return [4, straight];
  if (shape === "311") return [3, ...kick];
  if (shape === "221") return [2, ...kick];
  if (shape === "2111") return [1, ...kick];
  return [0, ...r];
}
const cmp = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};
function ref7(cs: Card[]): number[] {
  let best: number[] = [-1];
  for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) {
    const five = cs.filter((_, i) => i !== a && i !== b);
    const t = ref5(five);
    if (cmp(t, best) > 0) best = t;
  }
  return best;
}

// ---------- evaluator ----------
describe("hand evaluator", () => {
  it("ranks every category in order", () => {
    const ladder = [
      "2S 5H 9D JC KS 3D 7C", // high card
      "2S 2H 9D JC KS 3D 7C", // pair
      "2S 2H 9D 9C KS 3D 7C", // two pair
      "2S 2H 2D 9C KS 3D 7C", // trips
      "4S 5H 6D 7C 8S KD 2C", // straight
      "2H 5H 9H JH KH 3D 7C", // flush
      "2S 2H 2D 9C 9S 3D 7C", // full house
      "2S 2H 2D 2C KS 3D 7C", // quads
      "4H 5H 6H 7H 8H KD 2C", // straight flush
    ].map(ev);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
    expect(ladder.map(categoryOf)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("handles ace-low and ace-high straights", () => {
    const wheel = ev("AS 2H 3D 4C 5S 9D KC");
    const sixHigh = ev("2H 3D 4C 5S 6S 9D KC");
    const broadway = ev("10S JH QD KC AS 2D 3C");
    expect(categoryOf(wheel)).toBe(4);
    expect(sixHigh).toBeGreaterThan(wheel);
    expect(broadway).toBeGreaterThan(sixHigh);
    expect(describeHand(wheel)).toBe("Straight, Five high");
    expect(categoryOf(ev("QS KH AD 2C 3S 8D 9C"))).toBe(0); // no wrap-around straight
    expect(categoryOf(ev("AH 2H 3H 4H 5H KD KC"))).toBe(8); // steel wheel
    expect(describeHand(ev("10H JH QH KH AH 2D 3C"))).toBe("Royal Flush");
    expect(ev("AH 2H 3H 4H 5H KD KC")).toBeLessThan(ev("2H 3H 4H 5H 6H KD KC"));
  });
  it("full houses: best trips then best pair, two sets of trips", () => {
    expect(describeHand(ev("KS KH KD 5C 5S 5D 2C"))).toBe("Full House, Kings over Fives");
    expect(describeHand(ev("5S 5H 5D KC KS QD QC"))).toBe("Full House, Fives over Kings");
    expect(ev("KS KH KD 2C 2S 9D 3C")).toBeGreaterThan(ev("QS QH QD AC AS 9D 3C"));
    expect(ev("KS KH KD 3C 3S 9D 2C")).toBeGreaterThan(ev("KS KH KD 2C 2S 9D 3C"));
  });
  it("flushes compare all five cards and ignore a sixth", () => {
    expect(ev("AH JH 9H 6H 3H 2D 4C")).toBeGreaterThan(ev("AH JH 9H 6H 2H 3D 4C"));
    expect(ev("AH JH 9H 6H 3H 2H KC")).toBe(ev("AH JH 9H 6H 3H 4D KC")); // 2H is the 6th flush card
    expect(categoryOf(ev("AH JH 9H 6H 3H 4H 5H"))).toBe(5); // no 2 → flush, not a straight flush
    expect(categoryOf(ev("AH 2H 3H 4H 5H 9H JH"))).toBe(8);
    expect(categoryOf(ev("2H 3H 4H 5H 9H JH 6D"))).toBe(5); // flush beats the off-suit straight
  });
  it("kickers: two pair with three pairs, quads kicker", () => {
    expect(ev("AS AH KD KC QS QD 2C")).toBe(ev("AS AH KD KC QS 3D 2C")); // third pair Q is the kicker either way
    expect(ev("AS AH KD KC QS QD 2C")).toBeGreaterThan(ev("AS AH KD KC JS JD 2C"));
    expect(ev("9S 9H 9D 9C AS 2D 3C")).toBeGreaterThan(ev("9S 9H 9D 9C KS QD JC"));
  });
  it("matches an independent brute-force evaluator on 20,000 random 7-card hands", () => {
    const deck = makeDeck();
    let prev: { mine: number; ref: number[] } | null = null;
    for (let i = 0; i < 20000; i++) {
      const seven = shuffle(deck).slice(0, 7);
      const mine = evaluate(seven);
      const r = ref7(seven);
      expect(categoryOf(mine)).toBe(r[0]);
      if (prev) expect(Math.sign(mine - prev.mine)).toBe(Math.sign(cmp(r, prev.ref)));
      prev = { mine, ref: r };
      if (i % 50 === 0) expect(evaluate(bestFive(seven).cards)).toBe(mine);
    }
    // ~3s alone, ~5-6s under parallel suite load; dominated by the test's own crypto shuffles and
    // brute-force reference evaluator, not by `evaluate` (~2µs/hand). Exceeds vitest's 5s default.
  }, 30_000);
});

// ---------- betting & flow ----------
describe("blinds, positions and turn order", () => {
  it("3+ players: SB/BB left of button, UTG acts first pre-flop, SB first post-flop", () => {
    let s = startHand(seats(1000, 1000, 1000, 1000), "p0", blinds);
    expect([s.players[s.sb].id, s.players[s.bb].id]).toEqual(["p1", "p2"]);
    expect(s.players[1].bet).toBe(10);
    expect(s.players[2].bet).toBe(20);
    expect(toAct(s)).toBe("p3");
    expect(s.players.every((p) => p.hole.length === 2)).toBe(true);
    const ids = new Set([...s.deck, ...s.players.flatMap((p) => p.hole)].map((c) => c.id));
    expect(ids.size).toBe(52);
    s = act(s, "p3", { type: "call" });
    s = act(s, "p0", { type: "call" });
    s = act(s, "p1", { type: "call" });
    expect(toAct(s)).toBe("p2"); // big blind option
    expect(legalFor(s, "p2")!.check).toBe(true);
    s = act(s, "p2", { type: "check" });
    expect(s.street).toBe("flop");
    expect(s.board.length).toBe(3);
    expect(toAct(s)).toBe("p1");
    expect(potTotal(s)).toBe(80);
  });
  it("heads-up: button is small blind, acts first pre-flop and last after", () => {
    let s = startHand(seats(1000, 1000), "p1", blinds);
    expect(s.players[s.sb].id).toBe("p1");
    expect(s.players[s.bb].id).toBe("p0");
    expect(toAct(s)).toBe("p1");
    s = act(s, "p1", { type: "call" });
    s = act(s, "p0", { type: "check" });
    expect(s.street).toBe("flop");
    expect(toAct(s)).toBe("p0");
  });
  it("big blind can raise its option", () => {
    let s = startHand(seats(1000, 1000, 1000), "p0", blinds);
    s = act(s, "p0", { type: "call" });
    s = act(s, "p1", { type: "call" });
    s = act(s, "p2", { type: "raise", amount: 60 });
    expect(s.street).toBe("preflop");
    expect(toAct(s)).toBe("p0");
  });
});

describe("action validation", () => {
  it("rejects out-of-turn, illegal checks, small raises, overbets and junk", () => {
    const s = startHand(seats(1000, 1000, 1000), "p0", blinds);
    expect(toAct(s)).toBe("p0");
    expect(applyAction(s, "p1", { type: "call" }).ok).toBe(false);
    expect(applyAction(s, "p0", { type: "check" }).ok).toBe(false);
    expect(applyAction(s, "p0", { type: "raise", amount: 30 }).ok).toBe(false); // min raise is to 40
    expect(applyAction(s, "p0", { type: "raise", amount: 40 }).ok).toBe(true);
    expect(applyAction(s, "p0", { type: "raise", amount: 5000 }).ok).toBe(false);
    expect(applyAction(s, "p0", { type: "raise", amount: 45.5 }).ok).toBe(false);
    expect(applyAction(s, "p0", { type: "dance" } as never).ok).toBe(false);
    expect(applyAction(s, "p0", null as never).ok).toBe(false);
  });
  it("min raise tracks the last raise size", () => {
    let s = startHand(seats(1000, 1000, 1000), "p0", blinds);
    s = act(s, "p0", { type: "raise", amount: 100 }); // raise of 80
    expect(legalFor(s, "p1")!.minRaiseTo).toBe(180);
    expect(applyAction(s, "p1", { type: "raise", amount: 170 }).ok).toBe(false);
    s = act(s, "p1", { type: "raise", amount: 180 });
    expect(legalFor(s, "p2")!.minRaiseTo).toBe(260);
  });
  it("does not mutate the input state", () => {
    const s = startHand(seats(1000, 1000), "p0", blinds);
    const snap = JSON.stringify(s);
    applyAction(s, toAct(s), { type: "raise", amount: 100 });
    expect(JSON.stringify(s)).toBe(snap);
  });
  it("an incomplete all-in raise does not re-open betting for players who already acted", () => {
    let s = startHand([{ id: "a", stack: 1000 }, { id: "b", stack: 1000 }, { id: "c", stack: 130 }], "a", blinds);
    // a button (acts first pre-flop with 3 players), b SB, c BB
    expect(toAct(s)).toBe("a");
    s = act(s, "a", { type: "raise", amount: 100 });
    s = act(s, "b", { type: "call" });
    s = act(s, "c", { type: "allin" }); // to 130, increment 30 < 80
    expect(s.currentBet).toBe(130);
    expect(toAct(s)).toBe("a");
    const l = legalFor(s, "a")!;
    expect(l.call && l.callAmount === 30).toBe(true);
    expect(l.raise).toBe(false);
    expect(applyAction(s, "a", { type: "raise", amount: 300 }).ok).toBe(false);
    s = act(s, "a", { type: "call" });
    s = act(s, "b", { type: "call" });
    expect(s.street).toBe("flop");
  });
  it("a full all-in raise re-opens betting", () => {
    let s = startHand([{ id: "a", stack: 1000 }, { id: "b", stack: 1000 }, { id: "c", stack: 300 }], "a", blinds);
    s = act(s, "a", { type: "raise", amount: 100 });
    s = act(s, "b", { type: "call" });
    s = act(s, "c", { type: "allin" }); // to 300, increment 200 ≥ 80
    expect(legalFor(s, "a")!.raise).toBe(true);
    expect(legalFor(s, "a")!.minRaiseTo).toBe(500);
  });
});

describe("pots, side pots and split pots", () => {
  it("buildPots: main + two side pots with a folded contributor", () => {
    const pots = buildPots([
      { id: "a", contributed: 50, folded: false },
      { id: "b", contributed: 200, folded: false },
      { id: "c", contributed: 500, folded: false },
      { id: "d", contributed: 100, folded: true },
    ]);
    expect(pots).toEqual([
      { amount: 200, eligible: ["a", "b", "c"], winners: [] },
      { amount: 350, eligible: ["b", "c"], winners: [] },
      { amount: 300, eligible: ["c"], winners: [] },
    ]);
  });
  it("short all-in wins only the main pot; side pot goes to the next best hand", () => {
    // seats: p0 button, p1 SB, p2 BB. p0 has the best hand but only 100 chips.
    const deck = rigged(["AS AH", "KS KH", "QS QH"], "2C 7D 9S 3H 4D", 1);
    let s = startHand(seats(100, 500, 500), "p0", blinds, 1, deck);
    s = act(s, "p0", { type: "allin" });
    s = act(s, "p1", { type: "raise", amount: 300 });
    s = act(s, "p2", { type: "call" });
    // flop: p1 and p2 still have chips
    expect(s.status).toBe("betting");
    s = act(s, "p1", { type: "check" });
    s = act(s, "p2", { type: "check" });
    s = act(s, "p1", { type: "check" });
    s = act(s, "p2", { type: "check" });
    s = act(s, "p1", { type: "check" });
    s = act(s, "p2", { type: "check" });
    expect(s.status).toBe("complete");
    const r = s.result!;
    expect(r.pots.map((p) => [p.amount, p.winners])).toEqual([[300, ["p0"]], [400, ["p1"]]]);
    expect(s.players.map((p) => p.stack)).toEqual([300, 600, 200]);
    expect(r.hands.p0.name).toBe("Pair of Aces");
  });
  it("three-way all-in with different stacks", () => {
    const deck = rigged(["2S 7H", "KS KH", "AS AH"], "2C 2D 9S 3H 4D", 1);
    let s = startHand(seats(1000, 200, 500), "p0", blinds, 1, deck);
    s = act(s, "p0", { type: "allin" });
    s = act(s, "p1", { type: "call" });
    s = act(s, "p2", { type: "call" });
    expect(s.status).toBe("runout");
    s = runout(s);
    expect(s.board.length).toBe(5);
    // p0 trips 2s wins everything it covers; p0 covers all.
    expect(s.players.map((p) => p.stack)).toEqual([1700, 0, 0]);
    expect(s.result!.pots.map((p) => p.amount)).toEqual([600, 600, 500]);
  });
  it("splits a pot when the board plays, odd chip left of the button", () => {
    const deck = rigged(["2S 3H", "2D 3C", "4S 5S"], "10H JH QH KH AH", 1);
    let s = startHand(seats(1000, 1000, 1000), "p0", { small: 5, big: 10 }, 1, deck);
    s = act(s, "p0", { type: "call" });
    s = act(s, "p1", { type: "raise", amount: 25 }); // SB raises to 25 → odd-sized pot
    s = act(s, "p2", { type: "fold" });
    s = act(s, "p0", { type: "call" });
    for (let i = 0; i < 6; i++) s = act(s, toAct(s), { type: "check" });
    expect(s.result!.hands.p0.name).toBe("Royal Flush");
    expect(s.result!.pots[0].winners).toEqual(["p1", "p0"]); // p1 is left of the button
    expect(s.result!.pots[0].amount).toBe(60);
    expect(s.result!.payouts).toEqual({ p0: 30, p1: 30, p2: 0 });
    // odd chip case via buildPots + three-way tie
    const d2 = rigged(["2S 3H", "2D 3C", "2H 3S"], "10H JH QH KH AH", 1);
    let t = startHand(seats(1000, 1000, 1000), "p0", { small: 5, big: 10 }, 1, d2);
    t = act(t, "p0", { type: "raise", amount: 21 });
    t = act(t, "p1", { type: "fold" }); // 5 dead
    t = act(t, "p2", { type: "call" });
    for (let i = 0; i < 6; i++) t = act(t, toAct(t), { type: "check" });
    expect(t.result!.pots[0].amount).toBe(47);
    expect(t.result!.payouts).toEqual({ p0: 23, p1: 0, p2: 24 }); // p2 is closer to the left of the button
  });
  it("identical hands from different hole cards tie; kickers break ties", () => {
    const deck = rigged(["AS 2H", "AD 3C", "KC 4D"], "AH AC 9S 9D 7C", 1);
    let s = startHand(seats(1000, 1000, 1000), "p0", blinds, 1, deck);
    s = act(s, "p0", { type: "call" });
    s = act(s, "p1", { type: "call" });
    s = act(s, "p2", { type: "check" });
    for (let i = 0; i < 9; i++) s = act(s, toAct(s), { type: "check" });
    expect(s.result!.pots[0].winners.sort()).toEqual(["p0", "p1"]);
  });
  it("everyone folds: uncalled bet returned, no cards shown", () => {
    let s = startHand(seats(1000, 1000, 1000), "p0", blinds);
    s = act(s, "p0", { type: "raise", amount: 100 });
    s = act(s, "p1", { type: "fold" });
    s = act(s, "p2", { type: "fold" });
    expect(s.status).toBe("complete");
    expect(s.result!.showdown).toBe(false);
    expect(s.players.map((p) => p.stack)).toEqual([1030, 990, 980]);
    const v = viewFor(s, "p1");
    expect(v.seats[0].cards).toEqual([null, null]);
  });
  it("blinds larger than a stack put the player all-in", () => {
    const s = startHand(seats(1000, 5, 1000), "p0", blinds);
    expect(s.players[1].allIn).toBe(true);
    expect(s.players[1].bet).toBe(5);
  });
});

describe("privacy", () => {
  it("players only see their own hole cards until showdown", () => {
    const s = startHand(seats(1000, 1000, 1000), "p0", blinds);
    const v = viewFor(s, "p1");
    expect(v.seats[1].cards).toEqual(s.players[1].hole);
    expect(v.seats[0].cards).toEqual([null, null]);
    expect(v.seats[2].cards).toEqual([null, null]);
    const json = JSON.stringify(v);
    for (const c of [...s.players[0].hole, ...s.players[2].hole]) expect(json).not.toContain(`"id":"${c.id}"`);
    expect(json).not.toContain("deck");
  });
});

describe("random simulation", () => {
  it("5,000 random hands: chips are conserved, hands always terminate, actions are legal", () => {
    for (let n = 0; n < 5000; n++) {
      const count = 2 + (n % 7);
      const stacks = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * 600));
      let s = startHand(seats(...stacks), "p" + (n % count), blinds, n);
      const total = stacks.reduce((a, b) => a + b, 0);
      let steps = 0;
      while (s.status !== "complete") {
        expect(++steps).toBeLessThan(500);
        if (s.status === "runout") {
          s = stepRunout(s);
          continue;
        }
        const id = toAct(s);
        const l = legalFor(s, id)!;
        const opts: Action[] = [{ type: "fold" }];
        if (l.check) opts.push({ type: "check" }, { type: "check" });
        if (l.call) opts.push({ type: "call" }, { type: "call" });
        if (l.raise) opts.push({ type: "raise", amount: l.minRaiseTo + Math.floor(Math.random() * (l.maxRaiseTo - l.minRaiseTo + 1)) });
        if (l.allIn) opts.push({ type: "allin" });
        s = act(s, id, opts[Math.floor(Math.random() * opts.length)]);
        expect(totalChips(s)).toBe(total);
        expect(s.players.every((p) => p.stack >= 0)).toBe(true);
      }
      expect(s.players.reduce((t, p) => t + p.stack, 0)).toBe(total);
      const paid = Object.values(s.result!.payouts).reduce((a, b) => a + b, 0);
      expect(paid).toBe(s.players.reduce((t, p) => t + p.contributed, 0));
      if (s.result!.showdown) expect(s.board.length).toBe(5);
      const ids = new Set([...s.deck, ...s.board, ...s.players.flatMap((p) => p.hole)].map((c) => c.id));
      expect(ids.size).toBeLessThanOrEqual(52);
    }
    // ~3s alone, ~5-6s under parallel suite load (~36k actions at ~40µs each plus per-action
    // invariant checks). Exceeds vitest's 5s default.
  }, 30_000);
});
