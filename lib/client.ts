"use client";
// Browser-side helpers: profile/settings, REST calls and the live room connection.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMsg, Mode, RoomView, ServerMsg } from "@/game/protocol";
import type { Difficulty } from "@/game/ai";

export const WORKER_URL = (process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787").replace(/\/$/, "");

// ---------- profile & settings ----------
export interface Profile {
  name: string;
  avatar: number;
  sound: boolean;
}
const PROFILE_KEY = "oisintexas:profile";

export function loadProfile(): Profile | null {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    return p && typeof p.name === "string" ? { sound: true, avatar: 0, ...p } : null;
  } catch {
    return null;
  }
}
export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    window.dispatchEvent(new Event("oisintexas:profile"));
  } catch {}
}
export function defaultProfile(): Profile {
  return { name: "Player " + (100 + Math.floor(Math.random() * 900)), avatar: Math.floor(Math.random() * 12), sound: true };
}

/** `fresh` is true until the player has saved a profile on this device. */
export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    let fallback: Profile | null = null;
    const sync = () => {
      const p = loadProfile();
      setFresh(!p);
      setProfile(p ?? (fallback ??= defaultProfile()));
    };
    sync();
    window.addEventListener("oisintexas:profile", sync);
    return () => window.removeEventListener("oisintexas:profile", sync);
  }, []);
  return { profile, fresh, save: saveProfile };
}

/** Secret per-room seat token so a refresh or dropped connection reclaims the same seat. */
function seatToken(code: string): string {
  const key = "oisintexas:seat:" + code;
  try {
    let t = localStorage.getItem(key);
    if (!t) {
      t = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      localStorage.setItem(key, t);
    }
    return t;
  } catch {
    return crypto.randomUUID().replace(/-/g, "");
  }
}

// ---------- REST ----------
export async function createRoom(mode: Mode, opts: { bots?: number; difficulty?: Difficulty } = {}): Promise<string> {
  const res = await fetch(`${WORKER_URL}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, ...opts }),
  });
  if (!res.ok) throw new Error("Could not create a room. Is the game server running?");
  return (await res.json()).code;
}

export async function roomInfo(code: string): Promise<{ exists: boolean; phase?: string; full?: boolean; mode?: Mode }> {
  const res = await fetch(`${WORKER_URL}/api/rooms/${encodeURIComponent(code)}`);
  if (res.status === 404 || res.status === 400) return { exists: false };
  if (!res.ok) throw new Error("Server error");
  return res.json();
}

// ---------- live room connection ----------
export type ConnStatus = "connecting" | "open" | "reconnecting" | "closed";

export function useRoom(code: string, profile: Profile | null, enabled: boolean) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  useEffect(() => {
    if (!enabled || !profileRef.current) return;
    let stopped = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout>;
    let ping: ReturnType<typeof setInterval>;
    const token = seatToken(code);

    const connect = () => {
      const ws = new WebSocket(`${WORKER_URL.replace(/^http/, "ws")}/api/rooms/${code}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempts = 0;
        setStatus("open");
        const p = profileRef.current!;
        ws.send(JSON.stringify({ t: "hello", token, name: p.name, avatar: p.avatar } satisfies ClientMsg));
        ping = setInterval(() => ws.readyState === 1 && ws.send('{"t":"ping"}'), 25000);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMsg;
        if (msg.t === "state") setRoom(msg.room);
        else if (msg.t === "error") {
          if (msg.fatal) {
            stopped = true;
            setFatal(msg.message);
          } else setError(msg.message);
        }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (stopped) return setStatus("closed");
        setStatus("reconnecting");
        retry = setTimeout(connect, Math.min(8000, 400 * 2 ** attempts++));
      };
    };
    connect();
    const onVisible = () => {
      if (document.visibilityState === "visible" && wsRef.current?.readyState === WebSocket.CLOSED && !stopped) {
        clearTimeout(retry);
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      document.removeEventListener("visibilitychange", onVisible);
      wsRef.current?.close();
    };
  }, [code, enabled]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2600);
    return () => clearTimeout(t);
  }, [error]);

  const send = useCallback((m: ClientMsg) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  }, []);

  return { room, status, error, fatal, send };
}

// ---------- tiny synthesized sound effects (no assets) ----------
let ctx: AudioContext | null = null;
export function sfx(kind: "chip" | "card" | "turn" | "win", enabled: boolean) {
  if (!enabled || typeof window === "undefined") return;
  try {
    ctx ??= new AudioContext();
    const tones: Record<typeof kind, [number, number, number][]> = {
      chip: [[1400, 0, 0.03], [1700, 0.035, 0.03]],
      card: [[340, 0, 0.05]],
      turn: [[660, 0, 0.09], [880, 0.1, 0.12]],
      win: [[523, 0, 0.12], [659, 0.12, 0.12], [784, 0.24, 0.25]],
    };
    for (const [freq, at, dur] of tones[kind]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = freq;
      const t = ctx.currentTime + at;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  } catch {}
}
