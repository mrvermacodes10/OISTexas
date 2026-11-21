// Messages and table rules shared by the Cloudflare room server and the browser client.
import type { Action, HandView } from "./holdem";
import type { Difficulty } from "./ai";

export type Mode = "friends" | "ai";
export type Phase = "lobby" | "playing" | "finished";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const STARTING_CHIPS = 1000;
export const HANDS_PER_LEVEL = 10;
export const BLIND_LEVELS: [number, number][] = [
  [10, 20], [15, 30], [25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [300, 600], [500, 1000], [1000, 2000],
];
export const TURN_SECONDS = 30;

export interface PublicMember {
  id: string;
  name: string;
  avatar: number;
  isBot: boolean;
  difficulty?: Difficulty;
  connected: boolean;
  left: boolean;
  chips: number; // virtual chips (between hands)
  busted: boolean;
  place: number | null; // finishing position once eliminated / game over
  handsWon: number;
}

export interface RoomView {
  code: string;
  mode: Mode;
  phase: Phase;
  hostId: string;
  you: string;
  members: PublicMember[];
  hand: HandView | null;
  blinds: { small: number; big: number; level: number; handsToNext: number };
  turnDeadline: number | null; // epoch ms
  nextHandAt: number | null; // epoch ms
  serverNow: number; // for clock-skew correction
  winnerId: string | null;
}

export type ClientMsg =
  | { t: "hello"; token: string; name: string; avatar: number }
  | { t: "start" }
  | { t: "action"; seq: number; action: Action }
  | { t: "again" }
  | { t: "addBot"; difficulty: Difficulty }
  | { t: "removeBot"; id: string }
  | { t: "leave" }
  | { t: "ping" };

export type ServerMsg = { t: "state"; room: RoomView } | { t: "error"; message: string; fatal?: boolean } | { t: "pong" };

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 5;
export const isValidCode = (c: string) => new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(c);
export const AVATAR_COUNT = 12;
