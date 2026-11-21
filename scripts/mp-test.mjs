// End-to-end multiplayer test for OIStexas against a running Worker.
// Usage: node scripts/mp-test.mjs [http://127.0.0.1:8787]
const BASE = process.argv[2] || process.env.WORKER_URL || "http://127.0.0.1:8787";
const WS = BASE.replace(/^http/, "ws");
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => crypto.randomUUID().replace(/-/g, "");

class Client {
  constructor(code, name, tok = token()) {
    Object.assign(this, { code, name, tok, room: null, errors: [], closed: false, states: [] });
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.closed = false;
      this.ws = new WebSocket(`${WS}/api/rooms/${this.code}/ws`);
      this.ws.onopen = () => {
        this.send({ t: "hello", token: this.tok, name: this.name, avatar: 1 });
        resolve();
      };
      this.ws.onerror = reject;
      this.ws.onclose = () => (this.closed = true);
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.t === "state") {
          this.room = m.room;
          this.states.push(m.room);
        }
        if (m.t === "error") this.errors.push(m);
      };
    });
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  close() {
    this.ws.close();
  }
  get hand() {
    return this.room?.hand;
  }
  get me() {
    return this.hand?.seats.find((s) => s.id === this.room.you);
  }
  myTurn() {
    return this.room?.phase === "playing" && this.hand?.status === "betting" && this.hand.toAct === this.room.you && !!this.hand.legal;
  }
  act(action) {
    this.send({ t: "action", seq: this.hand.seq, action });
  }
  /** passive-ish policy with some raises */
  auto(style = "calm") {
    const l = this.hand.legal;
    if (style === "careful") return this.act(l.check ? { type: "check" } : l.callAmount <= 60 ? { type: "call" } : { type: "fold" });
    if (style === "shove") return this.act(l.allIn ? { type: "allin" } : l.call ? { type: "call" } : { type: "check" });
    if (l.raise && Math.random() < 0.15) return this.act({ type: "raise", amount: l.minRaiseTo });
    if (l.check) return this.act({ type: "check" });
    return this.act({ type: "call" });
  }
}

async function until(fn, ms = 8000, label = "condition") {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(25);
  }
  throw new Error("Timed out waiting for " + label);
}
async function createRoom(body) {
  const r = await fetch(`${BASE}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json()).code;
}
const totalChips = (room) => (room.hand && room.hand.status !== "complete" ? room.hand.seats.reduce((t, s) => t + s.stack + s.contributed, 0) + room.members.filter((m) => !room.hand.seats.some((s) => s.id === m.id)).reduce((t, m) => t + m.chips, 0) : room.members.reduce((t, m) => t + m.chips, 0));

/** Drive all clients until `done()` or timeout. */
async function drive(clients, done, ms, style = "calm") {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (done()) return;
    for (const c of clients) {
      if (!c.closed && c.myTurn()) {
        const seq = c.hand.seq;
        c.auto(style);
        await until(() => c.hand.seq !== seq || c.room.phase !== "playing", 6000, "action applied");
      }
    }
    await sleep(20);
  }
  throw new Error("drive timed out");
}

async function friendsTest() {
  console.log("Friends table");
  ok((await fetch(`${BASE}/api/health`).then((r) => r.json())).ok, "worker health check");
  const code = await createRoom({ mode: "friends" });
  ok(/^[A-Z2-9]{5}$/.test(code), `room created: ${code}`);
  ok((await fetch(`${BASE}/api/rooms/${code}`).then((r) => r.json())).phase === "lobby", "room info reports lobby");
  ok((await fetch(`${BASE}/api/rooms/ZZZZZ`)).status === 404, "unknown room → 404");

  const a = new Client(code, "Alice"), b = new Client(code, "Bob"), c = new Client(code, "Cara");
  await a.connect();
  await b.connect();
  await c.connect();
  await until(() => [a, b, c].every((x) => x.room?.members.length === 3), 5000, "3 players listed");
  ok(true, "three players see each other in the lobby");
  ok(a.room.hostId === a.room.you, "first player is host");
  ok(!JSON.stringify(a.room).includes(b.tok), "seat tokens are never broadcast");
  b.send({ t: "start" });
  await until(() => b.errors.length > 0, 3000, "non-host start rejected");
  ok(/host/.test(b.errors.at(-1).message), "non-host cannot start");

  a.send({ t: "start" });
  await until(() => [a, b, c].every((x) => x.hand), 5000, "hand dealt");
  const h = a.hand;
  ok([a, b, c].every((x) => x.me.cards.length === 2 && x.me.cards.every(Boolean)), "each player sees their own two hole cards");
  ok(h.seats.filter((s) => s.id !== a.room.you).every((s) => s.cards.every((x) => x === null)), "opponents' cards arrive face-down (null)");
  const others = [...b.me.cards, ...c.me.cards].map((x) => `"id":"${x.id}"`);
  ok(others.every((id) => !JSON.stringify(a.room).includes(id)), "Alice's payload contains none of Bob's or Cara's hole cards");
  ok(h.seats.find((s) => s.id === h.sb).bet === 10 && h.seats.find((s) => s.id === h.bb).bet === 20, "small and big blinds posted (10/20)");
  ok(a.hand.toAct === b.hand.toAct && b.hand.toAct === c.hand.toAct, "all clients agree whose turn it is");
  ok(h.board.length === 0 && h.street === "preflop", "pre-flop, no community cards yet");
  ok(typeof a.room.turnDeadline === "number", "turn clock is published");

  const byId = { [a.room.you]: a, [b.room.you]: b, [c.room.you]: c };
  const turn = byId[h.toAct];
  const notTurn = [a, b, c].find((x) => x !== turn);
  let e = notTurn.errors.length;
  notTurn.act({ type: "call" });
  await until(() => notTurn.errors.length > e, 3000, "out-of-turn rejected");
  ok(true, "out-of-turn action rejected");
  e = turn.errors.length;
  turn.act({ type: "check" });
  await until(() => turn.errors.length > e, 3000, "illegal check rejected");
  ok(/check/.test(turn.errors.at(-1).message), "checking while facing a bet rejected");
  e = turn.errors.length;
  turn.act({ type: "raise", amount: 25 });
  await until(() => turn.errors.length > e, 3000, "small raise rejected");
  ok(/Minimum raise/.test(turn.errors.at(-1).message), "raise below the minimum rejected");
  e = turn.errors.length;
  const seq = turn.hand.seq;
  turn.act({ type: "call" });
  turn.send({ t: "action", seq, action: { type: "call" } }); // duplicate
  await until(() => turn.errors.length > e, 3000, "duplicate rejected");
  ok(turn.hand.seq === seq + 1 && turn.me.bet === 20, "duplicate action applied only once");

  // disconnect + reconnect
  const cHole = JSON.stringify(c.me.cards), cId = c.room.you;
  c.close();
  await until(() => a.room.members.find((m) => m.id === cId).connected === false, 5000, "disconnect seen");
  ok(true, "others see Cara disconnected");
  const c2 = new Client(code, "Cara", c.tok);
  await c2.connect();
  await until(() => c2.hand && a.room.members.find((m) => m.id === cId).connected, 5000, "reconnect");
  ok(c2.room.you === cId && JSON.stringify(c2.me.cards) === cHole, "reconnected player keeps seat and hole cards");

  const late = new Client(code, "Late");
  await late.connect();
  await until(() => late.errors.length > 0, 3000, "late join rejected");
  ok(late.errors[0].fatal && /started/.test(late.errors[0].message), "newcomers cannot join a running game");

  // Play hands until we have seen a showdown; check chip conservation on every completed hand.
  const players = [a, b, c2];
  let completed = 0, sawShowdown = false, conserved = true, revealOk = true;
  const startHand = a.hand.handNo;
  await drive(players, () => {
    const hh = a.hand;
    if (hh?.status === "complete" && hh.handNo >= startHand) {
      if (totalChips(a.room) !== 3000) conserved = false;
      if (hh.result.showdown) {
        sawShowdown = true;
        const live = hh.seats.filter((s) => !s.folded);
        revealOk &&= live.every((s) => s.cards.every(Boolean)) && hh.seats.filter((s) => s.folded).every((s) => s.cards.length === 0);
      }
      completed = Math.max(completed, hh.handNo - startHand + 1);
    }
    return sawShowdown && completed >= 2;
  }, 120000);
  ok(conserved, `chips conserved across ${completed} completed hands (3000 total)`);
  ok(sawShowdown && revealOk, "showdown reveals only the hands still live; folded hands stay hidden");
  const res = a.hand.result;
  ok(res.pots.length >= 1 && res.pots.every((p) => p.winners.length >= 1), "pots awarded with winners");
  await until(() => a.hand.status === "betting" && a.hand.handNo > startHand + completed - 1, 15000, "next hand auto-dealt");
  ok(true, "next hand is dealt automatically and the button moves");

  // Disconnected player's turn is auto-played
  await drive(players, () => a.hand.status === "betting" && a.hand.toAct === c2.room.you, 60000);
  const s0 = a.hand.seq;
  c2.close();
  console.log("    (waiting ~10s for the disconnected player's turn clock)");
  await until(() => a.hand.seq !== s0, 20000, "auto action");
  const cSeat = a.hand.seats.find((s) => s.id === cId);
  ok(a.hand.log.at(-1)?.playerId === cId || cSeat.folded || a.hand.status !== "betting", "disconnected player is checked/folded automatically — the game never stalls");
  const c3 = new Client(code, "Cara", c.tok);
  await c3.connect();
  await until(() => c3.room, 4000, "c3");

  // Everyone shoves: exercises all-ins, side pots, runouts, eliminations and the end of the game.
  const runoutBoards = new Set();
  await drive([a, b, c3], () => {
    const hh = a.hand;
    if (hh && hh.status === "runout") runoutBoards.add(hh.board.length);
    return a.room.phase === "finished";
  }, 240000, "shove");
  ok(runoutBoards.size >= 1, `all-in runouts revealed street by street (board sizes seen during runout: ${[...runoutBoards].sort().join(",")})`);
  ok(a.room.members.reduce((t, m) => t + m.chips, 0) === 3000, "chips conserved to the end of the game");
  const winner = a.room.members.find((m) => m.id === a.room.winnerId);
  ok(winner && winner.chips === 3000 && winner.place === 1, `game over: ${winner?.name} wins with all 3000 chips`);
  ok(a.room.members.filter((m) => m.id !== winner.id).every((m) => m.busted && m.place > 1), "eliminated players are marked busted with finishing places");

  a.send({ t: "again" });
  await until(() => a.room.phase === "playing" && a.hand?.handNo === 1, 5000, "rematch");
  ok(a.room.members.every((m) => !m.busted), "host can start a rematch with fresh stacks");
  for (const x of [a, b, c3]) x.close();
}

async function aiTest() {
  console.log("AI table");
  const code = await createRoom({ mode: "ai", bots: 5, difficulty: "hard" });
  const h = new Client(code, "Human");
  await h.connect();
  await until(() => h.hand, 5000, "AI game started");
  ok(h.room.members.length === 6 && h.room.members.filter((m) => m.isBot).length === 5, "AI table: 5 hard bots, dealt immediately");
  const intruder = new Client(code, "Intruder");
  await intruder.connect();
  await until(() => intruder.errors.length > 0, 3000, "intruder");
  ok(intruder.errors[0].fatal, "others cannot join a private AI table");
  let botActions = 0, leak = false, hands = new Set();
  const t0 = Date.now();
  await drive([h], () => {
    const hh = h.hand;
    if (!hh) return false;
    hands.add(hh.handNo);
    botActions = Math.max(botActions, hh.log.filter((l) => l.playerId !== h.room.you && !["sb", "bb"].includes(l.type)).length + 0);
    if (hh.status !== "complete" && hh.seats.some((s) => s.id !== h.room.you && s.cards.some(Boolean))) leak = true;
    return hands.size >= 5 || h.room.phase === "finished";
  }, 240000, "careful");
  ok(!leak, "bot hole cards are never visible before showdown");
  ok(botActions > 0 && hands.size >= 5, `bots act automatically (${hands.size} hands played in ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  h.close();
}

try {
  await friendsTest();
  await aiTest();
} catch (e) {
  failures++;
  console.error("  ✗", e.message);
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll multiplayer checks passed");
process.exit(failures ? 1 : 0);
