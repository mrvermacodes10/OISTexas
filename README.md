# OIStexas — No-limit Texas Hold'em

Free multiplayer Texas Hold'em with **virtual chips only**. Private tables for 2–8 friends, or play against 1–7 AI opponents on Easy, Medium or Hard.

- **Frontend:** Next.js 16 + TypeScript + Tailwind CSS 4 → Vercel (Hobby / free)
- **Game server:** Cloudflare Worker + SQLite-backed Durable Objects → Workers Free plan
- No database, accounts, paid APIs or secrets.

```
app/          Next.js pages: menu (/) and table (/room/[code])
components/   Table, seats, cards, chips, lobby, dialogs
lib/          Browser client: profile, REST, WebSocket hook, sounds
game/         Pure poker engine (cards, evaluator, holdem), AI, shared protocol, tests
cloudflare/   Worker router + GameRoom Durable Object, wrangler.toml
scripts/      End-to-end multiplayer test
```

## Game rules implemented

- Standard 52-card deck, crypto-secure Fisher–Yates shuffle, two hole cards dealt one at a time from the small blind, burn cards before flop/turn/river.
- Dealer button rotates every hand. With three or more players the blinds are to the button's left; heads-up the button posts the small blind, acts first pre-flop and last after the flop.
- Fold, check, call, bet/raise (no-limit, minimum raise = last full raise) and all-in. A short all-in that is less than a full raise does **not** re-open betting for players who already acted. The big blind gets its option.
- Best five of seven cards, all nine categories, ace-high and ace-low (wheel) straights, kickers, full houses from two trips.
- Main pot and any number of side pots, split pots, odd chips to the first winner left of the button, uncalled bets returned.
- When betting is over because players are all-in, the remaining streets are dealt one at a time.
- Each player starts with 1,000 chips. Blinds start at 10/20 and go up every 10 hands. Busted players are eliminated with a finishing place, and the last player with chips wins. The host can start a new game.

## Server authority & privacy

Every table is one `GameRoom` Durable Object. Clients only send intents (`fold`, `call`, `raise to X`…). The server checks each one against the engine and rejects out-of-turn, stale or duplicate actions using a sequence number. It sends every player a separate view: your own hole cards, and face-down placeholders for everyone else's. Other hands are revealed only at showdown, and only for players still in the hand. Seat tokens are random, kept in the browser and never broadcast. Reloading or reconnecting puts you back in the same seat with the same cards.

**Disconnects:** a player who is offline is checked or folded after 10 s, and everyone has a 30 s turn clock. A player who leaves is folded straight away. If every human has been gone for a minute, the table pauses so bots don't keep playing to an empty room. Empty tables delete themselves after 6 hours.

## AI

All bots receive exactly the same redacted view as a human.

- **Easy:** rough Monte Carlo sense of its hand plus noise. It calls too often and sometimes gives up or over-raises at random.
- **Medium:** Monte Carlo equity against the actual number of opponents, pot odds and position. It value-bets and steals from late position.
- **Hard:** an expected-value search. It samples opponent hands from ranges narrowed by their betting this hand, and keeps per-player stats across hands (VPIP and aggression) to model who will call. For each option (fold, check, call, several bet sizes, all-in) it estimates fold probability and equity when called, then takes the best-EV action. This produces value bets, folds and bluffs where the numbers support them.

Measured over thousands of duplicate deals (same cards replayed with seats swapped): Hard beats Medium by about +0.6–1.0 big blinds per hand, Medium beats Easy by about +0.23, and Hard beats Easy by about +6.7. Run it yourself with `BENCH=1 npx vitest run game/strength`.

## Run locally

Requires Node 20+.

```bash
npm install
cp .env.example .env.local          # NEXT_PUBLIC_WORKER_URL=http://localhost:8787
npm run worker:dev                  # terminal 1 — game server on :8787
npm run dev                         # terminal 2 — website on http://localhost:3000
```

Seats are remembered per browser. To play several seats yourself, use different browsers or private windows.

## Tests

```bash
npm test                            # engine, evaluator and AI tests (vitest)
npx tsc -p cloudflare/tsconfig.json # type-check the Worker
npm run build                       # production build of the website
npm run worker:dev                  # then in another terminal:
npm run test:mp                     # end-to-end multiplayer test against the local Worker
npm run test:mp -- https://oisintexas-server.<you>.workers.dev   # same test against production
```

## Deploy (free tiers)

### 1. Cloudflare Worker (game server)

```bash
npx wrangler login                  # free Cloudflare account
npm run worker:deploy
```

It prints a URL like `https://oisintexas-server.<your-subdomain>.workers.dev`. Check it with `curl <url>/api/health`, which should return `{"ok":true}`.

### 2. Vercel (website)

1. Push this folder to a GitHub repository and import it at vercel.com → **Add New → Project**. Vercel detects Next.js automatically.
2. Under **Environment Variables** add `NEXT_PUBLIC_WORKER_URL` = your Worker URL (no trailing slash) for Production and Preview.
3. Click **Deploy**.

CLI alternative: `npx vercel link`, then `npx vercel env add NEXT_PUBLIC_WORKER_URL production`, then `npx vercel --prod`.

### 3. Restrict the Worker to your site (recommended)

In `cloudflare/wrangler.toml`:

```toml
ALLOWED_ORIGINS = "https://your-app.vercel.app,http://localhost:3000"
```

then run `npm run worker:deploy` again. `NEXT_PUBLIC_WORKER_URL` is a public URL, not a secret.

## Free-tier notes

The Workers Free plan includes SQLite-backed Durable Objects within its daily request, duration and storage limits. Going over a limit makes requests fail until the daily reset; it never creates a bill. WebSockets use the hibernation API, so idle tables use almost no duration. Each Hard bot decision costs about 1–3 ms of CPU. This is sized for casual games with friends, not a large public launch.
