"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProfile, useRoom } from "@/lib/client";
import { Button, Logo } from "@/components/ui";
import { ProfileEditor, RulesDialog, SettingsDialog } from "@/components/Dialogs";
import { Lobby } from "@/components/Lobby";
import { GameOver, PokerTable } from "@/components/Table";

export default function RoomPage() {
  const code = String(useParams<{ code: string }>().code || "").toUpperCase();
  const { profile, fresh, save } = useProfile();
  const [ready, setReady] = useState(false);
  const [panel, setPanel] = useState<null | "settings" | "rules">(null);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<typeof profile>(null);

  // Players arriving from an invite link pick a name first; everyone else connects straight away.
  useEffect(() => {
    if (profile && !fresh) setReady(true);
    if (profile && !draft) setDraft(profile);
  }, [profile, fresh, draft]);

  const { room, status, error, fatal, send } = useRoom(code, profile, ready);

  if (profile && draft && !ready) {
    return (
      <Shell code={code}>
        <div className="mx-auto mt-10 w-full max-w-sm rounded-3xl bg-coal p-6 ring-1 ring-line anim-fade-up">
          <h1 className="font-display text-3xl">Join table {code}</h1>
          <p className="mb-6 mt-1 text-sm text-mist">Choose how you’ll appear to other players.</p>
          <ProfileEditor profile={draft} onChange={setDraft} />
          <Button className="mt-6 w-full py-4" onClick={() => { save({ ...draft, name: draft.name.trim() || "Player" }); setReady(true); }}>
            Take a seat
          </Button>
        </div>
      </Shell>
    );
  }

  if (fatal) {
    return (
      <Shell code={code}>
        <div className="mx-auto mt-16 max-w-sm text-center anim-fade-up">
          <div className="text-5xl text-gold">♠</div>
          <h1 className="mt-4 font-display text-3xl">Can’t join this table</h1>
          <p className="mt-2 text-mist">{fatal}</p>
          <Link href="/" className="mt-8 inline-block"><Button>Back to menu</Button></Link>
        </div>
      </Shell>
    );
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/room/${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[radial-gradient(ellipse_at_50%_45%,#18211d_0%,#0d1110_70%)]">
      <header className="flex items-center gap-2 px-3 py-2 sm:px-5 sm:py-3">
        <Link href="/" onClick={() => send({ t: "leave" })} className="rounded-lg p-1 hover:bg-white/5" aria-label="Leave to menu">
          <Logo size="sm" />
        </Link>
        <div className="flex-1" />
        {room && room.mode === "friends" && (
          <button onClick={copyCode} className="rounded-lg bg-black/25 px-3 py-1.5 font-mono text-sm tracking-[.2em] ring-1 ring-white/10 hover:ring-gold/50" title="Copy invite link">
            {copied ? "COPIED" : code}
          </button>
        )}
        {room && room.phase !== "lobby" && room.hand && (
          <span className="rounded-lg bg-black/25 px-2.5 py-1.5 text-xs text-ivory/75 ring-1 ring-white/10">
            <span className="hidden sm:inline">Hand #{room.hand.handNo} · </span>Blinds {room.blinds.small}/{room.blinds.big}
            <span className="hidden text-mist md:inline"> · up in {room.blinds.handsToNext}</span>
          </span>
        )}
        <button onClick={() => setPanel("rules")} className="rounded-lg px-2 py-1.5 text-sm text-ivory/70 hover:text-ivory" aria-label="Hand rankings" title="Hand rankings">?</button>
        <button onClick={() => setPanel("settings")} className="rounded-lg px-2 py-1.5 text-ivory/70 hover:text-ivory" aria-label="Settings">⚙</button>
      </header>

      {status !== "open" && (
        <div className="mx-auto mb-1 rounded-full bg-amber-500/15 px-3 py-1 text-xs text-amber-300 ring-1 ring-amber-500/30">
          {status === "connecting" ? "Connecting to table…" : "Connection lost — reconnecting…"}
        </div>
      )}

      {!room ? (
        <div className="flex flex-1 items-center justify-center text-mist">
          <span className="mr-3 h-2 w-2 animate-pulse rounded-full bg-gold" /> Finding your seat…
        </div>
      ) : room.phase === "lobby" ? (
        <div className="flex-1 overflow-y-auto"><Lobby room={room} send={send} /></div>
      ) : room.hand ? (
        <PokerTable room={room} send={send} sound={profile?.sound ?? true} />
      ) : null}
      {room?.phase === "finished" && <GameOver room={room} send={send} />}

      {error && (
        <div className="anim-fade-up fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-full bg-[#3a1416] px-4 py-2 text-sm text-[#ffb3b3] ring-1 ring-ruby/50">{error}</div>
      )}
      {profile && <SettingsDialog open={panel === "settings"} onClose={() => setPanel(null)} profile={profile} save={save} />}
      <RulesDialog open={panel === "rules"} onClose={() => setPanel(null)} />
    </div>
  );
}

function Shell({ code, children }: { code: string; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh px-4 py-4">
      <Link href="/" aria-label={`Back to menu from ${code}`}><Logo size="sm" /></Link>
      {children}
    </main>
  );
}
