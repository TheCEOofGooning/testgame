/* ============================================================
   🌙 MOONBLOOM — catch the light, grow the world's garden
   Pure canvas. No frameworks. No assets. Everything procedural.
   ============================================================ */

'use strict';

// ---------------------------------------------------------- utils
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function lerpColor(c1, c2, t) {
  return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))];
}
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// ---------------------------------------------------------- day
const EPOCH = Date.UTC(2026, 9, 2); // launch night
const DAY = new Date().toISOString().slice(0, 10);
const NIGHT_NUM = Math.max(1, Math.floor((Date.now() - EPOCH) / 86400000) + 1);
$('daybadge').textContent = `Night #${NIGHT_NUM} · same sky for everyone`;

// ---------------------------------------------------------- canvas
const cv = $('sky');
const cx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  buildStars();
  buildHills();
  if (typeof menuFlowers !== 'undefined') buildMenuMeadow();
  if (typeof gardenData !== 'undefined' && state === ST.GARDEN) layoutGarden();
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------- audio (procedural, tiny, lovely)
const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];
let AC = null;
let muted = localStorage.getItem('mb_mute') === '1';
$('btn-mute').textContent = muted ? '🔇' : '🔊';

function audio() {
  if (!AC) {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function chime(step, vol = 0.16) {
  if (muted) return;
  const ac = audio(); if (!ac) return;
  const f = PENTA[clamp(step, 0, PENTA.length - 1)];
  const t = ac.currentTime;
  const o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine'; o.frequency.value = f;
  o2.type = 'triangle'; o2.frequency.value = f * 2; // shimmer octave
  const g2 = ac.createGain(); g2.gain.value = 0.25;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  o.connect(g); o2.connect(g2); g2.connect(g); g.connect(ac.destination);
  o.start(t); o2.start(t); o.stop(t + 1); o2.stop(t + 1);
}
function thud() {
  if (muted) return;
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(160, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.28);
  g.gain.setValueAtTime(0.3, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  o.connect(g); g.connect(ac.destination);
  o.start(t); o.stop(t + 0.35);
}
function dawnChord() {
  if (muted) return;
  const ac = audio(); if (!ac) return;
  [0, 2, 4, 7].forEach((s, i) => setTimeout(() => chime(s, 0.12), i * 140));
}
$('btn-mute').addEventListener('click', () => {
  muted = !muted;
  localStorage.setItem('mb_mute', muted ? '1' : '0');
  $('btn-mute').textContent = muted ? '🔇' : '🔊';
  if (!muted) chime(4, 0.1);
});

// ---------------------------------------------------------- scenery
const SKY_NIGHT = { top: [16, 10, 42], mid: [42, 22, 74], low: [86, 38, 92] };
const SKY_DAWN = { top: [64, 48, 118], mid: [176, 92, 128], low: [255, 176, 130] };

let stars = [];
function buildStars() {
  const r = mulberry32(777);
  stars = [];
  const n = Math.floor((W * H) / 9000);
  for (let i = 0; i < n; i++) {
    stars.push({ x: r() * W, y: r() * H * 0.72, s: 0.5 + r() * 1.4, p: r() * TAU, v: 0.4 + r() * 1.2 });
  }
}
let hillPaths = [];
function buildHills() {
  hillPaths = [];
  const r = mulberry32(4242);
  for (let layer = 0; layer < 2; layer++) {
    const pts = [];
    const base = H * (0.78 + layer * 0.08);
    const amp = 34 + layer * 26;
    const n = 9;
    for (let i = 0; i <= n; i++) {
      pts.push({ x: (W / n) * i, y: base - Math.abs(Math.sin(i * 1.7 + layer * 5 + r() * 0.6)) * amp });
    }
    hillPaths.push(pts);
  }
}

const glowCache = new Map();
function glowSprite(hue, sat = 90, lit = 70) {
  const key = `${Math.round(hue / 10) * 10}-${sat}-${lit}`;
  if (glowCache.has(key)) return glowCache.get(key);
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, `hsla(${hue},${sat}%,${lit + 18}%,0.9)`);
  gr.addColorStop(0.35, `hsla(${hue},${sat}%,${lit}%,0.42)`);
  gr.addColorStop(1, `hsla(${hue},${sat}%,${lit}%,0)`);
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  glowCache.set(key, c);
  return c;
}

function drawSky(dawn) {
  const top = lerpColor(SKY_NIGHT.top, SKY_DAWN.top, dawn);
  const mid = lerpColor(SKY_NIGHT.mid, SKY_DAWN.mid, dawn);
  const low = lerpColor(SKY_NIGHT.low, SKY_DAWN.low, dawn);
  const g = cx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgb(top)); g.addColorStop(0.55, rgb(mid)); g.addColorStop(1, rgb(low));
  cx.fillStyle = g; cx.fillRect(0, 0, W, H);

  // stars fade at dawn
  const sAlpha = (1 - dawn) * 0.95;
  if (sAlpha > 0.02) {
    cx.fillStyle = '#fff';
    for (const st of stars) {
      const tw = 0.45 + 0.55 * Math.sin(st.p + nowT * st.v);
      cx.globalAlpha = sAlpha * tw;
      cx.fillRect(st.x, st.y, st.s, st.s);
    }
    cx.globalAlpha = 1;
  }

  // moon
  const mx = W * 0.82, my = H * (0.16 + dawn * 0.1);
  const mg = glowSprite(48, 80, 85);
  cx.globalAlpha = 0.85 - dawn * 0.5;
  cx.drawImage(mg, mx - 110, my - 110, 220, 220);
  cx.globalAlpha = 1;
  cx.fillStyle = `rgba(255,248,222,${0.95 - dawn * 0.35})`;
  cx.beginPath(); cx.arc(mx, my, 30, 0, TAU); cx.fill();
  cx.fillStyle = rgb(lerpColor(SKY_NIGHT.top, SKY_DAWN.top, dawn), 0.22);
  cx.beginPath(); cx.arc(mx - 11, my - 7, 7, 0, TAU); cx.fill();
  cx.beginPath(); cx.arc(mx + 9, my + 10, 5, 0, TAU); cx.fill();

  // hills
  for (let l = 0; l < hillPaths.length; l++) {
    const pts = hillPaths[l];
    const shade = l === 0
      ? lerpColor([30, 18, 56], [120, 70, 110], dawn)
      : lerpColor([20, 12, 40], [86, 48, 92], dawn);
    cx.fillStyle = rgb(shade);
    cx.beginPath();
    cx.moveTo(-10, H + 10);
    cx.lineTo(-10, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2, yc = (pts[i].y + pts[i + 1].y) / 2;
      cx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    cx.lineTo(W + 10, H + 10);
    cx.closePath(); cx.fill();
  }
}

// procedural flower — the soul of the game
function drawFlower(g, x, y, size, hue, petals, growth, t, swayAmt = 1) {
  const gr = Math.min(1, growth);
  const stemH = 46 * size * gr;
  const sway = Math.sin(t * 1.3 + x * 0.05) * 3 * swayAmt;
  const topX = x + sway, topY = y - stemH;

  // stem
  g.strokeStyle = `hsla(${118 + (hue % 30)}, 42%, ${30 + gr * 10}%, ${0.5 + gr * 0.5})`;
  g.lineWidth = Math.max(1.4, 2.2 * size);
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + sway * 0.4, y - stemH * 0.6, topX, topY);
  g.stroke();

  // leaf
  if (gr > 0.4) {
    const ly = y - stemH * 0.45;
    g.fillStyle = `hsla(${125 + (hue % 25)}, 45%, 34%, ${gr * 0.9})`;
    g.save();
    g.translate(x + sway * 0.25, ly);
    g.rotate(-0.7 + Math.sin(t + x) * 0.06);
    g.beginPath(); g.ellipse(7 * size, 0, 9 * size * gr, 3.6 * size * gr, 0, 0, TAU); g.fill();
    g.restore();
  }

  if (gr > 0.25) {
    const bloom = clamp((gr - 0.25) / 0.75, 0, 1);
    const pr = 9 * size * bloom;
    // glow halo
    const spr = glowSprite(hue);
    const hs = pr * 5.2;
    g.globalAlpha = 0.5 * bloom;
    g.drawImage(spr, topX - hs / 2, topY - hs / 2, hs, hs);
    g.globalAlpha = 1;
    // petals
    g.fillStyle = `hsla(${hue}, 85%, 74%, ${0.92 * bloom})`;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * TAU + t * 0.08 + x * 0.01;
      g.save();
      g.translate(topX, topY);
      g.rotate(a);
      g.beginPath();
      g.ellipse(pr * 0.85, 0, pr, pr * 0.42, 0, 0, TAU);
      g.fill();
      g.restore();
    }
    // core
    g.fillStyle = `hsla(${(hue + 40) % 360}, 95%, 85%, ${bloom})`;
    g.beginPath(); g.arc(topX, topY, pr * 0.42, 0, TAU); g.fill();
  }
}

// ---------------------------------------------------------- game state
const ST = { MENU: 0, PLAY: 1, OVER: 2, GARDEN: 3 };
let state = ST.MENU;
let zen = false;

let nowT = 0;          // global clock (seconds) for ambient animation
let lastFrame = performance.now();

const RUN_LEN = 150;   // seconds until dawn
const game = {
  t: 0, score: 0, combo: 0, bestCombo: 0, petals: 3,
  caught: 0, rng: null, nextSpawn: 0, iframes: 0,
  seeds: [], thorns: [], dews: [],
  grown: [],           // flowers grown this run (visual)
  best: null,          // best flower params { hue, petals, size }
  over: false, survived: false, shake: 0,
};
const lantern = { x: 0, tx: 0, y: 0, r: 16, trail: [] };
let particles = [];
let ambient = [];      // menu fireflies

function resetAmbient() {
  ambient = [];
  const r = mulberry32(99);
  for (let i = 0; i < 26; i++) {
    ambient.push({ x: r() * W, y: H * 0.3 + r() * H * 0.6, p: r() * TAU, v: 0.3 + r() * 0.7, s: 1 + r() * 2 });
  }
}

// menu meadow (ambient flowers along the bottom of the title screen)
let menuFlowers = [];
function buildMenuMeadow() {
  const r = mulberry32(hashStr(DAY));
  menuFlowers = [];
  const n = Math.floor(W / 46);
  for (let i = 0; i < n; i++) {
    menuFlowers.push({
      x: (i + 0.2 + r() * 0.6) * (W / n),
      y: H - 6 - r() * 26,
      size: 0.5 + r() * 0.6,
      hue: [48, 320, 265, 190, 10][Math.floor(r() * 5)] + r() * 24,
      petals: 5 + Math.floor(r() * 4),
      growth: 1,
    });
  }
}

// ---------------------------------------------------------- input
let pointerX = null;
let pointerDown = false;
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.key] = true;
  if (state === ST.PLAY && (e.key === 'Escape')) quitRun();
  if (state === ST.GARDEN && e.key === 'Escape') closeGarden();
});
window.addEventListener('keyup', (e) => { keys[e.key] = false; });

cv.addEventListener('pointerdown', (e) => { pointerDown = true; pointerX = e.clientX; onGardenDragStart(e); audio(); });
window.addEventListener('pointermove', (e) => {
  pointerX = e.clientX;
  onGardenDragMove(e);
  onGardenHover(e);
});
window.addEventListener('pointerup', () => { pointerDown = false; gardenDrag.on = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) lastFrame = performance.now(); });

// ---------------------------------------------------------- run lifecycle
function startRun(zenMode) {
  zen = zenMode;
  const seed = zen ? (Math.random() * 1e9) >>> 0 : hashStr('moonbloom:' + DAY);
  game.rng = mulberry32(seed);
  game.t = 0; game.score = 0; game.combo = 0; game.bestCombo = 0;
  game.petals = 3; game.caught = 0; game.nextSpawn = 0.6; game.iframes = 0;
  game.seeds = []; game.thorns = []; game.dews = [];
  game.grown = []; game.best = null; game.over = false; game.survived = false; game.shake = 0;
  lantern.x = lantern.tx = W / 2; lantern.trail = [];
  particles = [];
  state = ST.PLAY;
  show('hud'); hide('menu'); hide('over'); hide('gardenbar'); hide('gtip');
  $('dawnlabel').textContent = zen ? 'zen — breathe' : 'until dawn';
  $('hud-petals').style.visibility = zen ? 'hidden' : 'visible';
  $('hud-score').style.visibility = zen ? 'hidden' : 'visible';
  updateHud();
}
function quitRun() { state = ST.MENU; toMenu(); }

function endRun(survived) {
  game.over = true; game.survived = survived;
  state = ST.OVER;
  if (survived) {
    game.score += game.petals * 250;
    dawnChord();
  }
  hide('hud'); show('over');
  $('over-title').textContent = survived ? 'Dawn arrives 🌅' : 'The dark closed in 🌑';
  $('st-score').textContent = game.score.toLocaleString();
  $('st-combo').textContent = '×' + game.bestCombo;
  $('st-flowers').textContent = game.caught;

  const bestKey = 'mb_best_' + DAY;
  const prev = Number(localStorage.getItem(bestKey) || 0);
  if (game.score > prev) localStorage.setItem(bestKey, String(game.score));
  $('over-best').textContent = game.score > prev
    ? '✨ a new personal best for tonight'
    : `personal best tonight: ${Math.max(prev, game.score).toLocaleString()}`;

  // best flower preview
  if (!game.best) game.best = { hue: 48, petals: 5, size: 0.8 };
  drawBestFlowerPreview();

  $('inp-name').value = localStorage.getItem('mb_name') || '';
  $('inp-msg').value = '';
  $('btn-plant').disabled = false;
  $('plant-status').textContent = '';
  loadBoard('over-board-list');
}

function toMenu() {
  state = ST.MENU;
  show('menu'); hide('hud'); hide('over'); hide('gardenbar'); hide('gtip');
  buildMenuMeadow();
  loadBoard('menu-board-list');
}

// ---------------------------------------------------------- spawning (deterministic from daily seed)
function spawnWave() {
  const r = game.rng;
  const prog = clamp(game.t / RUN_LEN, 0, 1);
  const x = 30 + r() * (W - 60);
  const roll = r();
  const thornChance = zen ? 0 : lerp(0.1, 0.34, prog);
  const dewChance = 0.035;

  if (roll < dewChance && game.petals < 3 && !zen) {
    game.dews.push({ x, y: -20, vy: lerp(70, 120, prog), sway: r() * TAU, r: 10 });
  } else if (roll < dewChance + thornChance) {
    game.thorns.push({ x, y: -24, vy: lerp(120, 300, prog) * (0.85 + r() * 0.4), rot: r() * TAU, vr: (r() - 0.5) * 4, r: 13 });
  } else {
    const rare = r() < lerp(0.05, 0.16, prog);
    const hue = rare ? [320, 265, 190, 10][Math.floor(r() * 4)] + r() * 20 : 42 + r() * 22;
    game.seeds.push({
      x, y: -18, vy: lerp(85, 230, prog) * (0.85 + r() * 0.35),
      sway: r() * TAU, swayAmp: 16 + r() * 26,
      hue, rare, r: rare ? 11 : 9,
    });
  }
  const interval = zen ? 0.75 : lerp(0.72, 0.3, prog);
  game.nextSpawn = game.t + interval * (0.7 + r() * 0.6);
}

// ---------------------------------------------------------- update
function updatePlay(dt) {
  game.t += dt;
  const prog = clamp(game.t / RUN_LEN, 0, 1);
  if (!zen && game.t >= RUN_LEN) { endRun(true); return; }

  // lantern control
  if (pointerX !== null && pointerDown) lantern.tx = pointerX;
  else if (pointerX !== null && matchMedia('(hover:hover)').matches) lantern.tx = pointerX;
  const kv = (keys.ArrowRight || keys.d ? 1 : 0) - (keys.ArrowLeft || keys.a ? 1 : 0);
  if (kv) lantern.tx = clamp(lantern.tx + kv * 540 * dt, 20, W - 20);
  lantern.tx = clamp(lantern.tx, 20, W - 20);
  lantern.x = lerp(lantern.x, lantern.tx, 1 - Math.pow(0.0008, dt));
  lantern.y = H * 0.82;
  lantern.trail.push({ x: lantern.x, y: lantern.y, a: 1 });
  if (lantern.trail.length > 14) lantern.trail.shift();
  for (const tr of lantern.trail) tr.a *= 0.86;

  if (game.iframes > 0) game.iframes -= dt;
  if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 30);

  // spawns
  if (game.t >= game.nextSpawn) spawnWave();

  const meadowY = H * 0.94;

  // seeds
  for (let i = game.seeds.length - 1; i >= 0; i--) {
    const s = game.seeds[i];
    s.y += s.vy * dt;
    s.x += Math.sin(nowT * 2 + s.sway) * s.swayAmp * dt;
    const dx = s.x - lantern.x, dy = s.y - lantern.y;
    if (dx * dx + dy * dy < (lantern.r + s.r + 6) ** 2) {
      game.seeds.splice(i, 1);
      catchSeed(s);
    } else if (s.y > meadowY + 20) {
      game.seeds.splice(i, 1);
      if (!zen && game.combo > 0) { game.combo = 0; updateHud(); }
      puff(s.x, meadowY, 200, 4, 2);
    }
  }
  // thorns
  for (let i = game.thorns.length - 1; i >= 0; i--) {
    const th = game.thorns[i];
    th.y += th.vy * dt; th.rot += th.vr * dt;
    const dx = th.x - lantern.x, dy = th.y - lantern.y;
    if (dx * dx + dy * dy < (lantern.r + th.r) ** 2) {
      game.thorns.splice(i, 1);
      if (game.iframes <= 0) {
        game.petals--; game.combo = 0; game.iframes = 1.2; game.shake = 9;
        thud(); puff(lantern.x, lantern.y, 275, 18, 4);
        updateHud();
        if (game.petals <= 0) { endRun(false); return; }
      }
    } else if (th.y > H + 30) game.thorns.splice(i, 1);
  }
  // dew
  for (let i = game.dews.length - 1; i >= 0; i--) {
    const d = game.dews[i];
    d.y += d.vy * dt;
    d.x += Math.sin(nowT * 1.4 + d.sway) * 12 * dt;
    const dx = d.x - lantern.x, dy = d.y - lantern.y;
    if (dx * dx + dy * dy < (lantern.r + d.r + 6) ** 2) {
      game.dews.splice(i, 1);
      if (game.petals < 3) game.petals++;
      chime(7, 0.14); chime(9, 0.1);
      puff(lantern.x, lantern.y, 185, 14, 3);
      updateHud();
    } else if (d.y > H + 30) game.dews.splice(i, 1);
  }

  // grow flowers
  for (const f of game.grown) f.growth = Math.min(1, f.growth + dt * 1.4);

  // hud dawn bar
  $('dawnfill').style.width = zen ? '0%' : `${(prog * 100).toFixed(1)}%`;
}

function catchSeed(s) {
  game.caught++;
  if (!zen) {
    game.combo++;
    game.bestCombo = Math.max(game.bestCombo, game.combo);
    const base = s.rare ? 50 : 10;
    game.score += base + game.combo * 2;
  }
  chime(zen ? Math.floor(Math.random() * 5) : Math.min(game.combo, 9), 0.15);
  puff(s.x, s.y, s.hue, 10, 3);

  // plant a flower in the run meadow at the catch x
  const size = clamp(0.55 + (zen ? 0.3 : game.combo * 0.045), 0.55, 1.6) * (s.rare ? 1.25 : 1);
  const petals = clamp(5 + Math.floor((zen ? 1 : game.combo) / 3), 5, 11);
  const f = { x: clamp(s.x, 14, W - 14), y: H - 4 - Math.random() * 22, size, hue: s.hue, petals, growth: 0 };
  game.grown.push(f);
  if (game.grown.length > 110) game.grown.shift();
  if (!game.best || size > game.best.size) game.best = { hue: Math.round(s.hue), petals, size: Number(size.toFixed(2)) };
  updateHud();
}

function puff(x, y, hue, n, speed) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, v = (0.4 + Math.random()) * speed * 30;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, life: 0.9, hue });
  }
  if (particles.length > 350) particles.splice(0, particles.length - 350);
}

function updateHud() {
  $('hud-score').textContent = game.score.toLocaleString();
  const c = $('hud-combo');
  if (game.combo >= 3) { c.classList.remove('hidden'); c.textContent = '×' + game.combo + ' chain'; }
  else c.classList.add('hidden');
  $('hud-petals').textContent = '❀ '.repeat(game.petals).trim() || '·';
}

// ---------------------------------------------------------- render
function render(dt) {
  const dawn = state === ST.PLAY && !zen ? clamp(game.t / RUN_LEN, 0, 1) * 0.92 : 0.06;

  cx.save();
  if (state === ST.PLAY && game.shake > 0.3) {
    cx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
  }

  drawSky(dawn);

  // ambient fireflies (menu / over / play background)
  if (state !== ST.GARDEN) {
    const spr = glowSprite(55);
    for (const a of ambient) {
      a.x += Math.sin(nowT * a.v + a.p) * 14 * dt;
      a.y += Math.cos(nowT * a.v * 0.8 + a.p) * 10 * dt;
      const tw = 0.3 + 0.5 * Math.abs(Math.sin(nowT * a.v + a.p));
      cx.globalAlpha = tw * 0.8;
      const s = a.s * 7;
      cx.drawImage(spr, a.x - s / 2, a.y - s / 2, s, s);
    }
    cx.globalAlpha = 1;
  }

  if (state === ST.MENU || state === ST.OVER) {
    for (const f of menuFlowers) drawFlower(cx, f.x, f.y, f.size, f.hue, f.petals, 1, nowT, 1);
  }

  if (state === ST.PLAY) renderPlay();
  if (state === ST.GARDEN) renderGarden(dt);

  // particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt * 1.6;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 60 * dt;
    cx.globalAlpha = p.life;
    cx.fillStyle = `hsl(${p.hue}, 90%, 75%)`;
    cx.beginPath(); cx.arc(p.x, p.y, 2.2 * p.life + 0.6, 0, TAU); cx.fill();
  }
  cx.globalAlpha = 1;
  cx.restore();
}

function renderPlay() {
  // run meadow flowers
  for (const f of game.grown) drawFlower(cx, f.x, f.y, f.size, f.hue, f.petals, f.growth, nowT);

  // seeds
  for (const s of game.seeds) {
    const spr = glowSprite(s.hue);
    const gs = s.r * 5.4;
    cx.drawImage(spr, s.x - gs / 2, s.y - gs / 2, gs, gs);
    cx.fillStyle = `hsl(${s.hue}, 95%, ${s.rare ? 80 : 86}%)`;
    cx.beginPath(); cx.arc(s.x, s.y, s.r * 0.52, 0, TAU); cx.fill();
    if (s.rare) { // sparkle cross
      cx.strokeStyle = `hsla(${s.hue},95%,88%,.9)`;
      cx.lineWidth = 1.4;
      const l = s.r * 1.5, tw = 0.7 + 0.3 * Math.sin(nowT * 6 + s.sway);
      cx.globalAlpha = tw;
      cx.beginPath();
      cx.moveTo(s.x - l, s.y); cx.lineTo(s.x + l, s.y);
      cx.moveTo(s.x, s.y - l); cx.lineTo(s.x, s.y + l);
      cx.stroke(); cx.globalAlpha = 1;
    }
  }
  // dew
  for (const d of game.dews) {
    const spr = glowSprite(150, 70, 70);
    cx.drawImage(spr, d.x - 26, d.y - 26, 52, 52);
    cx.fillStyle = 'hsla(150, 80%, 80%, .95)';
    cx.beginPath(); cx.arc(d.x, d.y, 6, 0, TAU); cx.fill();
    cx.fillStyle = 'hsla(150, 90%, 95%, .9)';
    cx.font = '10px sans-serif'; cx.textAlign = 'center';
    cx.fillText('❀', d.x, d.y - 12);
  }
  // thorns
  for (const th of game.thorns) {
    cx.save();
    cx.translate(th.x, th.y); cx.rotate(th.rot);
    cx.fillStyle = 'rgba(58, 34, 92, .96)';
    cx.strokeStyle = 'rgba(168, 128, 220, .8)';
    cx.lineWidth = 1.5;
    cx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? th.r : th.r * 0.45;
      const a = (i / 10) * TAU;
      i === 0 ? cx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr) : cx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    cx.closePath(); cx.fill(); cx.stroke();
    cx.restore();
  }

  // lantern trail + lantern
  for (const tr of lantern.trail) {
    const spr = glowSprite(48);
    const s = 26 * tr.a;
    cx.globalAlpha = tr.a * 0.35;
    cx.drawImage(spr, tr.x - s / 2, tr.y - s / 2, s, s);
  }
  cx.globalAlpha = 1;
  const blink = game.iframes > 0 && Math.sin(nowT * 26) > 0;
  if (!blink) {
    const spr = glowSprite(48);
    cx.drawImage(spr, lantern.x - 56, lantern.y - 56, 112, 112);
    // paper body
    cx.fillStyle = 'rgba(255, 235, 185, .96)';
    cx.beginPath(); cx.ellipse(lantern.x, lantern.y, 12, 15, 0, 0, TAU); cx.fill();
    cx.fillStyle = 'rgba(255, 255, 240, .95)';
    cx.beginPath(); cx.arc(lantern.x, lantern.y + 1, 5.5, 0, TAU); cx.fill();
    cx.strokeStyle = 'rgba(190, 120, 70, .85)';
    cx.lineWidth = 2;
    cx.beginPath(); cx.moveTo(lantern.x - 9, lantern.y - 13); cx.lineTo(lantern.x + 9, lantern.y - 13); cx.stroke();
    cx.beginPath(); cx.moveTo(lantern.x - 7, lantern.y + 14); cx.lineTo(lantern.x + 7, lantern.y + 14); cx.stroke();
  }
}

// ---------------------------------------------------------- best flower preview (game over card)
function drawBestFlowerPreview() {
  const c = $('bestflower');
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const b = game.best;
  drawFlower(g, c.width / 2, c.height - 10, b.size * 1.25, b.hue, b.petals, 1, nowT, 0.6);
}

// ---------------------------------------------------------- world garden
const gardenData = { flowers: [], total: 0, loaded: false };
const gardenCam = { x: 0, min: 0, max: 0 };
const gardenDrag = { on: false, startX: 0, camStart: 0 };
let gardenWorld = [];

async function openGarden() {
  state = ST.GARDEN;
  hide('menu'); hide('over'); hide('hud'); show('gardenbar');
  $('gcount').textContent = 'gathering flowers…';
  try {
    const res = await fetch('/api/garden?limit=400');
    const data = await res.json();
    gardenData.flowers = data.flowers || [];
    gardenData.total = data.total || gardenData.flowers.length;
    gardenData.loaded = true;
    $('gcount').textContent = gardenData.total === 0
      ? 'no flowers yet — be the first to plant one 🌱'
      : `${gardenData.total.toLocaleString()} flowers planted by players around the world`;
  } catch {
    $('gcount').textContent = 'the garden sleeps (offline) — showing what we remember';
    gardenData.flowers = [];
  }
  layoutGarden();
}
function layoutGarden() {
  const n = Math.max(gardenData.flowers.length, 1);
  const worldW = Math.max(W * 1.2, n * 54);
  gardenWorld = gardenData.flowers.map((f, i) => {
    const r = mulberry32(hashStr('f' + f.id));
    return {
      ...f,
      wx: (i + 0.5) * (worldW / n) + (r() - 0.5) * 30,
      wy: H - 8 - r() * 40,
      sway: r() * TAU,
    };
  });
  gardenCam.min = 0;
  gardenCam.max = Math.max(0, worldW - W);
  gardenCam.x = gardenCam.max / 2;
}
function closeGarden() { hide('gtip'); toMenu(); }

function onGardenDragStart(e) {
  if (state !== ST.GARDEN) return;
  gardenDrag.on = true;
  gardenDrag.startX = e.clientX;
  gardenDrag.camStart = gardenCam.x;
}
function onGardenDragMove(e) {
  if (state !== ST.GARDEN || !gardenDrag.on) return;
  gardenCam.x = clamp(gardenDrag.camStart - (e.clientX - gardenDrag.startX), gardenCam.min, gardenCam.max);
}
window.addEventListener('wheel', (e) => {
  if (state !== ST.GARDEN) return;
  gardenCam.x = clamp(gardenCam.x + (e.deltaX || e.deltaY) * 0.9, gardenCam.min, gardenCam.max);
}, { passive: true });

function onGardenHover(e) {
  if (state !== ST.GARDEN || gardenDrag.on) { if (state !== ST.GARDEN) return; }
  const tip = $('gtip');
  const wx = e.clientX + gardenCam.x;
  let best = null, bd = 42 * 42;
  for (const f of gardenWorld) {
    const dx = f.wx - wx, dy = (f.wy - 50 * f.size) - e.clientY;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = f; }
  }
  if (best) {
    tip.innerHTML = `<b>${escapeHtml(best.name)}</b> · ${Number(best.score).toLocaleString()} light<br>` +
      `<span class="dim small">night of ${escapeHtml(best.day)}</span>` +
      (best.message ? `<br><span class="msg">“${escapeHtml(best.message)}”</span>` : '');
    tip.style.left = clamp(e.clientX + 14, 8, W - 260) + 'px';
    tip.style.top = clamp(e.clientY - 10, 60, H - 120) + 'px';
    tip.classList.remove('hidden');
  } else tip.classList.add('hidden');
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function renderGarden(dt) {
  // fireflies in the garden too
  const spr = glowSprite(55);
  for (const a of ambient) {
    a.x += Math.sin(nowT * a.v + a.p) * 14 * dt;
    a.y += Math.cos(nowT * a.v * 0.8 + a.p) * 10 * dt;
    cx.globalAlpha = 0.3 + 0.4 * Math.abs(Math.sin(nowT * a.v + a.p));
    const s = a.s * 7;
    cx.drawImage(spr, a.x - s / 2, a.y - s / 2, s, s);
  }
  cx.globalAlpha = 1;

  cx.save();
  cx.translate(-gardenCam.x, 0);
  for (const f of gardenWorld) {
    if (f.wx < gardenCam.x - 80 || f.wx > gardenCam.x + W + 80) continue;
    drawFlower(cx, f.wx, f.wy, Number(f.size), Number(f.hue), Number(f.petals), 1, nowT + f.sway);
  }
  cx.restore();

  if (gardenWorld.length === 0 && gardenData.loaded) {
    cx.fillStyle = 'rgba(244,238,252,.55)';
    cx.font = 'italic 18px Georgia, serif';
    cx.textAlign = 'center';
    cx.fillText('an empty meadow, waiting for its first flower…', W / 2, H * 0.6);
  }
}

// ---------------------------------------------------------- leaderboard + submit
async function loadBoard(listId) {
  const el = $(listId);
  try {
    const res = await fetch('/api/scores?day=' + DAY);
    const data = await res.json();
    if (!data.top || data.top.length === 0) {
      el.innerHTML = '<li class="dim">no one has survived tonight yet — be the first ✨</li>';
      return;
    }
    const myName = localStorage.getItem('mb_name') || '';
    el.innerHTML = data.top.map((r) =>
      `<li${r.name === myName ? ' class="me"' : ''}><span class="nm">${escapeHtml(r.name)}</span><em>${Number(r.score).toLocaleString()}</em></li>`
    ).join('');
  } catch {
    el.innerHTML = '<li class="dim">the stars are quiet (offline)</li>';
  }
}

async function plantAndSubmit() {
  const btn = $('btn-plant');
  const status = $('plant-status');
  const name = $('inp-name').value.trim().slice(0, 20) || 'Anonymous';
  const message = $('inp-msg').value.trim().slice(0, 60);
  localStorage.setItem('mb_name', name);
  btn.disabled = true;
  status.textContent = 'planting…';
  try {
    const b = game.best;
    await Promise.all([
      fetch('/api/scores', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day: DAY, name, score: game.score, combo: game.bestCombo, flowers: game.caught }),
      }),
      fetch('/api/garden', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day: DAY, name, hue: b.hue, petals: b.petals, size: b.size, score: game.score, message }),
      }),
    ]);
    status.textContent = '🌸 planted — your flower now lives in the World Garden';
    chime(7, 0.12); chime(9, 0.09);
    loadBoard('over-board-list');
  } catch {
    status.textContent = 'could not reach the garden — try again?';
    btn.disabled = false;
  }
}

function shareResult() {
  const blooms = '🌸'.repeat(clamp(Math.round(game.caught / 10), 1, 10));
  const text = `🌙 Moonbloom — Night #${NIGHT_NUM}\n✨ ${game.score.toLocaleString()} light · ×${game.bestCombo} chain\n${blooms} ${game.caught} flowers grown\n${location.origin}`;
  if (navigator.share) {
    navigator.share({ text }).catch(() => copyText(text));
  } else copyText(text);
}
function copyText(t) {
  navigator.clipboard?.writeText(t).then(
    () => toast('copied — go light up someone\'s feed ✨'),
    () => toast('could not copy'),
  );
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

// ---------------------------------------------------------- show/hide
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }

// ---------------------------------------------------------- wire up
$('btn-play').addEventListener('click', () => { audio(); startRun(false); });
$('btn-zen').addEventListener('click', () => { audio(); startRun(true); });
$('btn-garden').addEventListener('click', openGarden);
$('btn-gback').addEventListener('click', closeGarden);
$('btn-quit').addEventListener('click', quitRun);
$('btn-again').addEventListener('click', () => startRun(zen));
$('btn-tomenu').addEventListener('click', toMenu);
$('btn-plant').addEventListener('click', plantAndSubmit);
$('btn-share').addEventListener('click', shareResult);

// ---------------------------------------------------------- main loop
function frame(ts) {
  const dt = Math.min(0.05, (ts - lastFrame) / 1000);
  lastFrame = ts;
  nowT += dt;
  if (state === ST.PLAY) updatePlay(dt);
  render(dt);
  if (state === ST.OVER) drawBestFlowerPreview();
  requestAnimationFrame(frame);
}

resize();
resetAmbient();
buildMenuMeadow();
loadBoard('menu-board-list');
requestAnimationFrame(frame);
