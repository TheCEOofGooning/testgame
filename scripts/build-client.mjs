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

const mothSvg = `<svg class="moth-mark" width="74" height="54" viewBox="0 0 120 88" fill="none" aria-hidden="true"><defs><linearGradient id="wf" x1=".2" y1="0" x2=".7" y2="1"><stop offset="0%" stop-color="#fffaf0"/><stop offset="55%" stop-color="#ffd98a"/><stop offset="100%" stop-color="#d9a35e"/></linearGradient><linearGradient id="wh" x1=".3" y1="0" x2=".6" y2="1"><stop offset="0%" stop-color="#f3cd93"/><stop offset="100%" stop-color="#b9834a"/></linearGradient><radialGradient id="gl" cx=".5" cy=".5" r=".5"><stop offset="0%" stop-color="#ffd98a" stop-opacity=".5"/><stop offset="100%" stop-color="#ffd98a" stop-opacity="0"/></radialGradient></defs><ellipse cx="60" cy="44" rx="56" ry="40" fill="url(#gl)"/><path d="M57 40C50 22 33 10 20 13 8 16 5 30 11 41c6 10 24 17 46 15z" fill="url(#wf)"/><path d="M63 40c7-18 24-30 37-27 12 3 15 17 9 28-6 10-24 17-46 15z" fill="url(#wf)"/><path d="M57 44c-6 13-17 23-28 23-8 0-12-6-10-13 3-9 17-15 38-16z" fill="url(#wh)" opacity=".92"/><path d="M63 44c6 13 17 23 28 23 8 0 12-6 10-13-3-9-17-15-38-16z" fill="url(#wh)" opacity=".92"/><path d="M60 30c3.4 0 5.6 4.2 5.6 14.6S63.4 68 60 68s-5.6-13-5.6-23.4S56.6 30 60 30z" fill="#6b4f2a"/><path d="M57 31c-3-6-9-10-15-12M63 31c3-6 9-10 15-12" stroke="#c9ad7e" stroke-width="2.6" stroke-linecap="round"/><circle cx="56.4" cy="34" r="1.9" fill="#2e2210"/><circle cx="63.6" cy="34" r="1.9" fill="#2e2210"/></svg>`;

const iconSound = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path class="on" d="M15.5 8.5a5 5 0 0 1 0 7"/><path class="on" d="M18.5 5.5a9 9 0 0 1 0 13"/><path class="off" d="m17 9 4 6M21 9l-4 6"/></svg>`;

/* The how-to icons. These used to be ✦ ☾ ☀ text glyphs, which rendered as
   tofu boxes in the subsetted font — drawn shapes can't go missing. */
const iconLight = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="7.5" stroke="currentColor" stroke-opacity=".45" stroke-width="1.2"/><path d="M12 1.5v3M12 19.5v3M22.5 12h-3M4.5 12h-3" stroke="currentColor" stroke-opacity=".7" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const iconPollen = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><g fill="currentColor"><ellipse cx="12" cy="6.4" rx="2.5" ry="3.9"/><ellipse cx="12" cy="17.6" rx="2.5" ry="3.9"/><ellipse cx="6.4" cy="12" rx="3.9" ry="2.5"/><ellipse cx="17.6" cy="12" rx="3.9" ry="2.5"/></g><circle cx="12" cy="12" r="2.6" fill="#1a2336"/></svg>`;
const iconDawn = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 18h18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 7.5A6.5 6.5 0 0 1 18.5 14h-13A6.5 6.5 0 0 1 12 7.5Z" fill="currentColor" fill-opacity=".85"/><path d="M12 1.8v2.4M3.4 5.4 5.1 7.1M20.6 5.4 18.9 7.1" stroke="currentColor" stroke-opacity=".6" stroke-width="1.5" stroke-linecap="round"/></svg>`;

/** The ornamental rule that separates sections of a panel. */
const rule = `<div class="rule" aria-hidden="true"><i></i><svg viewBox="0 0 14 14" width="9" height="9"><path d="M7 0l7 7-7 7-7-7z" fill="currentColor"/></svg><i></i></div>`;

/** The gold corner brackets that frame every panel. */
const corners = `<span class="corner tl" aria-hidden="true"></span><span class="corner tr" aria-hidden="true"></span><span class="corner bl" aria-hidden="true"></span><span class="corner br" aria-hidden="true"></span>`;

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

<!-- cinematic shell: film grain + a vignette that closes in near the dawn -->
<div class="grain" aria-hidden="true"></div>
<div class="vignette" aria-hidden="true"></div>

<!-- The HUD is DOM, not canvas: it sits exactly over the play-field rect
     (the engine reports it on every resize) so the type stays crisp at any
     device pixel ratio instead of being scaled up with the world. -->
<div class="hud" id="hud" hidden aria-hidden="true">
  <div class="hud-tl">
    <div class="hud-score" id="hud-score">0</div>
    <div class="hud-metres"><b id="hud-metres">0</b><span>m</span></div>
    <div class="hud-combo" id="hud-combo" hidden>
      <svg class="ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle class="track" cx="18" cy="18" r="15.5"/>
        <circle class="fill" id="hud-combo-ring" cx="18" cy="18" r="15.5"/>
      </svg>
      <span class="x">&times;</span><span id="hud-combo-n">2</span>
    </div>
  </div>

  <div class="hud-tc">
    <div class="hud-ghosts" id="hud-ghosts" hidden>
      <span class="pips" id="hud-pips"></span>
      <span class="t" id="hud-ghost-text"></span>
    </div>
  </div>

  <div class="hud-tr" id="hud-glimmers"></div>

  <div class="banner" id="banner" hidden>
    <b id="banner-title"></b>
    <i id="banner-sub"></i>
  </div>

  <div class="dawnmeter" id="dawn" hidden>
    <span class="label">Dawn</span>
    <span class="bar"><i id="dawn-fill"></i></span>
  </div>
</div>

<div class="dock-left">
  <button class="iconbtn" id="mute" data-muted="0" aria-label="Mute" title="Mute (M)">${iconSound}</button>
  <div class="legend" aria-hidden="true">
    <div>${["M30 100 170 24v152z", "M100 30 176 170H24z", "M170 100 30 24v152z", "M100 170 24 30h152z"]
      .map(
        (d) =>
          `<kbd><svg viewBox="0 0 200 200" width="8" height="8" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg></kbd>`,
      )
      .join("")}<span>move the light</span></div>
    <div><kbd>M</kbd><span>mute</span></div>
    <div><kbd>Esc</kbd><span>pause</span></div>
  </div>
</div>

<div class="dock-right">
  <aside class="board panel" aria-label="Tonight's leaderboard">
    ${corners}
    <button class="board-close mobile-only" id="board-close" aria-label="Close leaderboard">&#10005;</button>
    <h3>Tonight&rsquo;s Flight</h3>
    <p class="sub" id="board-sub">Everyone, everywhere</p>
    <p class="empty" id="board-empty">Listening for wingbeats&hellip;</p>
    <ol id="board-list"></ol>
    <div class="countdown"><span>New garden in</span><b id="countdown">--:--:--</b></div>
  </aside>
</div>

<div class="curtain" id="title">
  <div class="title-card panel">
    ${corners}
    <div class="crest">${mothSvg}</div>
    <h1 class="wordmark"><span>Mothlight</span></h1>
    <p class="tagline">Guide the light. The moth will follow.</p>
    ${rule}
    <p class="seedline" id="seedline">Tonight&rsquo;s garden</p>

    <div class="namefield">
      <label for="name">Name</label>
      <input id="name" maxlength="16" placeholder="a moth with no name" autocomplete="off" spellcheck="false">
    </div>

    <button class="btn primary" id="play"><span>Fly tonight&rsquo;s garden</span></button>
    <div class="actions mobile-only" style="margin-top:12px">
      <button class="btn ghost small" id="board-open">Tonight&rsquo;s board</button>
    </div>

    <div class="howto">
      <div class="row"><span class="k">${iconLight}</span><span><b>Move your light</b> with the mouse, a finger, or the arrow keys. The moth chases it &mdash; but it lags, so learn to lead.</span></div>
      <div class="row"><span class="k">${iconPollen}</span><span><b>Collect pollen</b> in chains for a rising multiplier. Blooms give back a glimmer.</span></div>
      <div class="row"><span class="k">${iconDawn}</span><span><b>Stay ahead of the dawn.</b> Thorns, webs, rain and spiders all want tonight to end early.</span></div>
    </div>

    <p class="footnote">Everyone in the world flies the same garden each night. The moths beside you are other players&rsquo; real flights, plus a few residents who already live here.</p>
    <p class="footnote" id="boot-error" hidden>This browser could not start the garden. Try a recent Chrome, Safari or Firefox.</p>
  </div>
</div>

<div class="curtain" id="result" hidden>
  <div class="result panel">
    ${corners}
    <div class="medal" id="medal" aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" class="disc"/><circle cx="24" cy="24" r="16.5" class="inner"/><text x="24" y="24" id="medal-rank">1</text></svg></div>
    <p class="verdict" id="verdict"></p>
    <div class="score"><span id="score-value">0</span><small>points</small></div>
    <div class="pb" id="pb" hidden>New personal best</div>

    <div class="stats">
      <div class="cell"><div class="v" id="stat-metres">0</div><div class="l">metres</div></div>
      <div class="cell"><div class="v" id="stat-pollen">0</div><div class="l">pollen</div></div>
      <div class="cell"><div class="v" id="stat-chain">&times;0</div><div class="l">best chain</div></div>
      <div class="cell"><div class="v" id="stat-rank">0s</div><div class="l" id="stat-rank-label">aloft</div></div>
    </div>

    <div class="outflew" id="outflew" hidden>
      <p id="outflew-text"></p>
      <span class="bar"><i id="outflew-fill"></i></span>
    </div>

    <div class="actions">
      <button class="btn primary" id="again"><span>Fly again</span></button>
      <button class="btn ghost" id="share">Share flight</button>
      <button class="btn ghost small mobile-only" id="board-open-2">Board</button>
      <button class="btn ghost" id="back">Back</button>
    </div>
  </div>
</div>

<div class="curtain" id="pause" hidden>
  <div class="result pausecard panel">
    ${corners}
    <p class="verdict">The garden waits.</p>
    <p class="pausehint">Nothing moves until you say so.</p>
    <div class="actions column">
      <button class="btn primary" id="resume"><span>Keep flying</span></button>
      <button class="btn ghost" id="pause-mute">Sound</button>
      <button class="btn ghost" id="giveup">Give up</button>
    </div>
  </div>
</div>

<div class="toast" id="toast" hidden></div>

<noscript>
  <div class="curtain">
    <div class="title-card panel">
      <h1 class="wordmark"><span>Mothlight</span></h1>
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
