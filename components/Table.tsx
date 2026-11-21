"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Action, HandView, LogEntry, SeatView } from "@/game/holdem";
import type { ClientMsg, PublicMember, RoomView } from "@/game/protocol";
import { evaluate, describe as describeHand } from "@/game/evaluator";
import type { Card } from "@/game/cards";
import { sfx } from "@/lib/client";
import { CardBack, CardSlot, PlayingCard } from "./Card";
import { Avatar, Button, ChipStack } from "./ui";

type Pt = { x: number; y: number }; // percent of the table area
const CENTER: Pt = { x: 50, y: 47 };
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
/** Dealer button: a little in front of the seat and off to its side. */
function buttonPos(seat: Pt): Pt {
  const p = lerp(seat, CENTER, 0.32);
  const vx = seat.x - CENTER.x, vy = seat.y - CENTER.y;
  const len = Math.hypot(vx, vy) || 1;
  return { x: p.x - (vy / len) * 7, y: p.y + (vx / len) * 7 };
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const ACTION_LABEL = (l: LogEntry) =>
  l.type === "fold" ? "Fold" : l.type === "check" ? "Check" : l.type === "call" ? `Call ${l.amount.toLocaleString()}` : l.type === "raise" ? (l.to === l.amount && l.street !== "preflop" ? `Bet ${l.to.toLocaleString()}` : `Raise ${l.to.toLocaleString()}`) : l.type === "allin" ? "All-in" : l.type === "sb" ? "Small blind" : "Big blind";

interface Flight {
  id: string;
  from: Pt;
  to: Pt;
  amount: number;
}

export function PokerTable({ room, send, sound }: { room: RoomView; send: (m: ClientMsg) => void; sound: boolean }) {
  const hand = room.hand!;
  const members = useMemo(() => Object.fromEntries(room.members.map((m) => [m.id, m])), [room.members]);
  const [areaRef, size] = useSize<HTMLDivElement>();
  const portrait = size.h > size.w * 1.05;
  const skew = room.serverNow - Date.now(); // server clock offset (approx.)

  // Seat geometry: you sit at the bottom; others clockwise around an ellipse.
  const n = hand.seats.length;
  const myIdx = Math.max(0, hand.seats.findIndex((s) => s.id === room.you));
  const positions = useMemo(() => {
    const rx = portrait ? 36 : 44, ry = portrait ? 41 : 39;
    return Object.fromEntries(
      hand.seats.map((s, i) => {
        const rel = (i - myIdx + n) % n;
        const a = ((90 + (rel * 360) / n) * Math.PI) / 180;
        return [s.id, { x: 50 + rx * Math.cos(a), y: CENTER.y + ry * Math.sin(a) + (rel === 0 ? (portrait ? 3 : 4) : 0) }];
      }),
    ) as Record<string, Pt>;
  }, [hand.seats, myIdx, n, portrait]);
  const px = (p: Pt) => ({ x: (p.x / 100) * size.w, y: (p.y / 100) * size.h });

  // ---- chip flights (bets → pot on each new street, pot → winners at the end) ----
  const [flights, setFlights] = useState<Flight[]>([]);
  const prev = useRef<{ handNo: number; street: string; bets: Record<string, number>; status: string; toAct: string | null } | null>(null);
  useEffect(() => {
    const p = prev.current;
    const fl: Flight[] = [];
    if (p && p.handNo === hand.handNo) {
      if (p.street !== hand.street || (p.status !== "complete" && hand.status === "complete")) {
        for (const [id, amt] of Object.entries(p.bets)) if (amt > 0 && positions[id]) fl.push({ id: `c${hand.seq}${id}`, from: lerp(positions[id], CENTER, 0.42), to: CENTER, amount: amt });
        if (hand.board.length > 0 && p.street !== hand.street) sfx("card", sound);
      }
      if (p.status !== "complete" && hand.status === "complete" && hand.result) {
        for (const [id, amt] of Object.entries(hand.result.payouts)) if (amt > 0 && positions[id]) fl.push({ id: `w${hand.seq}${id}`, from: CENTER, to: lerp(positions[id], CENTER, 0.2), amount: amt });
        if (hand.result.payouts[room.you] > 0) setTimeout(() => sfx("win", sound), 350);
      }
      const last = hand.log[hand.log.length - 1];
      if (last && hand.log.length > 0 && p.toAct !== hand.toAct && (last.type === "call" || last.type === "raise" || last.type === "allin")) sfx("chip", sound);
      if (hand.toAct === room.you && p.toAct !== room.you) setTimeout(() => sfx("turn", sound), 150);
    } else if (!p || p.handNo !== hand.handNo) {
      sfx("card", sound);
      if (hand.toAct === room.you) setTimeout(() => sfx("turn", sound), 600);
    }
    prev.current = { handNo: hand.handNo, street: hand.street, bets: Object.fromEntries(hand.seats.map((s) => [s.id, s.bet])), status: hand.status, toAct: hand.toAct };
    if (fl.length) {
      setFlights((f) => [...f, ...fl]);
      const ids = new Set(fl.map((x) => x.id));
      setTimeout(() => setFlights((f) => f.filter((x) => !ids.has(x.id))), 900);
    }
  }, [hand, positions, room.you, sound]);

  const now = useNow(!!room.turnDeadline || !!room.nextHandAt);
  const streetBets = hand.seats.reduce((t, s) => t + s.bet, 0);
  const middle = hand.status === "complete" ? 0 : hand.pot - streetBets;
  const winners = new Set(hand.result?.pots.flatMap((p) => p.winners) ?? []);
  const bestCards = new Set(hand.result?.showdown ? Object.entries(hand.result.hands).filter(([id]) => winners.has(id)).flatMap(([, h]) => h.best) : []);
  const me = hand.seats.find((s) => s.id === room.you);
  const meMember = members[room.you];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={areaRef} className="relative mx-auto min-h-0 w-full max-w-[1200px] flex-1" style={{ ["--card-w" as string]: portrait ? "40px" : "52px" }}>
        {/* The table */}
        <div className="absolute rounded-[50%] bg-[#160d08] p-[1.2%] shadow-[0_30px_80px_rgba(0,0,0,.6)]" style={portrait ? { left: "9%", right: "9%", top: "9%", bottom: "13%" } : { left: "8%", right: "8%", top: "11%", bottom: "15%" }}>
          <div className="h-full w-full rounded-[50%] ring-1 ring-gold/25">
            <div className="felt h-full w-full rounded-[50%] p-[3%]">
              <div className="h-full w-full rounded-[50%] border border-gold/15" />
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute left-1/2 top-[66%] -translate-x-1/2 select-none font-display text-[clamp(16px,2.6vw,30px)] tracking-wide text-black/20">
          OIS<span className="text-black/25">texas</span>
        </div>

        {/* Pot + board */}
        <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2" style={{ left: `${CENTER.x}%`, top: `${CENTER.y}%` }}>
          <div className={`flex items-center gap-2 rounded-full bg-black/40 px-3 py-1 text-sm text-ivory ring-1 ring-gold/25 transition ${hand.pot ? "opacity-100" : "opacity-0"}`}>
            <span className="text-[11px] uppercase tracking-widest text-gold-soft/80">Pot</span>
            <span className="font-semibold tabular-nums">{hand.pot.toLocaleString()}</span>
          </div>
          <div className="flex gap-1 sm:gap-1.5" style={{ ["--card-w" as string]: portrait ? "44px" : "clamp(50px, 6vw, 74px)" }}>
            {Array.from({ length: 5 }, (_, i) => {
              const c = hand.board[i];
              return c ? (
                <div key={c.id} className="anim-flip" style={{ animationDelay: `${hand.board.length === 3 && i < 3 ? i * 120 : 0}ms` }}>
                  <PlayingCard card={c} glow={bestCards.has(c.id)} dim={hand.status === "complete" && hand.result?.showdown === true && !bestCards.has(c.id)} />
                </div>
              ) : (
                <CardSlot key={"slot" + i} />
              );
            })}
          </div>
          <div className={`h-6 transition ${middle > 0 ? "opacity-100" : "opacity-0"}`}>{middle > 0 && <ChipStack amount={middle} size={16} />}</div>
        </div>

        {/* Bets in front of players */}
        {hand.seats.map((s) =>
          s.bet > 0 && hand.status !== "complete" ? (
            <div key={`bet${s.id}${hand.street}`} className="anim-chip-in absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/35 px-2 py-0.5 text-[12px] text-ivory" style={{ left: `${lerp(positions[s.id], CENTER, 0.42).x}%`, top: `${lerp(positions[s.id], CENTER, 0.42).y}%` }}>
              <ChipStack amount={s.bet} size={14} />
            </div>
          ) : null,
        )}

        {/* Dealer button */}
        {positions[hand.dealer] && (
          <div
            className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ivory text-[11px] font-bold text-[#16191a] shadow-[0_2px_6px_rgba(0,0,0,.5)] ring-2 ring-gold/70 transition-all duration-700"
            style={{ left: `${buttonPos(positions[hand.dealer]).x}%`, top: `${buttonPos(positions[hand.dealer]).y}%` }}
            title="Dealer button"
          >
            D
          </div>
        )}

        {/* Chip flights */}
        {flights.map((f) => {
          const a = px(f.from), b = px(f.to);
          return (
            <div key={f.id} className="anim-fly pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2" style={{ left: `${f.to.x}%`, top: `${f.to.y}%`, ["--fx" as string]: `${a.x - b.x}px`, ["--fy" as string]: `${a.y - b.y}px` }}>
              <ChipStack amount={f.amount} size={16} label={false} />
            </div>
          );
        })}

        {/* Seats */}
        {hand.seats.map((s, i) => (
          <Seat
            key={s.id}
            seat={s}
            member={members[s.id]}
            pos={positions[s.id]}
            isMe={s.id === room.you}
            hand={hand}
            dealFrom={{ x: px(CENTER).x - px(positions[s.id]).x, y: px(CENTER).y - px(positions[s.id]).y }}
            dealOrder={(i - hand.seats.findIndex((x) => x.id === hand.sb) + n) % n}
            n={n}
            deadline={hand.toAct === s.id && room.turnDeadline ? room.turnDeadline - skew : null}
            now={now}
            winner={winners.has(s.id)}
            bestCards={bestCards}
            portrait={portrait}
          />
        ))}

        {/* Result banner */}
        {hand.status === "complete" && hand.result && room.phase === "playing" && (
          <div className="anim-pop absolute left-1/2 z-20 -translate-x-1/2 rounded-2xl bg-black/70 px-4 py-2.5 text-center ring-1 ring-gold/40 backdrop-blur-sm" style={{ top: portrait ? "58%" : "62%" }}>
            {hand.result.pots.map((p, i) => {
              const names = p.winners.map((w) => (w === room.you ? "You" : members[w]?.name ?? "?")).join(" & ");
              const hn = hand.result!.showdown && p.eligible.length > 1 ? hand.result!.hands[p.winners[0]]?.name : null;
              const label = hand.result!.pots.length > 1 ? (i === 0 ? "Main pot" : p.eligible.length === 1 ? "Returned" : `Side pot ${i}`) : p.winners.length > 1 ? "Split pot" : null;
              return (
                <div key={i} className="text-sm sm:text-base">
                  {label && <span className="mr-2 text-[11px] uppercase tracking-widest text-gold-soft/80">{label}</span>}
                  <span className="font-semibold text-gold">{names}</span> {p.winners.length > 1 || names === "You" ? "win" : "wins"} {p.amount.toLocaleString()}
                  {hn && <span className="text-ivory/70"> · {hn}</span>}
                </div>
              );
            })}
            {room.nextHandAt && <div className="mt-1 text-[11px] text-mist">Next hand in {Math.max(0, Math.ceil((room.nextHandAt - skew - now) / 1000))}s</div>}
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="relative z-20 px-2 pb-[max(env(safe-area-inset-bottom),10px)] pt-1">
        {room.phase === "playing" && hand.legal && hand.status === "betting" ? (
          <ActionBar hand={hand} send={send} />
        ) : (
          <StatusLine room={room} hand={hand} me={me} meMember={meMember} members={members} />
        )}
      </div>
    </div>
  );
}

function Seat({ seat, member, pos, isMe, hand, dealFrom, dealOrder, n, deadline, now, winner, bestCards, portrait }: {
  seat: SeatView; member?: PublicMember; pos: Pt; isMe: boolean; hand: HandView; dealFrom: Pt; dealOrder: number; n: number;
  deadline: number | null; now: number; winner: boolean; bestCards: Set<string>; portrait: boolean;
}) {
  const active = hand.toAct === seat.id && hand.status === "betting";
  const last = [...hand.log].reverse().find((l) => l.playerId === seat.id && (l.street === hand.street || l.type === "fold" || l.type === "allin"));
  const showdownHand = hand.result?.showdown ? hand.result.hands[seat.id] : undefined;
  const timeLeft = deadline ? Math.max(0, deadline - now) : 0;
  const pct = deadline ? Math.min(100, (timeLeft / 30000) * 100) : 0;
  const cardW = isMe ? (portrait ? "50px" : "64px") : showdownHand ? (portrait ? "36px" : "48px") : portrait ? "28px" : "38px";
  const badge = seat.id === hand.sb ? "SB" : seat.id === hand.bb ? "BB" : null;

  return (
    <div className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
      {/* hole cards */}
      <div className={`mb-[-10px] flex ${isMe ? "gap-1" : "-space-x-3"} ${seat.folded ? "opacity-30" : ""}`} style={{ ["--card-w" as string]: cardW }}>
        {seat.cards.map((c, k) => (
          <div
            key={`${hand.handNo}-${k}-${c ? c.id : "x"}`}
            className={c && !isMe ? "anim-flip" : "anim-deal-from"}
            style={{ ["--fx" as string]: `${dealFrom.x}px`, ["--fy" as string]: `${dealFrom.y}px`, animationDelay: c && !isMe ? "0ms" : `${(k * n + dealOrder) * 70}ms`, transform: isMe ? `rotate(${k ? 4 : -4}deg)` : `rotate(${k ? 6 : -6}deg)` }}
          >
            {c ? <PlayingCard card={c as Card} glow={bestCards.has(c.id)} dim={!!hand.result?.showdown && !bestCards.has(c.id) && hand.status === "complete"} /> : <CardBack />}
          </div>
        ))}
      </div>
      {/* name plate */}
      <div className={`relative flex items-center gap-2 rounded-full py-1 pl-1 pr-3 ring-1 transition ${winner && hand.status === "complete" ? "bg-gold/25 ring-gold" : active ? "bg-black/80 ring-gold/70" : "bg-black/70 ring-white/10"} ${seat.folded ? "opacity-55" : ""}`}>
        <Avatar index={member?.avatar ?? 0} size={portrait ? 28 : 34} active={active} dimmed={member ? !member.connected && !member.isBot : false} />
        <div className="min-w-0 leading-tight">
          <div className={`max-w-[84px] truncate text-[12px] font-semibold sm:max-w-[110px] sm:text-[13px] ${isMe ? "text-gold-soft" : ""}`}>{isMe ? "You" : member?.name ?? "Player"}</div>
          <div className="text-[11px] tabular-nums text-ivory/75 sm:text-[12px]">{seat.allIn && hand.status !== "complete" ? <span className="font-semibold text-ruby">ALL-IN</span> : seat.stack.toLocaleString()}</div>
        </div>
        {badge && <span className="absolute -right-2 -top-2 rounded-full bg-ink px-1.5 text-[9px] font-bold text-gold ring-1 ring-gold/50">{badge}</span>}
        {member && !member.connected && !member.isBot && <span className="absolute -left-1 -top-2 rounded-full bg-amber-500/90 px-1.5 text-[9px] font-bold text-black">{member.left ? "LEFT" : "OFFLINE"}</span>}
      </div>
      {/* timer / last action / hand name */}
      <div className="mt-1 h-4 text-center text-[11px] leading-4">
        {active && deadline ? (
          <div className="mx-auto mt-1.5 h-1 w-16 overflow-hidden rounded-full bg-white/15">
            <div className={`h-full rounded-full transition-[width] duration-200 ${timeLeft < 8000 ? "bg-ruby" : "bg-gold"}`} style={{ width: `${pct}%` }} />
          </div>
        ) : active ? (
          <span className="text-gold-soft/80">thinking…</span>
        ) : showdownHand && hand.status === "complete" ? (
          <span className={`${portrait ? "inline-block max-w-[112px] leading-tight" : "whitespace-nowrap"} rounded-full px-2 py-0.5 ${winner ? "bg-gold text-[#1b1508] font-semibold" : "bg-black/50 text-ivory/80"}`}>{showdownHand.name}</span>
        ) : last && hand.status !== "complete" ? (
          <span key={hand.seq} className="anim-fade-up rounded-full bg-black/45 px-2 py-0.5 text-ivory/85">{ACTION_LABEL(last)}</span>
        ) : null}
      </div>
    </div>
  );
}

function ActionBar({ hand, send }: { hand: HandView; send: (m: ClientMsg) => void }) {
  const l = hand.legal!;
  const [pending, setPending] = useState<number | null>(null);
  const busy = pending === hand.seq;
  const toCall = l.callAmount;
  const potAfterCall = hand.pot + toCall;
  const clamp = (v: number) => Math.round(Math.max(l.minRaiseTo, Math.min(l.maxRaiseTo, v)));
  const [amount, setAmount] = useState(l.minRaiseTo);
  useEffect(() => setAmount(l.minRaiseTo), [hand.seq, l.minRaiseTo]);
  const act = (a: Action) => {
    if (busy) return;
    setPending(hand.seq);
    send({ t: "action", seq: hand.seq, action: a });
  };
  const betWord = hand.currentBet === 0 ? "Bet" : "Raise to";
  const presets: [string, number][] = [
    ["Min", l.minRaiseTo],
    ["½ Pot", hand.currentBet + potAfterCall / 2],
    ["¾ Pot", hand.currentBet + (potAfterCall * 3) / 4],
    ["Pot", hand.currentBet + potAfterCall],
  ];
  const myHand = handNameFor(hand);
  return (
    <div className="anim-fade-up mx-auto w-full max-w-2xl rounded-2xl bg-coal/95 p-2.5 ring-1 ring-gold/30 shadow-2xl sm:p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-ivory/70">
        <span className="font-semibold text-gold">Your turn</span>
        {myHand && <span>{myHand}</span>}
        <span>To call: <b className="text-ivory">{toCall.toLocaleString()}</b></span>
      </div>
      {l.raise && (
        <div className="mb-2 flex items-center gap-2">
          <div className="flex gap-1">
            {presets.map(([label, v]) => (
              <button key={label} disabled={busy} onClick={() => setAmount(clamp(v))} className="rounded-lg bg-ink px-2 py-1.5 text-[11px] font-semibold text-ivory/80 ring-1 ring-line hover:text-gold hover:ring-gold/50 sm:px-2.5 sm:text-xs">
                {label}
              </button>
            ))}
          </div>
          <input type="range" min={l.minRaiseTo} max={l.maxRaiseTo} step={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="min-w-0 flex-1 accent-[#d8b56a]" aria-label="Raise amount" />
          <input
            type="number"
            value={amount}
            min={l.minRaiseTo}
            max={l.maxRaiseTo}
            onChange={(e) => setAmount(Number(e.target.value))}
            onBlur={() => setAmount(clamp(amount))}
            className="w-20 rounded-lg bg-ink px-2 py-1.5 text-right text-sm tabular-nums ring-1 ring-line outline-none focus:ring-gold/60"
            aria-label="Raise to"
          />
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => act({ type: "fold" })} className="py-3">Fold</Button>
        {l.check ? (
          <Button variant="secondary" disabled={busy} onClick={() => act({ type: "check" })} className="py-3">Check</Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => act({ type: "call" })} className="py-3">
            Call {toCall.toLocaleString()}
          </Button>
        )}
        {l.raise ? (
          <Button disabled={busy || amount < l.minRaiseTo || amount > l.maxRaiseTo} onClick={() => act(amount >= l.maxRaiseTo ? { type: "allin" } : { type: "raise", amount: clamp(amount) })} className="py-3">
            {amount >= l.maxRaiseTo ? "All-in" : `${betWord} ${amount.toLocaleString()}`}
          </Button>
        ) : (
          <Button disabled className="py-3">{betWord}</Button>
        )}
      </div>
    </div>
  );
}

function handNameFor(hand: HandView): string | null {
  const me = hand.seats.find((s) => s.id === hand.you);
  if (!me || me.cards.length !== 2 || me.cards.some((c) => !c)) return null;
  const hole = me.cards as Card[];
  if (hand.board.length >= 3) return describeHand(evaluate([...hole, ...hand.board]));
  if (hole[0].rank === hole[1].rank) return `Pocket ${hole[0].rank}s`;
  return `${hole[0].rank}-${hole[1].rank}${hole[0].suit === hole[1].suit ? " suited" : ""}`;
}

function StatusLine({ room, hand, me, meMember, members }: { room: RoomView; hand: HandView; me?: SeatView; meMember?: PublicMember; members: Record<string, PublicMember> }) {
  let text: string;
  if (meMember?.busted) text = `You're out — finished ${ordinal(meMember.place ?? 0)}. Watching the table.`;
  else if (hand.status === "runout") text = "All-in — running out the board";
  else if (hand.status === "complete") text = hand.result?.payouts[room.you] ? "You win the pot!" : "Hand complete";
  else if (me?.folded) text = "You folded — waiting for the next hand";
  else if (hand.toAct) text = `Waiting for ${members[hand.toAct]?.name ?? "player"}…`;
  else text = "";
  const myHand = me && !me.folded ? handNameFor(hand) : null;
  return (
    <div className="mx-auto flex max-w-2xl items-center justify-center gap-3 rounded-2xl bg-black/35 px-4 py-3 text-sm text-ivory/80">
      <span>{text}</span>
      {myHand && <span className="rounded-full bg-black/40 px-2.5 py-0.5 text-xs text-gold-soft">{myHand}</span>}
    </div>
  );
}

export const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

export function GameOver({ room, send }: { room: RoomView; send: (m: ClientMsg) => void }) {
  const ranked = [...room.members].sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
  const winner = room.members.find((m) => m.id === room.winnerId);
  const isHost = room.hostId === room.you;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-3 backdrop-blur-[3px]">
      <div className="anim-pop max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-coal p-6 ring-1 ring-gold/30 shadow-2xl">
        <div className="text-center">
          <div className="text-xs uppercase tracking-[.35em] text-gold">Game over</div>
          <h2 className="mt-2 font-display text-4xl">{winner?.id === room.you ? "You win the table!" : `${winner?.name ?? "Someone"} wins`}</h2>
          <p className="mt-2 text-sm text-mist">Final standings</p>
        </div>
        <ul className="mt-5 space-y-2">
          {ranked.map((m) => (
            <li key={m.id} className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ring-1 ${m.place === 1 ? "bg-gold/10 ring-gold/40" : "bg-ink/60 ring-line"}`}>
              <span className="w-8 text-center font-display text-lg text-gold">{m.place ? ordinal(m.place) : "–"}</span>
              <Avatar index={m.avatar} size={32} />
              <div className="min-w-0 flex-1 truncate font-semibold">{m.id === room.you ? "You" : m.name}</div>
              <div className="text-right text-sm">
                <div className="tabular-nums">{m.chips.toLocaleString()}</div>
                <div className="text-[11px] text-mist">{m.handsWon} pots won</div>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => { send({ t: "leave" }); window.location.href = "/"; }}>Leave</Button>
          {isHost ? <Button className="flex-1" onClick={() => send({ t: "again" })}>New game</Button> : <div className="flex flex-1 items-center justify-center text-sm text-mist">Waiting for host…</div>}
        </div>
      </div>
    </div>
  );
}
