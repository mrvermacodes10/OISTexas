// Long-running strength benchmark (skipped by default): BENCH=1 npx vitest run game/strength
import { it } from "vitest";
import { match } from "./ai.test";
it.runIf(process.env.BENCH)("difficulty ladder", () => {
  for (const [a, b, n] of [["hard", "medium", 2000], ["medium", "easy", 1500], ["hard", "easy", 600]] as const) {
    const r = match(a, b, n);
    console.log(`${a} vs ${b}: ${r.bbPerHand.toFixed(3)} ± ${r.se.toFixed(3)} bb/hand`);
  }
}, 3_600_000);
