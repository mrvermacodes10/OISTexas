"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createRoom, roomInfo, useProfile } from "@/lib/client";
import { CODE_ALPHABET, CODE_LENGTH, MAX_PLAYERS } from "@/game/protocol";
import type { Difficulty } from "@/game/ai";
import { Avatar, Button, ChipStack, Logo, Modal, Segmented } from "@/components/ui";
import { CardBack, PlayingCard } from "@/components/Card";
import { SettingsDialog } from "@/components/Dialogs";

type Panel = null | "friends" | "ai" | "join" | "settings";

export default function Home() {
  const router = useRouter();
  const { profile, save } = useProfile();
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [bots, setBots] = useState(3);

  const open = (p: Panel) => {
    setErr(null);
    setPanel(p);
  };
  const go = async (fn: () => Promise<string>) => {
    if (!profile) return;
    setBusy(true);
    setErr(null);
    try {
      save({ ...profile, name: (name ?? profile.name).trim() || "Player" });
      router.push(`/room/${await fn()}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  const create = () => go(() => createRoom("friends"));
  const join = () =>
    go(async () => {
      const c = code.trim().toUpperCase();
      if (c.length !== CODE_LENGTH) throw new Error(`Room codes are ${CODE_LENGTH} characters`);
      const info = await roomInfo(c);
      if (!info.exists) throw new Error("No table with that code");
      if (info.mode === "ai") throw new Error("That is a private AI table");
      if (info.phase !== "lobby") throw new Error("That game has already started");
      if (info.full) throw new Error("That table is full");
      return c;
    });

  const nameField = (
    <label className="mb-5 flex items-center gap-3 rounded-xl bg-ink px-3 py-2 ring-1 ring-line focus-within:ring-gold/70">
      {profile && <Avatar index={profile.avatar} size={30} />}
      <span className="text-xs uppercase tracking-widest text-mist">Name</span>
      <input value={name ?? profile?.name ?? ""} maxLength={16} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 bg-transparent py-1 font-semibold outline-none" aria-label="Your name" />
    </label>
  );
  const codeForm = (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); join(); }}>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().split("").filter((ch) => CODE_ALPHABET.includes(ch)).join("").slice(0, CODE_LENGTH))}
        placeholder="ROOM CODE"
        className="min-w-0 flex-1 rounded-xl bg-ink px-4 py-3 text-center font-mono text-xl tracking-[.4em] uppercase ring-1 ring-line outline-none placeholder:text-sm placeholder:tracking-[.3em] focus:ring-gold/70"
        autoCapitalize="characters"
        autoComplete="off"
        autoFocus={panel === "join"}
      />
      <Button type="submit" variant="secondary" disabled={busy || code.length !== CODE_LENGTH}>Join</Button>
    </form>
  );
  const error = err && <p className="mt-4 text-sm text-[#ff8a8a]">{err}</p>;

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden">
      <header className="flex items-center justify-end p-4 sm:p-6">
        <button onClick={() => open("settings")} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/5" aria-label="Profile">
          {profile && <Avatar index={profile.avatar} size={30} />}
          <span className="text-sm text-mist">{profile?.name}</span>
        </button>
      </header>

      <section className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-6 pb-16 md:grid-cols-[1fr_1.1fr]">
        <div className="anim-fade-up">
          <Logo />
          <p className="mt-8 max-w-md text-lg leading-relaxed text-ivory/75">
            No-limit Texas Hold’em at a private table. Invite friends with a room code or take on AI opponents — free, with virtual chips only.
          </p>
          <div className="mt-10 flex max-w-sm flex-col gap-3">
            <Button className="py-4 text-base" onClick={() => open("friends")}>Play with Friends</Button>
            <Button variant="secondary" className="py-4 text-base" onClick={() => open("ai")}>Play Against AI</Button>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="ghost" className="ring-1 ring-line" disabled={busy || !profile} onClick={create}>Create Room</Button>
              <Button variant="ghost" className="ring-1 ring-line" onClick={() => open("join")}>Join Room</Button>
            </div>
            {err && !panel && <p className="text-sm text-[#ff8a8a]">{err}</p>}
          </div>
        </div>

        <div className="relative hidden aspect-[1.55] md:block" aria-hidden>
          <div className="absolute inset-0 rounded-[50%] bg-[#160d08] p-[2%] shadow-[0_40px_90px_rgba(0,0,0,.6)]">
            <div className="felt h-full w-full rounded-[50%] ring-1 ring-gold/25" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center gap-2" style={{ ["--card-w" as string]: "70px" }}>
            {[
              { id: "AS", rank: "A", suit: "S" },
              { id: "KH", rank: "K", suit: "H" },
              { id: "QH", rank: "Q", suit: "H" },
            ].map((c, i) => (
              <div key={c.id} className="float" style={{ animationDelay: `${i * 0.3}s` }}>
                <PlayingCard card={c as never} />
              </div>
            ))}
            <CardBack />
            <CardBack />
          </div>
          <div className="absolute bottom-[20%] left-1/2 -translate-x-1/2"><ChipStack amount={1525} size={22} /></div>
        </div>
      </section>

      <Modal open={panel === "friends"} onClose={() => setPanel(null)} title="Play with Friends">
        {nameField}
        <Button className="w-full py-4" disabled={busy} onClick={create}>Create a private room</Button>
        <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-widest text-mist">
          <div className="h-px flex-1 bg-line" />or join with a code<div className="h-px flex-1 bg-line" />
        </div>
        {codeForm}
        <p className="mt-4 text-xs text-mist">2–{MAX_PLAYERS} players. The host can fill empty seats with AI.</p>
        {error}
      </Modal>

      <Modal open={panel === "join"} onClose={() => setPanel(null)} title="Join Room">
        {nameField}
        {codeForm}
        {error}
      </Modal>

      <Modal open={panel === "ai"} onClose={() => setPanel(null)} title="Play Against AI">
        {nameField}
        <div className="space-y-5">
          <div>
            <span className="mb-2 block text-xs uppercase tracking-widest text-mist">Difficulty</span>
            <Segmented<Difficulty>
              value={difficulty}
              onChange={setDifficulty}
              options={[
                { value: "easy", label: "Easy", hint: "Loose & loose-lipped" },
                { value: "medium", label: "Medium", hint: "Solid & positional" },
                { value: "hard", label: "Hard", hint: "Reads you" },
              ]}
            />
          </div>
          <div>
            <span className="mb-2 block text-xs uppercase tracking-widest text-mist">Opponents</span>
            <Segmented<number> value={bots} onChange={setBots} options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) }))} />
          </div>
          <Button className="w-full py-4" disabled={busy} onClick={() => go(() => createRoom("ai", { bots, difficulty }))}>
            {busy ? "Shuffling…" : "Take a seat"}
          </Button>
          {error}
        </div>
      </Modal>

      {profile && <SettingsDialog open={panel === "settings"} onClose={() => setPanel(null)} profile={profile} save={save} />}
    </main>
  );
}
