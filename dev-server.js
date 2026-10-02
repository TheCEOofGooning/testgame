// Tiny local dev server that mirrors Vercel's zero-config behavior:
// static files from the repo root + serverless functions from /api.
// Run: npm run dev   (set DATABASE_URL to use a real Neon database)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const apiHandlers = {
  '/api/scores': (await import('./api/scores.js')).default,
  '/api/garden': (await import('./api/garden.js')).default,
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;

  // api routes
  const handler = apiHandlers[path];
  if (handler) {
    try { await handler(req, res); }
    catch (e) {
      console.error(e);
      if (!res.headersSent) { res.statusCode = 500; res.end('{"error":"internal"}'); }
    }
    return;
  }

  // static files
  let file = path === '/' ? '/index.html' : path;
  file = normalize(file).replace(/^(\.\.[/\\])+/, '');
  try {
    const data = await readFile(join(ROOT, file));
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌙 Moonbloom glowing at http://0.0.0.0:${PORT}`);
  console.log(process.env.DATABASE_URL ? '   using Neon database' : '   no DATABASE_URL — using in-memory store');
});
