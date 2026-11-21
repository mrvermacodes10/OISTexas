import type { Card as CardT, Suit } from "@/game/cards";

export const SUIT_GLYPH: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const SUIT_NAME: Record<Suit, string> = { S: "Spades", H: "Hearts", D: "Diamonds", C: "Clubs" };
export const isRed = (s: Suit) => s === "H" || s === "D";
export const cardLabel = (c: CardT) => `${c.rank}${SUIT_GLYPH[c.suit]}`;

// Pip layouts (x%, y%) for number cards, as on a real deck.
const PIPS: Record<string, [number, number][]> = {
  "2": [[50, 18], [50, 82]],
  "3": [[50, 18], [50, 50], [50, 82]],
  "4": [[30, 18], [70, 18], [30, 82], [70, 82]],
  "5": [[30, 18], [70, 18], [50, 50], [30, 82], [70, 82]],
  "6": [[30, 18], [70, 18], [30, 50], [70, 50], [30, 82], [70, 82]],
  "7": [[30, 18], [70, 18], [50, 34], [30, 50], [70, 50], [30, 82], [70, 82]],
  "8": [[30, 18], [70, 18], [50, 34], [30, 50], [70, 50], [50, 66], [30, 82], [70, 82]],
  "9": [[30, 16], [70, 16], [30, 39], [70, 39], [50, 50], [30, 61], [70, 61], [30, 84], [70, 84]],
  "10": [[30, 16], [70, 16], [50, 28], [30, 39], [70, 39], [30, 61], [70, 61], [50, 72], [30, 84], [70, 84]],
};
const FACE_TITLE: Record<string, string> = { J: "Jack", Q: "Queen", K: "King" };
const FACE_MARK: Record<string, string> = { J: "⚜", Q: "♛", K: "♚" };

export function PlayingCard({ card, className = "", dim = false, glow = false }: { card: CardT; className?: string; dim?: boolean; glow?: boolean }) {
  const red = isRed(card.suit);
  const g = SUIT_GLYPH[card.suit];
  const face = card.rank === "J" || card.rank === "Q" || card.rank === "K";
  const ink = red ? "text-ruby" : "text-[#16191a]";
  return (
    <div
      className={`card relative select-none overflow-hidden bg-ivory ${ink} ring-1 ring-black/15 shadow-[0_1px_0_rgba(0,0,0,.18),0_6px_16px_rgba(0,0,0,.4)] transition ${dim ? "brightness-[.55] saturate-50" : ""} ${glow ? "ring-2 ring-gold shadow-[0_0_0_3px_rgba(216,181,106,.35),0_10px_24px_rgba(0,0,0,.45)]" : ""} ${className}`}
      aria-label={`${card.rank} of ${SUIT_NAME[card.suit]}`}
    >
      <Corner rank={card.rank} glyph={g} />
      <Corner rank={card.rank} glyph={g} flip />
      <div className="absolute inset-[15%_17%]">
        {card.rank === "A" ? (
          <div className="flex h-full items-center justify-center">
            <span className="leading-none" style={{ fontSize: `calc(var(--card-w) * ${card.suit === "S" ? 0.5 : 0.38})` }}>{g}</span>
          </div>
        ) : face ? (
          <div className="flex h-full flex-col items-center justify-between rounded-[5%] border border-current/30 bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgba(176,138,60,.13)_4px_5px)] py-[8%]">
            <span className="text-[#a8822f] leading-none" style={{ fontSize: "calc(var(--card-w) * .15)" }}>{FACE_MARK[card.rank]}</span>
            <span className="font-display italic leading-none" style={{ fontSize: "calc(var(--card-w) * .38)" }}>{card.rank}</span>
            <span className="leading-none" style={{ fontSize: "calc(var(--card-w) * .15)" }}>{g}</span>
            <span className="sr-only">{FACE_TITLE[card.rank]}</span>
          </div>
        ) : (
          <div className="relative h-full">
            {PIPS[card.rank].map(([x, y], i) => (
              <span key={i} className="absolute leading-none" style={{ left: `${x}%`, top: `${y}%`, fontSize: "calc(var(--card-w) * .17)", transform: `translate(-50%,-50%) ${y > 55 ? "rotate(180deg)" : ""}` }}>
                {g}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Corner({ rank, glyph, flip }: { rank: string; glyph: string; flip?: boolean }) {
  return (
    <div className={`absolute flex flex-col items-center font-semibold leading-[.92] ${flip ? "right-[5%] bottom-[4%] rotate-180" : "left-[5%] top-[4%]"}`} style={{ fontSize: "calc(var(--card-w) * .17)" }}>
      <span className={rank === "10" ? "tracking-[-.1em]" : ""}>{rank}</span>
      <span style={{ fontSize: "calc(var(--card-w) * .15)" }}>{glyph}</span>
    </div>
  );
}

export function CardBack({ className = "" }: { className?: string }) {
  return (
    <div className={`card relative overflow-hidden bg-[#5b1220] p-[7%] ring-1 ring-black/40 shadow-[0_1px_0_rgba(0,0,0,.25),0_5px_12px_rgba(0,0,0,.4)] ${className}`}>
      <div
        className="flex h-full w-full items-center justify-center rounded-[6%] border border-gold/55"
        style={{
          backgroundColor: "#4a0f1b",
          backgroundImage: "repeating-linear-gradient(45deg, rgba(216,181,106,.2) 0 1px, transparent 1px 6px), repeating-linear-gradient(-45deg, rgba(216,181,106,.2) 0 1px, transparent 1px 6px)",
        }}
      >
        <span className="rounded-full border border-gold/70 bg-[#4a0f1b] px-[10%] py-[4%] font-display text-gold leading-none" style={{ fontSize: "calc(var(--card-w) * .2)" }}>
          ♠
        </span>
      </div>
    </div>
  );
}

/** Empty board slot. */
export function CardSlot() {
  return <div className="card rounded-[9%] border border-dashed border-white/12 bg-black/10" />;
}
