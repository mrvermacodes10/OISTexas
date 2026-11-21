// No-limit Texas Hold'em — pure, UI-independent hand engine.
// One HandState = one hand. The room server chains hands, rotates the button and removes busted players.
import { Card, makeDeck, shuffle } from "./cards";
import { bestFive, describe, evaluate } from "./evaluator";

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";
export type Action = { type: "fold" } | { type: "check" } | { type: "call" } | { type: "raise"; amount: number } | { type: "allin" };

export interface Player {
  id: string;
  stack: number; // chips behind
  hole: Card[];
  bet: number; // chips put in on the current street
  contributed: number; // chips put in this hand (all streets)
  folded: boolean;
  allIn: boolean;
  acted: boolean; // has acted on this street
  seenRaise: number; // raiseCount when this player last acted (for the incomplete-raise rule)
}

export interface LogEntry {
  playerId: string;
  street: Street;
  type: Action["type"] | "sb" | "bb";
  amount: number; // chips added by this action
  to: number; // player's street bet after the action
}

export interface Pot {
  amount: number;
  eligible: string[];
  winners: string[];
}

export interface HandResult {
  showdown: boolean;
  pots: Pot[];
  payouts: Record<string, number>;
  hands: Record<string, { score: number; name: string; best: string[] }>; // only players who reached showdown
}

export interface HandState {
  handNo: number;
  players: Player[]; // seat order
  dealer: number;
  sb: number;
  bb: number;
  smallBlind: number;
  bigBlind: number;
  deck: Card[];
  board: Card[];
  street: Street;
  status: "betting" | "runout" | "complete";
  toAct: number; // index into players, -1 if nobody
  currentBet: number;
  minRaise: number; // size of the last full raise (min increment)
  raiseCount: number; // full raises this street
  seq: number;
  log: LogEntry[];
  result: HandResult | null;
}

export type Result = { ok: true; state: HandState } | { ok: false; error: string };

const clone = (s: HandState): HandState => JSON.parse(JSON.stringify(s));
const fail = (error: string): Result => ({ ok: false, error });

// ---------- setup ----------

export function startHand(seats: { id: string; stack: number }[], dealerId: string, blinds: { small: number; big: number }, handNo = 1, deck?: Card[]): HandState {
  if (seats.length < 2) throw new Error("Need at least 2 players with chips");
  if (seats.some((p) => !(p.stack > 0))) throw new Error("Every seated player needs chips");
  if (new Set(seats.map((p) => p.id)).size !== seats.length) throw new Error("Duplicate player ids");
  const dealer = seats.findIndex((p) => p.id === dealerId);
  if (dealer < 0) throw new Error("Dealer is not seated");
  const n = seats.length;
  const players: Player[] = seats.map((p) => ({ id: p.id, stack: p.stack, hole: [], bet: 0, contributed: 0, folded: false, allIn: false, acted: false, seenRaise: -1 }));
  // Heads-up: the button posts the small blind and acts first pre-flop.
  const sb = n === 2 ? dealer : (dealer + 1) % n;
  const bb = (sb + 1) % n;

  const s: HandState = {
    handNo,
    players,
    dealer,
    sb,
    bb,
    smallBlind: blinds.small,
    bigBlind: blinds.big,
    deck: deck ? deck.slice() : shuffle(makeDeck()),
    board: [],
    street: "preflop",
    status: "betting",
    toAct: -1,
    currentBet: blinds.big,
    minRaise: blinds.big,
    raiseCount: 0,
    seq: 0,
    log: [],
    result: null,
  };

  // Deal two cards each, one at a time, starting with the small blind.
  for (let round = 0; round < 2; round++) for (let i = 0; i < n; i++) players[(sb + i) % n].hole.push(s.deck.pop()!);

  post(s, sb, blinds.small, "sb");
  post(s, bb, blinds.big, "bb");
  s.toAct = nextToAct(s, bb);
  if (s.toAct < 0) progress(s);
  return s;
}

function post(s: HandState, i: number, amount: number, type: "sb" | "bb") {
  const p = s.players[i];
  const x = putChips(p, amount);
  s.log.push({ playerId: p.id, street: "preflop", type, amount: x, to: p.bet });
}

function putChips(p: Player, amount: number): number {
  const x = Math.min(amount, p.stack);
  p.stack -= x;
  p.bet += x;
  p.contributed += x;
  if (p.stack === 0) p.allIn = true;
  return x;
}

// ---------- queries ----------

const needsAction = (s: HandState, p: Player) => !p.folded && !p.allIn && (!p.acted || p.bet < s.currentBet);
const live = (s: HandState) => s.players.filter((p) => !p.folded);
export const potTotal = (s: HandState) => s.players.reduce((t, p) => t + p.contributed, 0);
export const currentPlayerId = (s: HandState) => (s.toAct >= 0 ? s.players[s.toAct].id : null);

/** Next player after index `from` (exclusive, wrapping) who must act; -1 if none. */
function nextToAct(s: HandState, from: number): number {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (needsAction(s, s.players[i])) return i;
  }
  return -1;
}

export interface Legal {
  fold: boolean;
  check: boolean;
  call: boolean;
  callAmount: number; // chips needed to call (capped by stack)
  raise: boolean;
  minRaiseTo: number; // smallest legal "raise to" (street total)
  maxRaiseTo: number; // all-in "raise to"
  allIn: boolean;
}

export function legalFor(s: HandState, playerId: string): Legal | null {
  if (s.status !== "betting" || currentPlayerId(s) !== playerId) return null;
  const p = s.players[s.toAct];
  const toCall = Math.max(0, s.currentBet - p.bet);
  const maxTo = p.bet + p.stack;
  const reopened = !p.acted || p.seenRaise < s.raiseCount;
  const canRaise = reopened && maxTo > s.currentBet && live(s).some((o) => o !== p && !o.allIn);
  return {
    fold: true,
    check: toCall === 0,
    call: toCall > 0,
    callAmount: Math.min(toCall, p.stack),
    raise: canRaise,
    minRaiseTo: Math.min(s.currentBet + s.minRaise, maxTo),
    maxRaiseTo: maxTo,
    allIn: canRaise || (toCall > 0 && p.stack <= toCall),
  };
}

// ---------- actions ----------

export function applyAction(state: HandState, playerId: string, action: Action): Result {
  if (state.status !== "betting") return fail("No betting right now");
  if (currentPlayerId(state) !== playerId) return fail("It is not your turn");
  if (!action || typeof action !== "object") return fail("Invalid action");
  const legal = legalFor(state, playerId)!;
  const s = clone(state);
  const p = s.players[s.toAct];
  let type = action.type;
  let added = 0;

  switch (action.type) {
    case "fold":
      p.folded = true;
      break;
    case "check":
      if (!legal.check) return fail("You can't check — there is a bet to call");
      break;
    case "call":
      if (!legal.call) return fail("Nothing to call — check instead");
      added = putChips(p, s.currentBet - p.bet);
      break;
    case "raise":
    case "allin": {
      const to = action.type === "allin" ? p.bet + p.stack : action.amount;
      if (!Number.isInteger(to) || to <= 0) return fail("Invalid amount");
      if (to > p.bet + p.stack) return fail("You don't have that many chips");
      if (to <= s.currentBet) {
        // An all-in for no more than the current bet is just a call.
        if (action.type === "allin" && legal.call) {
          type = "call";
          added = putChips(p, p.stack);
          break;
        }
        return fail(`Raise must be more than ${s.currentBet}`);
      }
      if (!legal.raise) return fail("Betting has not been reopened — you can only call or fold");
      const isAllIn = to === p.bet + p.stack;
      if (to < s.currentBet + s.minRaise && !isAllIn) return fail(`Minimum raise is to ${s.currentBet + s.minRaise}`);
      const increment = to - s.currentBet;
      added = putChips(p, to - p.bet);
      if (increment >= s.minRaise) {
        s.minRaise = increment;
        s.raiseCount++; // full raise: re-opens betting for everyone
      }
      s.currentBet = to;
      if (isAllIn) type = "allin";
      break;
    }
    default:
      return fail("Unknown action");
  }

  p.acted = true;
  p.seenRaise = s.raiseCount;
  s.log.push({ playerId, street: s.street, type, amount: added, to: p.bet });
  s.seq++;
  const from = s.toAct;
  s.toAct = live(s).length === 1 ? -1 : nextToAct(s, from);
  if (s.toAct < 0) progress(s);
  return { ok: true, state: s };
}

/** Called when nobody needs to act: ends the hand, deals the next street, or starts an all-in runout. */
function progress(s: HandState) {
  if (live(s).length === 1) return finish(s);
  if (s.street === "river") return finish(s);
  const canBet = live(s).filter((p) => !p.allIn).length;
  if (canBet <= 1) {
    s.status = "runout"; // no more betting possible: room reveals the remaining streets one by one
    s.toAct = -1;
    return;
  }
  dealNextStreet(s);
  s.toAct = nextToAct(s, s.dealer);
  if (s.toAct < 0) progress(s);
}

function dealNextStreet(s: HandState) {
  for (const p of s.players) {
    p.bet = 0;
    p.acted = false;
    p.seenRaise = -1;
  }
  s.currentBet = 0;
  s.minRaise = s.bigBlind;
  s.raiseCount = 0;
  s.deck.pop(); // burn
  if (s.street === "preflop") {
    s.board.push(s.deck.pop()!, s.deck.pop()!, s.deck.pop()!);
    s.street = "flop";
  } else if (s.street === "flop") {
    s.board.push(s.deck.pop()!);
    s.street = "turn";
  } else {
    s.board.push(s.deck.pop()!);
    s.street = "river";
  }
  s.seq++;
}

/** Reveal the next street of an all-in runout (or go to showdown after the river). */
export function stepRunout(state: HandState): HandState {
  if (state.status !== "runout") return state;
  const s = clone(state);
  if (s.street === "river") finish(s);
  else dealNextStreet(s);
  return s;
}

// ---------- showdown & pots ----------

/** Split contributions into main pot + side pots. Folded players' chips count but they can't win. */
export function buildPots(players: Pick<Player, "id" | "contributed" | "folded">[]): Pot[] {
  const contenders = players.filter((p) => !p.folded);
  const levels = [...new Set(contenders.map((p) => p.contributed))].filter((x) => x > 0).sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) amount += Math.max(0, Math.min(p.contributed, level) - prev);
    const eligible = contenders.filter((p) => p.contributed >= level).map((p) => p.id);
    const last = pots[pots.length - 1];
    if (last && last.eligible.length === eligible.length && last.eligible.every((id) => eligible.includes(id))) last.amount += amount;
    else if (amount > 0) pots.push({ amount, eligible, winners: [] });
    prev = level;
  }
  // Dead money above every contender's level (rare) goes to the last pot.
  const dead = players.reduce((t, p) => t + Math.max(0, p.contributed - prev), 0);
  if (dead > 0 && pots.length) pots[pots.length - 1].amount += dead;
  return pots;
}

function finish(s: HandState) {
  const contenders = live(s);
  const showdown = contenders.length > 1;
  // Complete the board for showdown if betting ended early with all-ins.
  if (showdown) while (s.board.length < 5) {
    s.deck.pop();
    s.board.push(s.deck.pop()!);
  }
  const hands: HandResult["hands"] = {};
  const scores: Record<string, number> = {};
  if (showdown) {
    for (const p of contenders) {
      const best = bestFive([...p.hole, ...s.board]);
      scores[p.id] = evaluate([...p.hole, ...s.board]);
      hands[p.id] = { score: scores[p.id], name: describe(scores[p.id]), best: best.cards.map((c) => c.id) };
    }
  }

  const pots = buildPots(s.players);
  const payouts: Record<string, number> = Object.fromEntries(s.players.map((p) => [p.id, 0]));
  const n = s.players.length;
  // Odd chips go to the winner closest to the left of the button.
  const leftOfButton = (id: string) => (s.players.findIndex((p) => p.id === id) - s.dealer - 1 + n) % n;
  for (const pot of pots) {
    let winners: string[];
    if (!showdown || pot.eligible.length === 1) winners = pot.eligible;
    else {
      const top = Math.max(...pot.eligible.map((id) => scores[id]));
      winners = pot.eligible.filter((id) => scores[id] === top);
    }
    winners.sort((a, b) => leftOfButton(a) - leftOfButton(b));
    pot.winners = winners;
    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    for (const w of winners) payouts[w] += share + (odd-- > 0 ? 1 : 0);
  }
  for (const p of s.players) {
    p.stack += payouts[p.id];
    p.bet = 0;
  }
  s.street = showdown ? "showdown" : s.street;
  s.status = "complete";
  s.toAct = -1;
  s.result = { showdown, pots, payouts, hands };
  s.seq++;
}

// ---------- redacted per-player view ----------

export interface SeatView {
  id: string;
  stack: number;
  bet: number;
  contributed: number;
  folded: boolean;
  allIn: boolean;
  cards: (Card | null)[]; // null = face-down card
}

export interface HandView {
  handNo: number;
  seq: number;
  you: string;
  seats: SeatView[];
  board: Card[];
  pot: number;
  street: Street;
  status: HandState["status"];
  toAct: string | null;
  dealer: string;
  sb: string;
  bb: string;
  smallBlind: number;
  bigBlind: number;
  currentBet: number;
  legal: Legal | null;
  log: LogEntry[];
  result: HandResult | null;
}

export function viewFor(s: HandState, viewer: string): HandView {
  const shown = s.result?.showdown ? new Set(Object.keys(s.result.hands)) : new Set<string>();
  return {
    handNo: s.handNo,
    seq: s.seq,
    you: viewer,
    seats: s.players.map((p) => ({
      id: p.id,
      stack: p.stack,
      bet: p.bet,
      contributed: p.contributed,
      folded: p.folded,
      allIn: p.allIn,
      cards: p.id === viewer || shown.has(p.id) ? p.hole : p.folded ? [] : p.hole.map(() => null),
    })),
    board: s.board,
    pot: potTotal(s),
    street: s.street,
    status: s.status,
    toAct: currentPlayerId(s),
    dealer: s.players[s.dealer].id,
    sb: s.players[s.sb].id,
    bb: s.players[s.bb].id,
    smallBlind: s.smallBlind,
    bigBlind: s.bigBlind,
    currentBet: s.currentBet,
    legal: legalFor(s, viewer),
    log: s.log,
    result: s.result,
  };
}

/** Default action when a player times out or has left: check if free, otherwise fold. */
export const timeoutAction = (s: HandState, id: string): Action => (legalFor(s, id)?.check ? { type: "check" } : { type: "fold" });
