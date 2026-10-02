// GET  /api/scores?day=YYYY-MM-DD  -> { top: [...], players: n, db: bool }
// POST /api/scores { day, name, score, combo, flowers } -> { ok, rank }

import {
  getSql, hasDb, memory, readJson, sendJson,
  cleanName, cleanDay, clampInt,
} from '../lib/db.js';

const MAX_SCORE = 200000;

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const day = cleanDay(url.searchParams.get('day'));
      const sql = await getSql();

      if (sql) {
        const top = await sql`
          SELECT name, score, combo, flowers FROM mb_scores
          WHERE day = ${day} ORDER BY score DESC, created_at ASC LIMIT 10`;
        const [{ count }] = await sql`
          SELECT COUNT(*)::int AS count FROM mb_scores WHERE day = ${day}`;
        return sendJson(res, 200, { top, players: count, db: true });
      }

      const rows = memory.scores
        .filter((s) => s.day === day)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(({ name, score, combo, flowers }) => ({ name, score, combo, flowers }));
      return sendJson(res, 200, { top: rows, players: memory.scores.filter((s) => s.day === day).length, db: false });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const day = cleanDay(body.day);
      const name = cleanName(body.name);
      const score = clampInt(body.score, 0, MAX_SCORE);
      const combo = clampInt(body.combo, 0, 999);
      const flowers = clampInt(body.flowers, 0, 999);

      const sql = await getSql();
      let rank;
      if (sql) {
        await sql`
          INSERT INTO mb_scores (day, name, score, combo, flowers)
          VALUES (${day}, ${name}, ${score}, ${combo}, ${flowers})`;
        const [{ rank: r }] = await sql`
          SELECT (COUNT(*) + 1)::int AS rank FROM mb_scores
          WHERE day = ${day} AND score > ${score}`;
        rank = r;
      } else {
        memory.scores.push({ id: memory.nextId++, day, name, score, combo, flowers, created_at: new Date().toISOString() });
        rank = memory.scores.filter((s) => s.day === day && s.score > score).length + 1;
      }
      return sendJson(res, 200, { ok: true, rank, db: hasDb() });
    }

    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { error: 'method not allowed' });
  } catch (err) {
    console.error('scores error', err);
    return sendJson(res, 500, { error: 'the night sky flickered — try again' });
  }
}
