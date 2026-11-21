// OIStexas multiplayer server: Cloudflare Worker + one GameRoom Durable Object per table.
// The Durable Object is the only source of truth; clients send intents and receive redacted views.
import { DurableObject } from "cloudflare:workers";
import { randomInt } from "../game/cards";
import { applyAction, startHand, stepRunout, timeoutAction, viewFor, currentPlayerId, type Action, type HandState } from "../game/holdem";
import { chooseAction, recordStats, type Difficulty, type OppStats } from "../game/ai";
import {
  AVATAR_COUNT, BLIND_LEVELS, CODE_ALPHABET, CODE_LENGTH, HANDS_PER_LEVEL, MAX_PLAYERS, MIN_PLAYERS, STARTING_CHIPS, TURN_SECONDS,
  isValidCode, type ClientMsg, type Mode, type Phase, type PublicMember, type RoomView, type ServerMsg,
} from "../game/protocol";

export interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
  ALLOWED_ORIGINS?: string; // comma-separated origins, or "*"
}

interface Member extends PublicMember {
  token: string; // private seat secret — never broadcast
  disconnectedAt: number | null;
}

interface Room {
  code: string;
  mode: Mode;
  phase: Phase;
  hostId: string | null;
  members: Member[]; // seating order
  hand: HandState | null;
  handNo: number;
  dealerId: string | null;
  turnStartedAt: number;
  nextHandAt: number | null;
  stats: Record<string, OppStats>;
  winnerId: string | null;
  lastActive: number;
}

const DIFFS: Difficulty[] = ["easy", "medium", "hard"];
const BOT_NAMES = ["Ace", "Maverick", "Queenie", "River", "Duke", "Lucky", "Blaze", "Sterling", "Ruby", "Dealer Dan"];
const TURN_MS = TURN_SECONDS * 1000;
const DISCONNECTED_TURN_MS = 10_000; // a disconnected player's turn is auto-played (check/fold) after this
const LEFT_TURN_MS = 600; // players who left the table are folded straight away
const RUNOUT_STEP_MS = 1300; // all-in runouts reveal one street at a time
const RESULT_MS = 4000;
const SHOWDOWN_RESULT_MS = 6000;
const IDLE_CLEANUP_MS = 6 * 60 * 60 * 1000;

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const cleanName = (n: unknown) => (typeof n === "string" ? n : "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 16) || "Player";
/** Bot "thinking" time; varies per decision but is deterministic for a given hand state. */
const botDelay = (d: Difficulty | undefined, seq: number) => (d === "hard" ? 1300 : d === "easy" ? 800 : 1000) + ((seq * 397) % 600);
const PAUSE_AFTER_MS = 60_000; // stop running the table when no human has been connected for a minute

export class GameRoom extends DurableObject<Env> {
  room: Room | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<Room>("room")) ?? null;
    });
  }

  private async save() {
    if (!this.room) return;
    this.room.lastActive = Date.now();
    await this.ctx.storage.put("room", this.room);
    await this.schedule();
  }

  // ---------- HTTP (from the Worker router) ----------
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/init" && req.method === "POST") {
      if (this.room) return new Response("exists", { status: 409 });
      const body = (await req.json()) as { code: string; mode: Mode; bots?: number; difficulty?: Difficulty };
      this.room = { code: body.code, mode: body.mode, phase: "lobby", hostId: null, members: [], hand: null, handNo: 0, dealerId: null, turnStartedAt: 0, nextHandAt: null, stats: {}, winnerId: null, lastActive: Date.now() };
      if (body.mode === "ai") {
        const n = Math.min(Math.max(Math.floor(Number(body.bots)) || 1, 1), MAX_PLAYERS - 1);
        const diff = DIFFS.includes(body.difficulty!) ? body.difficulty! : "medium";
        for (let i = 0; i < n; i++) this.addBot(diff);
      }
      await this.save();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/info") {
      if (!this.room) return Response.json({ exists: false }, { status: 404 });
      const r = this.room;
      return Response.json({ exists: true, mode: r.mode, phase: r.phase, players: r.members.length, full: r.members.length >= MAX_PLAYERS });
    }
    if (url.pathname === "/ws") {
      if (!this.room) return new Response("Table not found", { status: 404 });
      if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]); // hibernation API: idle tables cost nothing
      pair[1].serializeAttachment({ memberId: null });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response("Not found", { status: 404 });
  }

  // ---------- WebSocket ----------
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > 2048 || !this.room) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const room = this.room;
    const att = ws.deserializeAttachment() as { memberId: string | null };

    if (msg.t === "ping") return this.send(ws, { t: "pong" });

    if (msg.t === "hello") {
      if (typeof msg.token !== "string" || msg.token.length < 16 || msg.token.length > 64) return this.fatal(ws, "Invalid session");
      let m = room.members.find((x) => x.token === msg.token);
      if (!m) {
        if (room.phase !== "lobby") return this.fatal(ws, "This game has already started");
        if (room.members.length >= MAX_PLAYERS) return this.fatal(ws, "This table is full");
        if (room.mode === "ai" && room.members.some((x) => !x.isBot)) return this.fatal(ws, "This is a private AI table");
        m = { id: newId(), token: msg.token, name: "", avatar: 0, isBot: false, connected: true, left: false, chips: STARTING_CHIPS, busted: false, place: null, handsWon: 0, disconnectedAt: null };
        room.members.push(m);
      }
      m.name = cleanName(msg.name);
      m.avatar = Number.isInteger(msg.avatar) ? Math.abs(msg.avatar) % AVATAR_COUNT : 0;
      m.connected = true;
      m.left = false;
      m.disconnectedAt = null;
      if (!room.hostId || !room.members.some((x) => x.id === room.hostId)) room.hostId = m.id;
      ws.serializeAttachment({ memberId: m.id });
      if (room.mode === "ai" && room.phase === "lobby") this.startGame(); // AI tables deal immediately
      await this.save();
      return this.broadcast();
    }

    const me = room.members.find((x) => x.id === att?.memberId);
    if (!me) return this.send(ws, { t: "error", message: "Join the table first" });
    const isHost = this.effectiveHost() === me.id;

    switch (msg.t) {
      case "start":
      case "again":
        if (!isHost) return this.send(ws, { t: "error", message: "Only the host can start" });
        if (room.phase === "playing") return this.send(ws, { t: "error", message: "Game already running" });
        if (room.members.filter((x) => !x.left).length < MIN_PLAYERS) return this.send(ws, { t: "error", message: "Need at least 2 players" });
        if (room.phase === "finished") room.members = room.members.filter((x) => !x.left);
        this.startGame();
        break;
      case "action": {
        const h = room.hand;
        if (room.phase !== "playing" || !h || h.status !== "betting") return this.send(ws, { t: "error", message: "Not accepting actions right now" });
        if (msg.seq !== h.seq) {
          this.send(ws, { t: "error", message: "That action is out of date" });
          return this.broadcast();
        }
        const err = this.act(me.id, msg.action);
        if (err) {
          this.send(ws, { t: "error", message: err });
          return this.broadcast();
        }
        break;
      }
      case "addBot":
        if (!isHost || room.phase !== "lobby") return;
        if (room.members.length >= MAX_PLAYERS) return this.send(ws, { t: "error", message: "Table is full" });
        this.addBot(DIFFS.includes(msg.difficulty) ? msg.difficulty : "medium");
        break;
      case "removeBot":
        if (!isHost || room.phase !== "lobby") return;
        room.members = room.members.filter((x) => !(x.isBot && x.id === msg.id));
        break;
      case "leave":
        if (room.phase === "lobby") {
          room.members = room.members.filter((x) => x.id !== me.id);
          if (room.hostId === me.id) room.hostId = room.members.find((x) => !x.isBot)?.id ?? null;
        } else {
          me.left = true; // keeps their seat; their hands are folded automatically
          me.connected = false;
          me.disconnectedAt = Date.now();
        }
        ws.close(1000, "left");
        break;
      default:
        return;
    }
    await this.save();
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket) {
    await this.onSocketGone(ws);
  }
  async webSocketError(ws: WebSocket) {
    await this.onSocketGone(ws);
  }

  private async onSocketGone(ws: WebSocket) {
    const att = ws.deserializeAttachment() as { memberId: string | null } | null;
    if (!this.room || !att?.memberId) return;
    const others = this.ctx.getWebSockets().some((s) => s !== ws && (s.deserializeAttachment() as { memberId: string | null } | null)?.memberId === att.memberId);
    const m = this.room.members.find((x) => x.id === att.memberId);
    if (m && !others && m.connected) {
      m.connected = false;
      m.disconnectedAt = Date.now();
      await this.save();
      this.broadcast();
    }
  }

  // ---------- table flow ----------
  private effectiveHost(): string | null {
    const r = this.room!;
    const host = r.members.find((m) => m.id === r.hostId);
    if (host?.connected) return host.id;
    return r.members.find((m) => !m.isBot && m.connected)?.id ?? r.hostId;
  }

  private addBot(difficulty: Difficulty) {
    const r = this.room!;
    const used = new Set(r.members.map((m) => m.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? "Bot " + (r.members.length + 1);
    r.members.push({ id: newId(), token: newId() + newId(), name, avatar: randomInt(AVATAR_COUNT), isBot: true, difficulty, connected: true, left: false, chips: STARTING_CHIPS, busted: false, place: null, handsWon: 0, disconnectedAt: null });
  }

  private blinds() {
    const level = Math.min(BLIND_LEVELS.length - 1, Math.floor(Math.max(0, this.room!.handNo - 1) / HANDS_PER_LEVEL));
    const [small, big] = BLIND_LEVELS[level];
    return { small, big, level: level + 1, handsToNext: HANDS_PER_LEVEL - (Math.max(0, this.room!.handNo - 1) % HANDS_PER_LEVEL) };
  }

  private startGame() {
    const r = this.room!;
    for (const m of r.members) Object.assign(m, { chips: STARTING_CHIPS, busted: false, place: null, handsWon: 0 });
    r.phase = "playing";
    r.handNo = 0;
    r.winnerId = null;
    r.stats = {};
    r.dealerId = r.members[randomInt(r.members.length)].id;
    r.dealerId = this.previousSeated(r.dealerId); // so the first rotation lands on the random pick
    this.dealNextHand();
  }

  /** Seated (non-busted) member before `id` in seating order — used to seed the button. */
  private previousSeated(id: string): string {
    const ms = this.room!.members;
    const i = ms.findIndex((m) => m.id === id);
    for (let k = 1; k <= ms.length; k++) {
      const m = ms[(i - k + ms.length) % ms.length];
      if (!m.busted) return m.id;
    }
    return id;
  }

  private dealNextHand() {
    const r = this.room!;
    const seated = r.members.filter((m) => !m.busted && m.chips > 0);
    const humansAlive = seated.some((m) => !m.isBot);
    if (seated.length < 2 || (r.mode === "ai" && !humansAlive)) return this.endGame();
    // Move the button to the next seated player after the previous button.
    const ms = r.members;
    const prev = Math.max(0, ms.findIndex((m) => m.id === r.dealerId));
    let dealer = seated[0].id;
    for (let k = 1; k <= ms.length; k++) {
      const m = ms[(prev + k) % ms.length];
      if (!m.busted && m.chips > 0) {
        dealer = m.id;
        break;
      }
    }
    r.dealerId = dealer;
    r.handNo++;
    const b = this.blinds();
    r.hand = startHand(seated.map((m) => ({ id: m.id, stack: m.chips })), dealer, { small: b.small, big: b.big }, r.handNo);
    r.nextHandAt = null;
    r.turnStartedAt = Date.now();
    if (r.hand.status === "complete") this.onHandComplete();
  }

  private endGame() {
    const r = this.room!;
    r.phase = "finished";
    const ranked = [...r.members].sort((a, b) => b.chips - a.chips);
    r.winnerId = ranked[0]?.id ?? null;
    let place = 1;
    for (const m of ranked) if (!m.busted || m.place === null) m.place = place++;
    r.nextHandAt = null;
  }

  /** Validates and applies a betting action. Returns an error or null. */
  private act(memberId: string, action: Action): string | null {
    const r = this.room!;
    const res = applyAction(r.hand!, memberId, action);
    if (!res.ok) return res.error;
    r.hand = res.state;
    r.turnStartedAt = Date.now();
    if (r.hand.status === "complete") this.onHandComplete();
    return null;
  }

  private onHandComplete() {
    const r = this.room!;
    const h = r.hand!;
    recordStats(r.stats, h.players.map((p) => p.id), h.log);
    const aliveBefore = r.members.filter((m) => !m.busted).length;
    for (const p of h.players) {
      const m = r.members.find((x) => x.id === p.id)!;
      m.chips = p.stack;
      if (h.result!.pots.some((pot) => pot.winners.includes(p.id) && pot.eligible.length > 1)) m.handsWon++;
      else if (!h.result!.showdown && h.result!.payouts[p.id] > 0) m.handsWon++;
    }
    // Eliminate busted players; players busted in the same hand share the finishing place.
    const newlyBusted = r.members.filter((m) => !m.busted && m.chips <= 0);
    for (const m of newlyBusted) {
      m.busted = true;
      m.place = aliveBefore - newlyBusted.length + 1;
    }
    r.nextHandAt = Date.now() + (h.result!.showdown ? SHOWDOWN_RESULT_MS : RESULT_MS);
  }

  /** A single alarm drives bots, turn clocks, all-in runouts, the next deal, and cleanup. */
  private nextEventAt(): number {
    const r = this.room!;
    let at = r.lastActive + IDLE_CLEANUP_MS;
    if (r.phase !== "playing" || !r.hand) return at;
    // Pause the table (no bot moves, no requests) once every human has been away for a while.
    const humans = r.members.filter((m) => !m.isBot);
    if (humans.every((m) => !m.connected) && Date.now() - Math.max(0, ...humans.map((m) => m.disconnectedAt ?? 0)) > PAUSE_AFTER_MS) return at;
    const h = r.hand;
    if (h.status === "complete") return r.nextHandAt ?? Date.now();
    if (h.status === "runout") return r.turnStartedAt + RUNOUT_STEP_MS;
    const cur = r.members.find((m) => m.id === currentPlayerId(h))!;
    if (cur.isBot) return r.turnStartedAt + botDelay(cur.difficulty, h.seq);
    if (cur.left) return r.turnStartedAt + LEFT_TURN_MS;
    const deadline = r.turnStartedAt + TURN_MS;
    if (!cur.connected) return Math.min(deadline, Math.max(r.turnStartedAt, cur.disconnectedAt ?? 0) + DISCONNECTED_TURN_MS);
    return deadline;
  }

  private async schedule() {
    if (!this.room) return;
    await this.ctx.storage.setAlarm(Math.max(this.nextEventAt(), Date.now() + 50));
  }

  async alarm() {
    const r = this.room;
    if (!r) return;
    const now = Date.now();
    if (r.phase === "playing" && r.hand && now >= this.nextEventAt() - 40) {
      const h = r.hand;
      if (h.status === "complete") this.dealNextHand();
      else if (h.status === "runout") {
        r.hand = stepRunout(h);
        r.turnStartedAt = now;
        if (r.hand.status === "complete") this.onHandComplete();
      } else {
        const cur = r.members.find((m) => m.id === currentPlayerId(h))!;
        const action = cur.isBot ? chooseAction(viewFor(h, cur.id), cur.difficulty ?? "medium", r.stats) : timeoutAction(h, cur.id);
        const err = this.act(cur.id, action);
        if (err) this.act(cur.id, timeoutAction(h, cur.id)); // never stall the table
      }
      await this.save();
      this.broadcast();
      return;
    }
    if (this.ctx.getWebSockets().length === 0 && now - r.lastActive >= IDLE_CLEANUP_MS - 1000) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    await this.schedule();
  }

  // ---------- output ----------
  private viewFor(memberId: string): RoomView {
    const r = this.room!;
    const h = r.hand;
    let turnDeadline: number | null = null;
    if (r.phase === "playing" && h?.status === "betting") {
      const cur = r.members.find((m) => m.id === currentPlayerId(h));
      if (cur && !cur.isBot) turnDeadline = this.nextEventAt();
    }
    return {
      code: r.code,
      mode: r.mode,
      phase: r.phase,
      hostId: this.effectiveHost() ?? "",
      you: memberId,
      members: r.members.map(({ token, disconnectedAt, ...pub }) => pub),
      hand: h ? viewFor(h, memberId) : null,
      blinds: this.blinds(),
      turnDeadline,
      nextHandAt: r.phase === "playing" && h?.status === "complete" ? r.nextHandAt : null,
      serverNow: Date.now(),
      winnerId: r.winnerId,
    };
  }

  private broadcast() {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as { memberId: string | null } | null;
      if (att?.memberId) this.send(ws, { t: "state", room: this.viewFor(att.memberId) });
    }
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }

  private fatal(ws: WebSocket, message: string) {
    this.send(ws, { t: "error", message, fatal: true });
    ws.close(4000, message.slice(0, 100));
  }
}

// ---------- Worker router ----------
function allowedOrigins(env: Env) {
  return (env.ALLOWED_ORIGINS ?? "*").split(",").map((s) => s.trim());
}
function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = allowedOrigins(env);
  const ok = allowed.includes("*") || allowed.includes(origin);
  return { "Access-Control-Allow-Origin": ok ? origin || "*" : allowed[0], "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" };
}
function newCode() {
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const headers = cors(req, env);
    if (req.method === "OPTIONS") return new Response(null, { headers });
    const json = (data: unknown, status = 200) => Response.json(data, { status, headers });

    if (url.pathname === "/api/health") return json({ ok: true });

    if (url.pathname === "/api/rooms" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { mode?: Mode; bots?: number; difficulty?: Difficulty };
      const mode: Mode = body.mode === "ai" ? "ai" : "friends";
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.fetch("https://room/init", { method: "POST", body: JSON.stringify({ code, mode, bots: body.bots, difficulty: body.difficulty }) });
        if (res.status === 200) return json({ code });
      }
      return json({ error: "Could not allocate a room code" }, 500);
    }

    const m = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)(\/ws)?$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!isValidCode(code)) return json({ error: "Invalid room code" }, 400);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      if (m[2]) {
        const origin = req.headers.get("Origin");
        const allowed = allowedOrigins(env);
        if (origin && !allowed.includes("*") && !allowed.includes(origin)) return new Response("Forbidden origin", { status: 403 });
        return stub.fetch(new Request("https://room/ws", req));
      }
      const res = await stub.fetch("https://room/info");
      return new Response(res.body, { status: res.status, headers: { ...headers, "Content-Type": "application/json" } });
    }
    return json({ error: "Not found" }, 404);
  },
};
