/**
 * Runs every query in lib/db.ts against a real Postgres.
 *
 * pglite is Postgres compiled to WASM, so this exercises the actual SQL —
 * DISTINCT ON, the CTEs, the interval cast — in-process, with no Neon
 * account and no network. If this passes, the schema and queries will
 * behave the same way on Neon.
 *
 *   npx tsx scripts/db-check.ts
 */

import { PGlite } from "@electric-sql/pglite";
import {
  __setSqlForTesting,
  ensureSchema,
  ghostsFor,
  insertFlight,
  leaderboard,
  prune,
} from "../lib/db";
import { decodePath, encodePath } from "../game/ghost";

/** A real, encoded flight path of roughly `secs` seconds. */
function replayOf(secs: number, drift: number): string {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < secs * 12; i++) {
    xs.push(Math.sin(i / 9 + drift) * 220);
    ys.push(i * 14 + 300);
  }
  return encodePath(xs, ys);
}

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

async function main() {
  const db = new PGlite();

  // Shim Neon's tagged-template API onto pglite.
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = "";
    strings.forEach((part, i) => {
      text += part;
      if (i < values.length) text += `$${i + 1}`;
    });
    return db.query(text, values as never[]).then((r) => r.rows);
  };
  __setSqlForTesting(sql as never);

  console.log("\n— schema");
  await ensureSchema();
  await ensureSchema(); // must be idempotent
  const cols = (await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'flights' ORDER BY column_name`,
  )).rows as { column_name: string }[];
  check(
    "flights table created (and CREATE IF NOT EXISTS is idempotent)",
    cols.length === 12,
    cols.map((c) => c.column_name).join(", "),
  );

  console.log("\n— writing flights");
  const seed = "2026-10-02";
  const mk = (player: string, name: string, score: number, replay: string | null) => ({
    id: `${player}-${score}`,
    seed,
    player,
    name,
    score,
    metres: Math.round(score / 3),
    pollen: 20,
    blooms: 1,
    bestCombo: 5,
    duration: 42.5,
    replay,
  });

  const aliceReplay = replayOf(42.5, 0.3);
  const r1 = await insertFlight(mk("alice", "Alice", 900, replayOf(20, 1.1)));
  const r2 = await insertFlight(mk("alice", "Alice", 2400, aliceReplay));
  const r3 = await insertFlight(mk("bob", "Bob", 1500, replayOf(31, 2.4)));
  await insertFlight(mk("carol", "Carol", 300, null));
  check("insert returns a rank", r1.rank === 1 && r1.total === 1, JSON.stringify(r1));
  check("rank recomputes as players arrive", r2.rank === 1 && r3.rank === 2,
    `alice#${r2.rank}/${r2.total}, bob#${r3.rank}/${r3.total}`);

  const dup = await insertFlight(mk("alice", "Alice", 2400, "TUwBDAAAbbbb"));
  const count = (await db.query(`SELECT count(*)::int AS n FROM flights`)).rows as { n: number }[];
  check("ON CONFLICT makes resubmits idempotent", count[0].n === 4, `${count[0].n} rows`);
  check("duplicate submit still returns a sane rank", dup.rank === 1);

  console.log("\n— leaderboard");
  const board = await leaderboard(seed);
  check("one row per player (best run wins)", board.length === 3, `${board.length} rows`);
  check("sorted high to low", board[0].score === 2400 && board[2].score === 300,
    board.map((b) => `${b.name}:${b.score}`).join(" "));
  check("ranks are 1..n", board.every((b, i) => b.rank === i + 1));
  check("alice's 900 run is hidden behind her 2400", !board.some((b) => b.score === 900));
  check("a different night is empty", (await leaderboard("1999-01-01")).length === 0);

  console.log("\n— ghosts");
  const ghosts = await ghostsFor(seed, 6);
  check("only flights with a usable replay", ghosts.length === 2,
    ghosts.map((g) => g.name).join(", "));
  check("carol (no replay) is excluded", !ghosts.some((g) => g.name === "Carol"));
  check("best replay per player, ordered by score",
    ghosts[0].name === "Alice" && ghosts[0].score === 2400 && ghosts[1].name === "Bob");
  check("limit is respected", (await ghostsFor(seed, 1)).length === 1);
  const back = decodePath(ghosts[0].replay);
  check(
    "a replay survives the round trip through Postgres",
    Math.abs(back.duration - 42.5) < 0.2 && back.path.length / 2 === 510,
    `${back.duration.toFixed(1)}s, ${back.path.length / 2} samples`,
  );
  check(
    "stored replay is small",
    ghosts[0].replay.length < 4000,
    `${(ghosts[0].replay.length / 1024).toFixed(1)} KB of base64 for a 42s flight`,
  );

  console.log("\n— housekeeping");
  await db.query(`UPDATE flights SET created_at = now() - interval '30 days' WHERE player = 'bob'`);
  await prune(7);
  const left = (await db.query(`SELECT count(*)::int AS n FROM flights`)).rows as { n: number }[];
  check("prune() drops stale nights only", left[0].n === 3, `${left[0].n} rows left`);

  await db.close();
  console.log(failures === 0 ? "\n✓ all database checks passed\n" : `\n✗ ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
