"use client";
import { useEffect, useState } from "react";
import type { Profile } from "@/lib/client";
import { Avatar, AVATAR_TOTAL, Button, Modal } from "./ui";

export function ProfileEditor({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  return (
    <div className="space-y-5">
      <label className="block">
        <span className="mb-2 block text-xs uppercase tracking-widest text-mist">Display name</span>
        <input
          value={profile.name}
          maxLength={16}
          onChange={(e) => onChange({ ...profile, name: e.target.value })}
          className="w-full rounded-xl bg-ink px-4 py-3 text-lg ring-1 ring-line outline-none focus:ring-gold/70"
          placeholder="Your name"
        />
      </label>
      <div>
        <span className="mb-2 block text-xs uppercase tracking-widest text-mist">Avatar</span>
        <div className="grid grid-cols-6 gap-2">
          {Array.from({ length: AVATAR_TOTAL }, (_, i) => (
            <button
              key={i}
              onClick={() => onChange({ ...profile, avatar: i })}
              className={`flex justify-center rounded-xl p-1.5 transition ${profile.avatar === i ? "bg-gold/15 ring-2 ring-gold" : "hover:bg-white/5"}`}
              aria-label={`Avatar ${i + 1}`}
            >
              <Avatar index={i} size={38} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SettingsDialog({ open, onClose, profile, save }: { open: boolean; onClose: () => void; profile: Profile; save: (p: Profile) => void }) {
  const [draft, setDraft] = useState(profile);
  useEffect(() => setDraft(profile), [profile, open]);
  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <ProfileEditor profile={draft} onChange={setDraft} />
      <label className="mt-5 flex items-center justify-between rounded-xl bg-ink px-4 py-3 ring-1 ring-line">
        <span>Sound effects</span>
        <input type="checkbox" checked={draft.sound} onChange={(e) => setDraft({ ...draft, sound: e.target.checked })} className="h-5 w-5 accent-[#d8b56a]" />
      </label>
      <Button
        className="mt-6 w-full"
        onClick={() => {
          save({ ...draft, name: draft.name.trim() || "Player" });
          onClose();
        }}
      >
        Save
      </Button>
    </Modal>
  );
}

const RANKINGS: [string, string, string][] = [
  ["Royal Flush", "A K Q J 10, same suit", "AS KS QS JS 10S"],
  ["Straight Flush", "Five in a row, same suit", "9H 8H 7H 6H 5H"],
  ["Four of a Kind", "Four cards of one rank", "QC QD QH QS 2D"],
  ["Full House", "Three of a kind + a pair", "JS JH JD 4C 4S"],
  ["Flush", "Any five of one suit", "KD 10D 7D 4D 2D"],
  ["Straight", "Five in a row (A can be low: A-2-3-4-5)", "8C 7D 6S 5H 4C"],
  ["Three of a Kind", "Three cards of one rank", "7S 7H 7D KC 2S"],
  ["Two Pair", "Two different pairs", "AS AD 9C 9H 3S"],
  ["Pair", "Two cards of one rank", "10H 10C KS 6D 3C"],
  ["High Card", "Nothing else — highest card plays", "AH JD 8C 5S 2H"],
];

export function RulesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Hand rankings">
      <ol className="max-h-[60dvh] space-y-1.5 overflow-y-auto pr-1">
        {RANKINGS.map(([name, desc, example], i) => (
          <li key={name} className="flex items-center gap-3 rounded-xl bg-ink/60 px-3 py-2 ring-1 ring-line">
            <span className="w-5 text-right text-xs text-mist">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{name}</div>
              <div className="text-xs text-mist">{desc}</div>
            </div>
            <div className="hidden gap-0.5 sm:flex">
              {example.split(" ").map((c) => {
                const suit = c.slice(-1);
                const red = suit === "H" || suit === "D";
                return (
                  <span key={c} className={`rounded bg-ivory px-1 text-[11px] font-semibold ${red ? "text-ruby" : "text-black"}`}>
                    {c.slice(0, -1)}{({ S: "♠", H: "♥", D: "♦", C: "♣" } as Record<string, string>)[suit]}
                  </span>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs leading-relaxed text-mist">
        Your best five cards from your two hole cards and the five community cards. Equal hands split the pot. Blinds rise every 10 hands; last player with chips wins.
      </p>
    </Modal>
  );
}
