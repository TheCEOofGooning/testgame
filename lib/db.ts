/**
 * Neon, over plain HTTP.
 *
 * No connection pooling, no long-lived sockets, no extra infrastructure —
 * which is exactly why this game can live on Vercel's edge and a single Neon
 * branch and nothing else. Every query below is a single round trip.
 *
 * If DATABASE_URL is absent the whole module degrades to "offline mode":
 * the game still plays perfectly, it just keeps your scores on your device.
 */

import { neon } from "@neondatabase/serverless";

export const hasDb = Boolean(process.env.DATABASE_URL);

type Sql = ReturnType<typeof neon>;

let _sql: Sql | null = null;
export function sql(): Sql {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not configured");
    _sql = neon(url);
  }
  return _sql;
}

/**
 * One idempotent migration, run at most once per warm instance. Keeps the
 * project to a single deploy step: push to Vercel, paste a Neon URL, done.
 */
let schemaReady: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const q = sql();
      await q`
        CREATE TABLE IF NOT EXISTS flights (
          id          TEXT PRIMARY KEY,
          seed        TEXT NOT NULL,
          player      TEXT NOT NULL,
          name        TEXT NOT NULL,
          score       INTEGER NOT NULL,
          metres      INTEGER NOT NULL,
          pollen      INTEGER NOT NULL DEFAULT 0,
          blooms      INTEGER NOT NULL DEFAULT 0,
          best_combo  INTEGER NOT NULL DEFAULT 0,
          duration    REAL NOT NULL,
          replay      TEXT,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await q`CREATE INDEX IF NOT EXISTS flights_board ON flights (seed, score DESC)`;
      await q`CREATE INDEX IF NOT EXISTS flights_player ON flights (seed, player, score DESC)`;
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

export interface BoardRow {
  rank: number;
  id: string;
  name: string;
  score: number;
  metres: number;
  pollen: number;
  duration: number;
  player: string;
  createdAt: string;
}

/** Best flight per player for a given night, ranked. */
export async function leaderboard(seed: string, limit = 25): Promise<BoardRow[]> {
  await ensureSchema();
  const rows = (await sql()`
    SELECT DISTINCT ON (player)
      id, player, name, score, metres, pollen, duration, created_at
    FROM flights
    WHERE seed = ${seed}
    ORDER BY player, score DESC
  `) as Record<string, unknown>[];

  return rows
    .map((r) => ({
      id: String(r.id),
      player: String(r.player),
      name: String(r.name),
      score: Number(r.score),
      metres: Number(r.metres),
      pollen: Number(r.pollen),
      duration: Number(r.duration),
      createdAt: new Date(r.created_at as string).toISOString(),
      rank: 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

export interface GhostRow {
  id: string;
  name: string;
  score: number;
  replay: string;
}

/**
 * The flights you'll fly against tonight: the very best, plus a couple of
 * mid-table runs so the sky never feels empty for a new player.
 */
export async function ghostsFor(seed: string, limit = 6): Promise<GhostRow[]> {
  await ensureSchema();
  const rows = (await sql()`
    WITH best AS (
      SELECT DISTINCT ON (player) id, name, score, replay
      FROM flights
      WHERE seed = ${seed} AND replay IS NOT NULL AND length(replay) > 16
      ORDER BY player, score DESC
    )
    SELECT * FROM best ORDER BY score DESC LIMIT ${limit}
  `) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    score: Number(r.score),
    replay: String(r.replay),
  }));
}

export interface InsertFlight {
  id: string;
  seed: string;
  player: string;
  name: string;
  score: number;
  metres: number;
  pollen: number;
  blooms: number;
  bestCombo: number;
  duration: number;
  replay: string | null;
}

export async function insertFlight(f: InsertFlight): Promise<{ rank: number; total: number }> {
  await ensureSchema();
  const q = sql();
  await q`
    INSERT INTO flights
      (id, seed, player, name, score, metres, pollen, blooms, best_combo, duration, replay)
    VALUES
      (${f.id}, ${f.seed}, ${f.player}, ${f.name}, ${f.score}, ${f.metres},
       ${f.pollen}, ${f.blooms}, ${f.bestCombo}, ${f.duration}, ${f.replay})
    ON CONFLICT (id) DO NOTHING
  `;
  const rows = (await q`
    WITH best AS (
      SELECT DISTINCT ON (player) player, score
      FROM flights WHERE seed = ${f.seed}
      ORDER BY player, score DESC
    )
    SELECT
      (SELECT count(*) FROM best) AS total,
      (SELECT count(*) FROM best WHERE score > ${f.score}) AS above
  `) as Record<string, unknown>[];
  const total = Number(rows[0]?.total ?? 1);
  const above = Number(rows[0]?.above ?? 0);
  return { rank: above + 1, total };
}

/** Housekeeping: a night older than a week is no longer interesting. */
export async function prune(days = 7): Promise<void> {
  await ensureSchema();
  await sql()`DELETE FROM flights WHERE created_at < now() - (${days} || ' days')::interval`;
}
