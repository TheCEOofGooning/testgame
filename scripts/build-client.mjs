/**
 * Builds the game page.
 *
 * The whole playable experience is one HTML document with its CSS inlined and
 * a single hashed ES module. No framework runtime, no hydration, no client
 * router — the title card is painted from markup before any JavaScript has
 * been fetched, and the module that boots the canvas is ~30 KB over the wire.
 *
 * Next.js is still in the project, but only for what it is genuinely good at
 * here: the API routes, the generated OG image, and the deploy pipeline.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "assets");

const SITE =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "");

const TITLE = "MOTHLIGHT — guide the light, the moth will follow";
const DESC =
  "A new night garden grows every day, the same one for everybody. Lead a moth through thorns, webs and rain by moving your light, and race the ghosts of everyone else flying tonight. No download, no sign-up.";

/* ------------------------------------------------------------------ */
/* bundle                                                              */
/* ------------------------------------------------------------------ */

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const js = await build({
  entryPoints: [join(root, "src", "main.ts")],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2020"],
  platform: "browser",
  legalComments: "none",
  write: false,
  define: { "process.env.NODE_ENV": '"production"' },
});

const css = await build({
  entryPoints: [join(root, "src", "styles.css")],
  bundle: true,
  minify: true,
  // font URLs are served straight from /public — don't try to inline them
  external: ["/fonts/*"],
  write: false,
});

const jsCode = js.outputFiles[0].text;
const cssCode = css.outputFiles[0].text;
const hash = createHash("sha256").update(jsCode).digest("hex").slice(0, 10);
const jsName = `play-${hash}.js`;
writeFileSync(join(outDir, jsName), jsCode);

/* ------------------------------------------------------------------ */
/* markup                                                              */
/* ------------------------------------------------------------------ */

const mothSvg = `<svg class="moth-mark" width="56" height="40" viewBox="0 0 100 72" fill="none" aria-hidden="true"><defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fff6e2"/><stop offset="100%" stop-color="#f0c988"/></linearGradient><radialGradient id="g" cx="0.5" cy="0.5" r="0.5"><stop offset="0%" stop-color="#ffd98a" stop-opacity="0.55"/><stop offset="100%" stop-color="#ffd98a" stop-opacity="0"/></radialGradient></defs><circle cx="50" cy="38" r="34" fill="url(#g)"/><path d="M50 22c-6-12-20-19-31-14-9 4-10 17-3 26 6 8 20 12 34 10z" fill="url(#w)"/><path d="M50 22c6-12 20-19 31-14 9 4 10 17 3 26-6 8-20 12-34 10z" fill="url(#w)"/><path d="M50 20c3 0 5 4 5 12s-2 17-5 17-5-9-5-17 2-12 5-12z" fill="#c9ad7e"/><path d="M48 20c-2-5-7-9-11-11M52 20c2-5 7-9 11-11" stroke="#c9ad7e" stroke-width="2.4" stroke-linecap="round"/><circle cx="46" cy="24" r="1.8" fill="#4b3a1c"/><circle cx="54" cy="24" r="1.8" fill="#4b3a1c"/></svg>`;

const iconSound = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path class="on" d="M15.5 8.5a5 5 0 0 1 0 7"/><path class="on" d="M18.5 5.5a9 9 0 0 1 0 13"/><path class="off" d="m17 9 4 6M21 9l-4 6"/></svg>`;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "VideoGame",
  name: "MOTHLIGHT",
  description: DESC,
  genre: ["Arcade", "Casual", "Endless"],
  gamePlatform: "Web browser",
  playMode: "SinglePlayer",
  applicationCategory: "Game",
  operatingSystem: "Any",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  ...(SITE ? { url: SITE } : {}),
};

const ogImage = SITE ? `${SITE}/opengraph-image` : "/opengraph-image";

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>${TITLE}</title>
<meta name="description" content="${DESC}">
<meta name="theme-color" content="#04060c">
<meta name="color-scheme" content="dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="mobile-web-app-capable" content="yes">
<meta name="format-detection" content="telephone=no">
${SITE ? `<link rel="canonical" href="${SITE}/">` : ""}
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon" type="image/png">
<link rel="apple-touch-icon" href="/icon">
<link rel="preload" as="font" type="font/woff2" href="/fonts/inter-latin-500-normal.woff2" crossorigin>
<link rel="preload" as="font" type="font/woff2" href="/fonts/fraunces-latin-600-normal.woff2" crossorigin>
<meta property="og:type" content="website">
<meta property="og:site_name" content="MOTHLIGHT">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="One garden a night, the same for everyone. Fly it before the dawn catches you.">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
${SITE ? `<meta property="og:url" content="${SITE}/">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="MOTHLIGHT">
<meta name="twitter:description" content="One garden a night, the same for everyone. Fly it before the dawn catches you.">
<meta name="twitter:image" content="${ogImage}">
<style>${cssCode}</style>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<script type="module" src="/assets/${jsName}"></script>
</head>
<body>

<div class="stage" id="stage">
  <canvas id="canvas" aria-label="MOTHLIGHT — a moth flying through a night garden"></canvas>
</div>

<div class="dock-left">
  <button class="iconbtn" id="mute" data-muted="0" aria-label="Mute" title="Mute (M)">${iconSound}</button>
</div>

<div class="dock-right">
  <aside class="board panel" aria-label="Tonight's leaderboard">
    <button class="board-close mobile-only" id="board-close" aria-label="Close leaderboard">✕</button>
    <h3>Tonight&rsquo;s Flight</h3>
    <p class="sub" id="board-sub">Everyone, everywhere</p>
    <p class="empty" id="board-empty">Listening for wingbeats&hellip;</p>
    <ol id="board-list"></ol>
    <div class="countdown"><span>New garden in</span><b id="countdown">--:--:--</b></div>
  </aside>
</div>

<div class="curtain" id="title">
  <div class="title-card panel">
    ${mothSvg}
    <h1 class="wordmark">MOTHLIGHT</h1>
    <p class="tagline">Guide the light. The moth will follow.</p>
    <p class="seedline" id="seedline">Tonight&rsquo;s garden</p>

    <div class="namefield">
      <label for="name">Name</label>
      <input id="name" maxlength="16" placeholder="a moth with no name" autocomplete="off" spellcheck="false">
    </div>

    <button class="btn" id="play">Fly tonight&rsquo;s garden</button>
    <div class="actions" style="margin-top:12px">
      <button class="btn ghost small mobile-only" id="board-open">Tonight&rsquo;s board</button>
    </div>

    <div class="howto">
      <div class="row"><span class="k">✦</span><span><b>Move your light</b> with the mouse, a finger, or the arrow keys. The moth chases it &mdash; but it lags, so learn to lead.</span></div>
      <div class="row"><span class="k">☾</span><span><b>Collect pollen</b> in chains for a rising multiplier. Blooms give back a glimmer.</span></div>
      <div class="row"><span class="k">☀</span><span><b>Stay ahead of the dawn.</b> Thorns, webs, rain and spiders all want tonight to end early.</span></div>
    </div>

    <p class="footnote">Everyone in the world flies the same garden each night. The moths beside you are other players&rsquo; real flights, plus a few residents who already live here.</p>
    <p class="footnote" id="boot-error" hidden>This browser could not start the garden. Try a recent Chrome, Safari or Firefox.</p>
  </div>
</div>

<div class="curtain" id="result" hidden>
  <div class="result panel">
    <p class="verdict" id="verdict"></p>
    <div class="score"><span id="score-value">0</span><small>points</small></div>
    <div class="pb" id="pb" hidden>New personal best</div>

    <div class="stats">
      <div class="cell"><div class="v" id="stat-metres">0</div><div class="l">metres</div></div>
      <div class="cell"><div class="v" id="stat-pollen">0</div><div class="l">pollen</div></div>
      <div class="cell"><div class="v" id="stat-chain">×0</div><div class="l">best chain</div></div>
      <div class="cell"><div class="v" id="stat-rank">0s</div><div class="l" id="stat-rank-label">aloft</div></div>
    </div>

    <p class="outflew" id="outflew" hidden></p>

    <div class="actions">
      <button class="btn" id="again">Fly again</button>
      <button class="btn ghost" id="share">Share flight</button>
      <button class="btn ghost small mobile-only" id="board-open-2">Board</button>
      <button class="btn ghost" id="back">Back</button>
    </div>
  </div>
</div>

<div class="curtain" id="pause" hidden>
  <div class="result panel" style="max-width:360px">
    <p class="verdict">The garden waits.</p>
    <div class="actions" style="margin-top:18px">
      <button class="btn" id="resume">Keep flying</button>
      <button class="btn ghost" id="giveup">Give up</button>
    </div>
  </div>
</div>

<div class="toast" id="toast" hidden></div>

<noscript>
  <div class="curtain">
    <div class="title-card panel">
      <h1 class="wordmark">MOTHLIGHT</h1>
      <p class="tagline">Guide the light. The moth will follow.</p>
      <p class="footnote">This one needs JavaScript — the whole garden is drawn in your browser.</p>
    </div>
  </div>
</noscript>

</body>
</html>
`;

writeFileSync(join(root, "public", "play.html"), html);

const bytes = (s) => Buffer.byteLength(s, "utf8");
const gz = (await import("node:zlib")).gzipSync;
console.log(
  `  mothlight client\n` +
    `    js   ${(bytes(jsCode) / 1024).toFixed(1)} KB  (${(gz(jsCode).length / 1024).toFixed(1)} KB gzipped)\n` +
    `    css  ${(bytes(cssCode) / 1024).toFixed(1)} KB  (inlined)\n` +
    `    html ${(bytes(html) / 1024).toFixed(1)} KB  (${(gz(html).length / 1024).toFixed(1)} KB gzipped)\n` +
    `    → total first load ${((gz(jsCode).length + gz(html).length) / 1024).toFixed(1)} KB gzipped`,
);

// keep the folder tidy if an old hash is lying around
for (const f of readdirSync(outDir)) {
  if (f.endsWith(".js") && f !== jsName) rmSync(join(outDir, f));
}
