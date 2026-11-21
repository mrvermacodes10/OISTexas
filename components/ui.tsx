"use client";
import type { ReactNode } from "react";

const AVATARS: { bg: string; fg: string; glyph: string }[] = [
  { bg: "#d8b56a", fg: "#1a1508", glyph: "♠" },
  { bg: "#c2353b", fg: "#fff3ef", glyph: "♥" },
  { bg: "#3a7bd5", fg: "#eef5ff", glyph: "♦" },
  { bg: "#2f9e6e", fg: "#effff7", glyph: "♣" },
  { bg: "#8e5bd8", fg: "#f6efff", glyph: "★" },
  { bg: "#e07b39", fg: "#fff4ec", glyph: "◆" },
  { bg: "#1fb5b0", fg: "#ecfffe", glyph: "●" },
  { bg: "#d64f8c", fg: "#fff0f6", glyph: "♛" },
  { bg: "#6d7b74", fg: "#f3f6f4", glyph: "♜" },
  { bg: "#b9c84a", fg: "#1a1d08", glyph: "▲" },
  { bg: "#e9d3a0", fg: "#2a2110", glyph: "♚" },
  { bg: "#4b5fd1", fg: "#eff1ff", glyph: "✦" },
];

export function Avatar({ index, size = 44, active, dimmed, label }: { index: number; size?: number; active?: boolean; dimmed?: boolean; label?: string }) {
  const a = AVATARS[index % AVATARS.length];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={label}>
      {active && <div className="turn-ring" />}
      <div
        className={`flex h-full w-full items-center justify-center rounded-full font-semibold ring-2 ring-black/30 transition ${dimmed ? "opacity-40 grayscale" : ""}`}
        style={{ background: a.bg, color: a.fg, fontSize: size * 0.46 }}
      >
        {a.glyph}
      </div>
    </div>
  );
}
export const AVATAR_TOTAL = AVATARS.length;

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const styles = {
    primary: "bg-gold text-[#1b1508] hover:bg-gold-soft shadow-[0_1px_0_rgba(255,255,255,.35)_inset,0_8px_24px_rgba(216,181,106,.18)]",
    secondary: "bg-coal-2 text-ivory ring-1 ring-line hover:ring-gold/60 hover:bg-[#222b28]",
    ghost: "text-mist hover:text-ivory hover:bg-white/5",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-[15px] font-semibold tracking-wide transition active:scale-[.98] disabled:opacity-40 disabled:active:scale-100 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose?: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="anim-fade-up w-full max-w-md rounded-2xl bg-coal p-6 ring-1 ring-line shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-2xl">{title}</h2>
          {onClose && (
            <button onClick={onClose} className="rounded-lg px-2 py-1 text-mist hover:text-ivory" aria-label="Close">
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Logo({ size = "lg" }: { size?: "lg" | "sm" }) {
  const big = size === "lg";
  return (
    <div className="flex items-center gap-3 select-none">
      <div className={`relative flex shrink-0 items-center justify-center rounded-full bg-[#5b1220] ring-2 ring-gold/80 ${big ? "h-14 w-14" : "h-8 w-8"}`}>
        <div className="absolute inset-[3px] rounded-full border-2 border-dashed border-ivory/70" />
        <span className={`relative text-ivory ${big ? "text-2xl" : "text-sm"}`}>♠</span>
      </div>
      <div className="leading-none">
        <div className={`font-display tracking-tight ${big ? "text-5xl sm:text-6xl" : "text-[22px]"}`}>
          OIS<span className="text-gold">texas</span>
        </div>
        {big && <div className="mt-2 text-[11px] uppercase tracking-[.35em] text-mist">Texas Hold’em · Virtual chips only</div>}
      </div>
    </div>
  );
}

/** A poker chip; colour follows denomination. */
export function Chip({ amount = 25, size = 18 }: { amount?: number; size?: number }) {
  const c = amount >= 1000 ? "#d8b56a" : amount >= 500 ? "#7b4bc4" : amount >= 100 ? "#1c1f1e" : amount >= 25 ? "#2f8f5b" : amount >= 5 ? "#c2353b" : "#e9e4d8";
  const light = c === "#e9e4d8" || c === "#d8b56a";
  return (
    <span
      className="relative inline-block shrink-0 rounded-full shadow-[0_1px_0_rgba(0,0,0,.5)]"
      style={{ width: size, height: size, background: c, boxShadow: `inset 0 0 0 ${Math.max(2, size * 0.14)}px ${c}, inset 0 0 0 ${Math.max(3, size * 0.24)}px ${light ? "#5b1220" : "#f2ecdf"}` }}
    >
      <span className="absolute inset-[28%] rounded-full" style={{ background: c, boxShadow: `0 0 0 1px ${light ? "rgba(0,0,0,.25)" : "rgba(255,255,255,.35)"}` }} />
    </span>
  );
}

/** Stack of chips with an amount label. */
export function ChipStack({ amount, size = 16, label = true }: { amount: number; size?: number; label?: boolean }) {
  const denoms = [1000, 500, 100, 25, 5, 1];
  const chips: number[] = [];
  let left = amount;
  for (const d of denoms) while (left >= d && chips.length < 5) {
    chips.push(d);
    left -= d;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative inline-block" style={{ width: size, height: size + (chips.length - 1) * 3 }}>
        {chips.map((d, i) => (
          <span key={i} className="absolute left-0" style={{ bottom: i * 3 }}>
            <Chip amount={d} size={size} />
          </span>
        ))}
      </span>
      {label && <span className="font-semibold tabular-nums">{amount.toLocaleString()}</span>}
    </span>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="grid gap-1 rounded-xl bg-ink p-1 ring-1 ring-line" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-2 py-2 text-sm font-semibold transition ${value === o.value ? "bg-coal-2 text-gold ring-1 ring-gold/40" : "text-mist hover:text-ivory"}`}
        >
          {o.label}
          {o.hint && <div className="text-[10px] font-normal text-mist">{o.hint}</div>}
        </button>
      ))}
    </div>
  );
}
