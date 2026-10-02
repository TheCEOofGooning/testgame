// GET  /api/garden?limit=300 -> { flowers: [...], total: n, db: bool }
// POST /api/garden { day, name, hue, petals, size, score, message } -> { ok, id }

import {
  getSql, hasDb, memory, readJson, sendJson,
  cleanName, cleanDay, clampInt, clampFloat,
} from '../lib/db.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const limit = clampInt(url.searchParams.get('limit'), 1, 500, 300);
      const sql = await getSql();

      if (sql) {
        const flowers = await sql`
          SELECT id, day, name, hue, petals, size, score, message
          FROM mb_flowers ORDER BY created_at DESC LIMIT ${limit}`;
        const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM mb_flowers`;
        return sendJson(res, 200, { flowers, total: count, db: true });
      }

      const flowers = memory.flowers.slice(-limit).reverse()
        .map(({ id, day, name, hue, petals, size, score, message }) =>
          ({ id, day, name, hue, petals, size, score, message }));
      return sendJson(res, 200, { flowers, total: memory.flowers.length, db: false });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const day = cleanDay(body.day);
      const name = cleanName(body.name);
      const hue = clampInt(body.hue, 0, 360);
      const petals = clampInt(body.petals, 4, 14, 6);
      const size = clampFloat(body.size, 0.5, 2.2, 1);
      const score = clampInt(body.score, 0, 200000);
      const message = String(body.message ?? '').replace(/[<>\\\/{}\[\]`$]/g, '').trim().slice(0, 60);

      const sql = await getSql();
      let id;
      if (sql) {
        const [row] = await sql`
          INSERT INTO mb_flowers (day, name, hue, petals, size, score, message)
          VALUES (${day}, ${name}, ${hue}, ${petals}, ${size}, ${score}, ${message})
          RETURNING id`;
        id = row.id;
      } else {
        id = memory.nextId++;
        memory.flowers.push({ id, day, name, hue, petals, size, score, message, created_at: new Date().toISOString() });
      }
      return sendJson(res, 200, { ok: true, id, db: hasDb() });
    }

    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { error: 'method not allowed' });
  } catch (err) {
    console.error('garden error', err);
    return sendJson(res, 500, { error: 'the garden gate is stuck — try again' });
  }
}
