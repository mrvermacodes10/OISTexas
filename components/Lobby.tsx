"use client";
import { useState } from "react";
import type { ClientMsg, RoomView } from "@/game/protocol";
import type { Difficulty } from "@/game/ai";
import { MAX_PLAYERS, STARTING_CHIPS } from "@/game/protocol";
import { Avatar, Button, Segmented } from "./ui";

export function Lobby({ room, send }: { room: RoomView; send: (m: ClientMsg) => void }) {
  const isHost = room.hostId === room.you;
  const [copied, setCopied] = useState(false);
  const [diff, setDiff] = useState<Difficulty>("medium");
  const link = typeof window !== "undefined" ? `${window.location.origin}/room/${room.code}` : "";
  const full = room.members.length >= MAX_PLAYERS;

  const share = async () => {
    try {
      if (navigator.share && /Mobi/i.test(navigator.userAgent)) await navigator.share({ title: "Join my OIStexas table", text: `Room code ${room.code}`, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {}
  };

  return (
    <div className="anim-fade-up mx-auto grid w-full max-w-4xl gap-6 px-4 py-6 md:grid-cols-[1fr_1.15fr] md:py-12">
      <div className="felt flex flex-col items-center justify-center rounded-3xl px-6 py-10 text-center">
        <div className="text-xs uppercase tracking-[.35em] text-gold-soft/80">Table code</div>
        <div className="mt-3 font-mono text-5xl font-semibold tracking-[.25em] text-ivory sm:text-6xl">{room.code}</div>
        <p className="mt-4 max-w-xs text-sm text-ivory/70">Friends enter this code under Join Room, or open your invite link. Everyone starts with {STARTING_CHIPS.toLocaleString()} virtual chips.</p>
        <Button variant="secondary" className="mt-6" onClick={share}>
          {copied ? "Link copied ✓" : "Copy invite link"}
        </Button>
      </div>

      <div className="rounded-3xl bg-coal p-5 ring-1 ring-line sm:p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-display text-2xl">Players</h2>
          <span className="text-sm text-mist">{room.members.length} / {MAX_PLAYERS}</span>
        </div>
        <ul className="space-y-2">
          {room.members.map((m) => (
            <li key={m.id} className="anim-fade-up flex items-center gap-3 rounded-2xl bg-ink/60 px-3 py-2.5 ring-1 ring-line">
              <Avatar index={m.avatar} size={38} dimmed={!m.connected} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">
                  {m.name} {m.id === room.you && <span className="text-mist font-normal">(you)</span>}
                </div>
                <div className="text-xs text-mist">
                  {m.isBot ? `AI · ${m.difficulty}` : m.connected ? "Connected" : "Reconnecting…"}
                  {m.id === room.hostId && <span className="ml-2 text-gold">Host</span>}
                </div>
              </div>
              <span className={`h-2.5 w-2.5 rounded-full ${m.connected ? "bg-emerald-400" : "bg-amber-500"}`} />
              {isHost && m.isBot && (
                <button className="px-2 text-mist hover:text-ivory" onClick={() => send({ t: "removeBot", id: m.id })} aria-label={`Remove ${m.name}`}>
                  ✕
                </button>
              )}
            </li>
          ))}
          {room.members.length < 2 && <li className="rounded-2xl border border-dashed border-line px-4 py-4 text-center text-sm text-mist">Waiting for someone to join…</li>}
        </ul>

        {isHost ? (
          <div className="mt-6 space-y-3">
            {!full && (
              <div className="flex gap-2">
                <div className="flex-1">
                  <Segmented<Difficulty> value={diff} onChange={setDiff} options={[{ value: "easy", label: "Easy" }, { value: "medium", label: "Medium" }, { value: "hard", label: "Hard" }]} />
                </div>
                <Button variant="secondary" className="px-4" onClick={() => send({ t: "addBot", difficulty: diff })}>+ AI</Button>
              </div>
            )}
            <Button className="w-full py-4" disabled={room.members.length < 2} onClick={() => send({ t: "start" })}>
              {room.members.length < 2 ? "Need 2+ players" : "Deal cards"}
            </Button>
          </div>
        ) : (
          <p className="mt-6 flex items-center justify-center gap-2 text-sm text-mist">
            <span className="h-2 w-2 animate-pulse rounded-full bg-gold" /> Waiting for the host to start
          </p>
        )}
      </div>
    </div>
  );
}
