// Poker AI. Bots only see the same redacted HandView a human gets (own cards, board, public betting).
import { Card, makeDeck, rankValue } from "./cards";
import { evaluateRaw } from "./evaluator";
import type { Action, HandView } from "./holdem";

export type Difficulty = "easy" | "medium" | "hard";

/** Public table history the room tracks per player (used by the hard bot to read opponents). */
export interface OppStats {
  hands: number;
  vpip: number; // hands where they voluntarily put chips in pre-flop
  aggressive: number; // bets/raises
  passive: number; // calls
}

const SUIT_IX: Record<string, number> = { S: 0, H: 1, D: 2, C: 3 };
const enc = (c: Card) => (rankValue(c.rank) << 2) | SUIT_IX[c.suit];

/** 0..1 pre-flop hand quality (Chen-like), used for opponent range weighting and easy bots. */
export function preflopStrength(a: number, b: number): number {
  const r1 = a >> 2, r2 = b >> 2;
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  const suited = (a & 3) === (b & 3);
  if (hi === lo) return Math.min(1, 0.5 + (hi - 2) * 0.04);
  let s = (hi - 2) / 12 * 0.45 + (lo - 2) / 12 * 0.2;
  if (suited) s += 0.08;
  const gap = hi - lo - 1;
  s -= Math.min(gap, 4) * 0.035;
  return Math.max(0, Math.min(1, s));
}

/**
 * Monte Carlo equity: probability (ties shared) of winning at showdown against the live opponents.
 * `weight(oppIndex, c1, c2)` returns 0..1 likelihood of an opponent holding those cards (1 = random range).
 */
export function equity(hole: Card[], board: Card[], opponents: number, iterations: number, weight?: (opp: number, a: number, b: number) => number): number {
  const known = new Set([...hole, ...board].map((c) => c.id));
  const deck = makeDeck().filter((c) => !known.has(c.id)).map(enc);
  const mine = hole.map(enc);
  const boardEnc = board.map(enc);
  const ranks = new Array(7), suits = new Array(7);
  let score = 0;
  for (let it = 0; it < iterations; it++) {
    // partial Fisher-Yates: draw only the cards we need
    let top = deck.length;
    const draw = () => {
      const j = Math.floor(Math.random() * top);
      top--;
      const x = deck[j];
      deck[j] = deck[top];
      deck[top] = x;
      return x;
    };
    const opp: number[][] = [];
    for (let o = 0; o < opponents; o++) {
      let a = draw(), b = draw();
      if (weight) {
        for (let tries = 0; tries < 6 && Math.random() > weight(o, a, b); tries++) {
          top += 2; // put back and redraw
          a = draw();
          b = draw();
        }
      }
      opp.push([a, b]);
    }
    const full = boardEnc.slice();
    while (full.length < 5) full.push(draw());
    const evalOf = (h: number[]) => {
      const all = [h[0], h[1], ...full];
      for (let i = 0; i < 7; i++) {
        ranks[i] = all[i] >> 2;
        suits[i] = all[i] & 3;
      }
      return evaluateRaw(ranks, suits);
    };
    const me = evalOf(mine);
    let best = true, ties = 0;
    for (const h of opp) {
      const v = evalOf(h);
      if (v > me) {
        best = false;
        break;
      }
      if (v === me) ties++;
    }
    if (best) score += 1 / (ties + 1);
  }
  return score / iterations;
}

interface Ctx {
  view: HandView;
  me: HandView["seats"][number];
  toCall: number;
  pot: number; // everything in the middle including current bets
  opponents: HandView["seats"];
  lateness: number; // 0 = first to act post-flop, 1 = button
}

function context(view: HandView): Ctx {
  const me = view.seats.find((s) => s.id === view.you)!;
  const opponents = view.seats.filter((s) => s.id !== view.you && !s.folded);
  const n = view.seats.length;
  const myIdx = view.seats.findIndex((s) => s.id === view.you);
  const dIdx = view.seats.findIndex((s) => s.id === view.dealer);
  const lateness = n > 1 ? ((myIdx - dIdx - 1 + n) % n) / (n - 1) : 1;
  return { view, me, toCall: view.legal!.callAmount, pot: view.pot, opponents, lateness };
}

/** Turn a desired "raise to" amount into a legal action. */
function raiseTo(view: HandView, amount: number): Action {
  const l = view.legal!;
  if (!l.raise) return l.call ? { type: "call" } : { type: "check" };
  const to = Math.round(Math.max(l.minRaiseTo, Math.min(l.maxRaiseTo, amount)));
  if (to >= l.maxRaiseTo * 0.92) return { type: "allin" };
  return { type: "raise", amount: to };
}
const passive = (view: HandView): Action => (view.legal!.check ? { type: "check" } : { type: "fold" });

export function chooseAction(view: HandView, difficulty: Difficulty, stats: Record<string, OppStats> = {}): Action {
  if (!view.legal) throw new Error("Not this player's turn");
  const ctx = context(view);
  if (difficulty === "easy") return easy(ctx);
  if (difficulty === "medium") return medium(ctx);
  return hard(ctx, stats);
}

// EASY: rough feel for its own cards, ignores position and odds, calls too much and sometimes blunders.
function easy({ view, me, toCall, pot }: Ctx): Action {
  const eq = equity(me.cards as Card[], view.board, 1, 120) + (Math.random() - 0.5) * 0.3;
  const roll = Math.random();
  if (roll < 0.06) return passive(view); // random give-up
  if (roll < 0.1 && view.legal!.raise) return raiseTo(view, view.currentBet + pot); // random oversized raise
  if (eq > 0.72 && view.legal!.raise) return raiseTo(view, view.currentBet + Math.max(view.bigBlind * 2, pot * 0.5));
  if (toCall === 0) return { type: "check" };
  if (eq > 0.35 || toCall <= view.bigBlind * 2) return { type: "call" };
  return { type: "fold" };
}

export const MED = { value: 0.52, steal: 1, call: 0.06, raise: 0.65 }; // tuned by duplicate-deal simulation
// MEDIUM: equity vs the real number of opponents, pot odds and position.
function medium({ view, me, toCall, pot, opponents, lateness }: Ctx): Action {
  const n = opponents.length;
  const eq = equity(me.cards as Card[], view.board, n, 300);
  const fair = 1 / (n + 1);
  const potOdds = toCall / (pot + toCall);
  const posBonus = (lateness - 0.5) * 0.06;
  const strength = eq + posBonus;
  if (toCall === 0) {
    if (strength > Math.max(MED.value, fair * 1.8)) return raiseTo(view, view.currentBet + pot * 0.65);
    if (lateness > 0.7 && strength > fair * 1.2 && Math.random() < MED.steal) return raiseTo(view, view.currentBet + pot * 0.5);
    return { type: "check" };
  }
  if (strength > Math.max(MED.raise, fair * 2.2) && view.legal!.raise) return raiseTo(view, view.currentBet * 2.5 + pot * 0.3);
  if (strength > potOdds + MED.call) return { type: "call" };
  return { type: "fold" };
}

/** Update per-player public stats from a finished hand's betting log. */
export function recordStats(stats: Record<string, OppStats>, players: string[], log: HandView["log"]) {
  for (const id of players) {
    const st = (stats[id] ??= { hands: 0, vpip: 0, aggressive: 0, passive: 0 });
    st.hands++;
    const mine = log.filter((l) => l.playerId === id);
    if (mine.some((l) => l.street === "preflop" && (l.type === "call" || l.type === "raise" || l.type === "allin"))) st.vpip++;
    st.aggressive += mine.filter((l) => l.type === "raise" || l.type === "allin").length;
    st.passive += mine.filter((l) => l.type === "call").length;
  }
}

// HARD: one-street expected-value search. For each sampled world (opponent hands drawn from ranges
// narrowed by their betting, rest of the board dealt out) it records who wins at showdown and how strong
// each opponent *thinks* they are right now. A model of each opponent's calling behaviour (loosened or
// tightened by their observed history) then gives fold probability and equity-when-called for every
// candidate bet size, so the bot picks the action with the best EV — value-betting, folding, and bluffing
// exactly when the numbers say so.
function hard({ view, me, toCall, pot, opponents, lateness }: Ctx, stats: Record<string, OppStats>): Action {
  const n = opponents.length;
  const l = view.legal!;
  const boardEnc = view.board.map(enc);
  const mine = (me.cards as Card[]).map(enc);
  const preflop = boardEnc.length < 3;

  // Opponent profiles from history (default: a reasonable unknown player).
  const prof = opponents.map((o) => {
    const st = stats[o.id];
    const vpip = st && st.hands >= 4 ? st.vpip / st.hands : 0.4;
    const af = st && st.aggressive + st.passive >= 5 ? st.aggressive / Math.max(1, st.passive) : 1;
    const acts = view.log.filter((x) => x.playerId === o.id);
    const raises = acts.filter((x) => x.type === "raise" || x.type === "allin").length;
    const calls = acts.filter((x) => x.type === "call").length;
    // Range narrowing: loose/aggressive players get less credit for betting.
    const credit = (vpip > 0.55 ? 0.6 : vpip < 0.25 ? 1.3 : 1) * (af > 2.5 ? 0.6 : af < 0.6 ? 1.3 : 1);
    const tight = Math.min(0.92, (raises * 0.3 + calls * 0.12) * credit);
    // Call-down tendency: stations (high vpip, passive) call much lighter.
    const looseness = (vpip - 0.4) * 0.5 + (af < 0.7 ? 0.08 : af > 2.5 ? 0.04 : 0);
    return { tight, looseness };
  });

  const scratchR = new Array(7), scratchS = new Array(7);
  const evalCards = (all: number[]) => {
    for (let i = 0; i < all.length; i++) {
      scratchR[i] = all[i] >> 2;
      scratchS[i] = all[i] & 3;
    }
    scratchR.length = scratchS.length = all.length;
    return evaluateRaw(scratchR, scratchS);
  };
  /** How strong a holding looks to its owner on the current board (0..1), counting draws. */
  const perceived = (a: number, b: number) => {
    if (preflop) return preflopStrength(a, b);
    const v = evalCards([a, b, ...boardEnc]);
    const cat = v >> 20, top = (v >> 16) & 15;
    let st = cat === 0 ? 0.08 + (Math.max(a >> 2, b >> 2) / 14) * 0.1 : cat === 1 ? 0.22 + (top / 14) * 0.28 : Math.min(1, 0.58 + cat * 0.07);
    if (boardEnc.length < 5 && st < 0.45) {
      const suitN = [0, 0, 0, 0];
      for (const c of [a, b, ...boardEnc]) suitN[c & 3]++;
      if (suitN[a & 3] >= 4 || suitN[b & 3] >= 4) st = Math.max(st, 0.42); // flush draw
    }
    return st;
  };

  // Sample worlds.
  const known = new Set([...mine, ...boardEnc]);
  const deck: number[] = [];
  for (const c of makeDeck()) {
    const e = enc(c);
    if (!known.has(e)) deck.push(e);
  }
  // Budgeted to stay a few ms per decision (Workers CPU limits).
  const iterations = Math.max(120, Math.floor(1000 / (n + 1)));
  const worlds: { me: number; opp: number[]; seen: number[] }[] = [];
  for (let it = 0; it < iterations; it++) {
    let top = deck.length;
    const draw = () => {
      const j = Math.floor(Math.random() * top);
      top--;
      const x = deck[j];
      deck[j] = deck[top];
      deck[top] = x;
      return x;
    };
    const hands: number[][] = [];
    const seen: number[] = [];
    for (let o = 0; o < n; o++) {
      let a = draw(), b = draw(), p = perceived(a, b);
      for (let k = 0; k < 4 && prof[o].tight > 0 && Math.random() > 1 - prof[o].tight + prof[o].tight * Math.min(1, p * 1.5); k++) {
        top += 2;
        a = draw();
        b = draw();
        p = perceived(a, b);
      }
      hands.push([a, b]);
      seen.push(p);
    }
    const full = boardEnc.slice();
    while (full.length < 5) full.push(draw());
    worlds.push({ me: evalCards([...mine, ...full]), opp: hands.map((h) => evalCards([...h, ...full])), seen });
  }

  const share = (w: (typeof worlds)[number], callers: number[]) => {
    let ties = 0;
    for (const o of callers) {
      if (w.opp[o] > w.me) return 0;
      if (w.opp[o] === w.me) ties++;
    }
    return 1 / (ties + 1);
  };
  const all = opponents.map((_, i) => i);
  const eqAll = worlds.reduce((t, w) => t + share(w, all), 0) / worlds.length;

  /** EV (chips I end up with from the pot, minus what I add now) of putting my street bet to `to`. */
  const evBet = (to: number) => {
    const add = to - me.bet;
    let total = 0;
    for (const w of worlds) {
      const callers: number[] = [];
      let potAfter = pot + add;
      opponents.forEach((o, i) => {
        const need = Math.min(to - o.bet, o.stack);
        if (need <= 0) return callers.push(i);
        const f = need / Math.max(1, pot + add);
        const thr = (preflop ? 0.3 + 0.18 * Math.min(f, 2) : 0.24 + 0.2 * Math.min(f, 2)) - prof[i].looseness + (n > 1 ? 0.04 : 0);
        if (w.seen[i] >= thr) {
          callers.push(i);
          potAfter += need;
        }
      });
      total += callers.length === 0 ? pot + add : share(w, callers) * potAfter;
    }
    return total / worlds.length - add;
  };

  // Candidate actions with their EVs.
  const options: { action: Action; ev: number }[] = [];
  if (l.check) options.push({ action: { type: "check" }, ev: eqAll * pot * (0.85 + lateness * 0.15) });
  else {
    options.push({ action: { type: "fold" }, ev: 0 });
    // Calling realises less equity out of position; add a little implied odds on early streets.
    const realise = 0.88 + lateness * 0.12 + (view.street === "flop" || view.street === "turn" ? 0.04 : 0);
    options.push({ action: { type: "call" }, ev: eqAll * realise * (pot + toCall) - toCall });
  }
  if (l.raise) {
    const sizes = preflop ? [view.currentBet * 3 + (pot - view.currentBet) * 0.5, view.currentBet * 4 + pot * 0.5] : [view.currentBet + pot * 0.5, view.currentBet * 2 + pot * 0.75, view.currentBet * 2 + pot * 1.2];
    for (const target of sizes) {
      const act = raiseTo(view, target);
      if (act.type !== "raise") continue;
      options.push({ action: act, ev: evBet(act.amount) });
    }
    options.push({ action: { type: "allin" }, ev: evBet(l.maxRaiseTo) });
  } else if (l.allIn && l.call) {
    // short stack: all-in is just a call
  }
  options.sort((a, b) => b.ev - a.ev);
  // Small randomisation between near-equal options keeps the bot from being fully predictable.
  const best = options[0];
  const close = options.filter((o) => best.ev - o.ev < Math.max(1, Math.abs(best.ev) * 0.04));
  return close[Math.floor(Math.random() * close.length)].action;
}
