// Moonbloom data layer.
// Uses Neon serverless Postgres when DATABASE_URL is set (production on Vercel),
// otherwise falls back to an in-memory store so local previews work instantly.

import { neon } from '@neondatabase/serverless';

export const memory = {
  scores: [],  // { id, day, name, score, combo, flowers, created_at }
  flowers: [], // { id, day, name, hue, petals, size, score, message, created_at }
  nextId: 1,
};

let sql = null;
let ready = false;

export function hasDb() {
  return Boolean(process.env.DATABASE_URL);
}

export async function getSql() {
  if (!hasDb()) return null;
  if (!sql) sql = neon(process.env.DATABASE_URL);
  if (!ready) {
    await sql`
      CREATE TABLE IF NOT EXISTS mb_scores (
        id         BIGSERIAL PRIMARY KEY,
        day        TEXT NOT NULL,
        name       TEXT NOT NULL,
        score      INTEGER NOT NULL,
        combo      INTEGER NOT NULL DEFAULT 0,
        flowers    INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS mb_scores_day_score ON mb_scores (day, score DESC)`;
    await sql`
      CREATE TABLE IF NOT EXISTS mb_flowers (
        id         BIGSERIAL PRIMARY KEY,
        day        TEXT NOT NULL,
        name       TEXT NOT NULL,
        hue        INTEGER NOT NULL,
        petals     INTEGER NOT NULL,
        size       REAL NOT NULL,
        score      INTEGER NOT NULL DEFAULT 0,
        message    TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS mb_flowers_created ON mb_flowers (created_at DESC)`;
    ready = true;
  }
  return sql;
}

// ---------- shared helpers for the API functions ----------

export async function readJson(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return {}; }
    }
    return req.body;
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 16384) { req.destroy(); resolve({}); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

export function sendJson(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

export function cleanName(raw) {
  const s = String(raw ?? '').replace(/[<>\\\/{}\[\]`$]/g, '').trim().slice(0, 20);
  return s || 'Anonymous';
}

export function cleanDay(raw) {
  const s = String(raw ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10);
}

export function clampInt(v, lo, hi, dflt = 0) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

export function clampFloat(v, lo, hi, dflt = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}
