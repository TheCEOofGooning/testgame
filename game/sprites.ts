/**
 * Everything the renderer draws is baked once into small offscreen canvases
 * at boot. Per-frame we only ever call drawImage / fillRect — no
 * createRadialGradient, no shadowBlur, no filters in the hot loop. That is
 * most of the reason the game holds 60fps on a four-year-old phone.
 */

import { mulberry32 } from "./rng";

type Canvas = HTMLCanvasElement;

function surface(w: number, h: number): { c: Canvas; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  return { c, g };
}

/** Soft additive glow blob. `stops` are [offset, rgba] pairs. */
export function makeGlow(
  radius: number,
  color: string,
  falloff = 1,
): Canvas {
  const d = radius * 2;
  const { c, g } = surface(d, d);
  const grad = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  const [r, gg, b] = parseColor(color);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const a = Math.pow(1 - t, 2.2 * falloff);
    grad.addColorStop(t, `rgba(${r},${gg},${b},${a.toFixed(4)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, d, d);
  return c;
}

/** A crisp little four-point sparkle, used for pollen and impact bursts. */
export function makeSpark(radius: number, color: string): Canvas {
  const d = radius * 2;
  const { c, g } = surface(d, d);
  const [r, gg, b] = parseColor(color);
  const grad = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  grad.addColorStop(0, "rgba(255,255,255,0.98)");
  grad.addColorStop(0.16, `rgba(${r},${gg},${b},0.85)`);
  grad.addColorStop(0.42, `rgba(${r},${gg},${b},0.26)`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, d, d);

  // the faintest four-point glint, so motes twinkle instead of looking
  // like plus signs stamped on the sky
  g.globalCompositeOperation = "lighter";
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
  ] as const) {
    const lin = g.createLinearGradient(
      radius - dx * radius, radius - dy * radius,
      radius + dx * radius, radius + dy * radius,
    );
    lin.addColorStop(0, "rgba(255,255,255,0)");
    lin.addColorStop(0.5, "rgba(255,255,255,0.3)");
    lin.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = lin;
    const th = Math.max(1, radius * 0.07);
    if (dx) g.fillRect(0, radius - th / 2, d, th);
    else g.fillRect(radius - th / 2, 0, th, d);
  }
  return c;
}

/**
 * The darkness sprite: transparent at the centre, opaque at the rim. Drawn
 * centred on your light, it *is* the lantern — the garden only exists where
 * you are shining.
 */
export function makeDarkness(radius: number, alpha: number): Canvas {
  const d = radius * 2;
  const { c, g } = surface(d, d);
  const grad = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  grad.addColorStop(0, "rgba(2,4,10,0)");
  grad.addColorStop(0.16, "rgba(2,4,10,0)");
  grad.addColorStop(0.34, `rgba(2,4,10,${(alpha * 0.2).toFixed(3)})`);
  grad.addColorStop(0.56, `rgba(2,4,10,${(alpha * 0.62).toFixed(3)})`);
  grad.addColorStop(0.78, `rgba(2,4,10,${(alpha * 0.93).toFixed(3)})`);
  grad.addColorStop(1, `rgba(2,4,10,${alpha.toFixed(3)})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, d, d);
  return c;
}

/** A tileable field of stars, parallaxed behind the garden. */
export function makeStarfield(w: number, h: number, seed: number): Canvas {
  const { c, g } = surface(w, h);
  const r = mulberry32(seed);
  const n = Math.round((w * h) / 5200);
  for (let i = 0; i < n; i++) {
    const x = r() * w;
    const y = r() * h;
    const s = 0.4 + r() * 1.5;
    const a = 0.18 + r() * 0.7;
    const warm = r() < 0.25;
    g.fillStyle = warm
      ? `rgba(255,232,196,${a.toFixed(3)})`
      : `rgba(206,228,255,${a.toFixed(3)})`;
    g.beginPath();
    g.arc(x, y, s, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** Background foliage silhouettes: fern, grass tuft, seed-head, bellflower. */
export function makeFoliage(kind: 0 | 1 | 2 | 3, color: string, seed: number): Canvas {
  const size = 200;
  const { c, g } = surface(size, size);
  const r = mulberry32(seed);
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineCap = "round";
  g.lineJoin = "round";
  const cx = size / 2;

  if (kind === 0) {
    // fern frond — rounded leaflets, not spikes
    const lean = (r() * 2 - 1) * 26;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx, size);
    g.quadraticCurveTo(cx + lean * 0.4, size * 0.5, cx + lean, 18);
    g.stroke();
    for (let i = 0; i < 13; i++) {
      const t = i / 13;
      const y = size - 14 - t * (size - 30);
      const x = cx + lean * t * t;
      const len = 44 * Math.sin(Math.PI * (0.15 + t * 0.8)) + 7;
      for (const s2 of [-1, 1] as const) {
        g.beginPath();
        g.ellipse(x + s2 * len * 0.5, y - len * 0.22, len * 0.5, len * 0.21, s2 * -0.5, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if (kind === 1) {
    // grass tuft — fine tapering blades
    for (let i = 0; i < 11; i++) {
      const lean = (r() * 2 - 1) * 52;
      const h = size * (0.45 + r() * 0.52);
      const base = cx + (r() * 2 - 1) * 24;
      const w = 2 + r() * 2.6;
      g.beginPath();
      g.moveTo(base - w, size);
      g.quadraticCurveTo(base + lean * 0.35, size - h * 0.55, base + lean, size - h);
      g.quadraticCurveTo(base + lean * 0.35 + w * 0.6, size - h * 0.55, base + w, size);
      g.closePath();
      g.fill();
    }
  } else if (kind === 2) {
    // dandelion seed-head
    g.lineWidth = 3.4;
    g.beginPath();
    g.moveTo(cx, size);
    g.quadraticCurveTo(cx + 12, size * 0.68, cx, size * 0.44);
    g.stroke();
    g.lineWidth = 1.8;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const rad = 26 + r() * 12;
      g.beginPath();
      g.moveTo(cx, size * 0.42);
      g.lineTo(cx + Math.cos(a) * rad, size * 0.42 + Math.sin(a) * rad);
      g.stroke();
      g.beginPath();
      g.arc(cx + Math.cos(a) * rad, size * 0.42 + Math.sin(a) * rad, 2.1, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // bellflower stem — drooping bells
    const lean = (r() * 2 - 1) * 30;
    g.lineWidth = 3.6;
    g.beginPath();
    g.moveTo(cx, size);
    g.quadraticCurveTo(cx + lean, size * 0.55, cx + lean * 1.4, size * 0.16);
    g.stroke();
    for (let i = 0; i < 5; i++) {
      const t = 0.2 + (i / 5) * 0.72;
      const x = cx + lean * (t * 1.4);
      const y = size - t * size * 0.86;
      const s2 = i % 2 === 0 ? 1 : -1;
      g.beginPath();
      g.ellipse(x + s2 * 13, y + 9, 10, 14, s2 * 0.4, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + s2 * 11, y + 2);
      g.stroke();
      g.lineWidth = 3.6;
    }
  }

  // Dissolve the base into shadow. Without this every plant ends in a hard
  // horizontal cut wherever its sprite box happens to land, which reads as
  // a rectangle floating in the sky.
  g.globalCompositeOperation = "destination-out";
  const fade = g.createLinearGradient(0, size * 0.62, 0, size);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(0,0,0,1)");
  g.fillStyle = fade;
  g.fillRect(0, size * 0.62, size, size * 0.38);
  return c;
}

export function parseColor(c: string): [number, number, number] {
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((h) => h + h)
            .join("")
        : hex;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/\d+/g);
  if (m && m.length >= 3) return [+m[0], +m[1], +m[2]];
  return [255, 255, 255];
}

export function rgba(c: string, a: number): string {
  const [r, g, b] = parseColor(c);
  return `rgba(${r},${g},${b},${a})`;
}

/** Snap a colour to a 16-step grid so animated blends can't blow up a
 *  sprite cache with thousands of near-identical keys. */
export function quantize(c: string, step = 16): string {
  const [r, g, b] = parseColor(c);
  const q = (v: number) => Math.min(255, Math.round(v / step) * step);
  return `rgb(${q(r)},${q(g)},${q(b)})`;
}

export function mixColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parseColor(a);
  const [r2, g2, b2] = parseColor(b);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(
    g1 + (g2 - g1) * t,
  )},${Math.round(b1 + (b2 - b1) * t)})`;
}

/** Lazily-built, globally shared sprite cache. */
export class SpriteCache {
  private glows = new Map<string, Canvas>();
  private foliage = new Map<string, Canvas>();
  readonly spark: Canvas;
  readonly starsFar: Canvas;
  readonly starsNear: Canvas;
  readonly darkness: Canvas;

  /** The darkness sprite is baked small and upscaled at draw time — a
   *  gradient this soft loses nothing and we save ~18 MB of VRAM. */
  static readonly DARK_ALPHA = 0.9;

  constructor() {
    this.spark = makeSpark(32, "#ffe9b0");
    this.starsFar = makeStarfield(512, 512, 1337);
    this.starsNear = makeStarfield(512, 512, 90210);
    this.darkness = makeDarkness(448, SpriteCache.DARK_ALPHA);
  }

  glow(radius: number, color: string, falloff = 1): Canvas {
    const k = `${radius}|${color}|${falloff}`;
    let c = this.glows.get(k);
    if (!c) {
      c = makeGlow(radius, color, falloff);
      this.glows.set(k, c);
    }
    return c;
  }

  frond(kind: 0 | 1 | 2 | 3, color: string, seed: number): Canvas {
    const bucket = Math.floor(seed) % 4;
    const k = `${kind}|${color}|${bucket}`;
    let c = this.foliage.get(k);
    if (!c) {
      // Biome colours blend continuously, so the key space is unbounded over
      // a long climb. Cap the cache rather than slowly eating memory.
      if (this.foliage.size > 56) this.foliage.clear();
      c = makeFoliage(kind, color, bucket * 7919 + kind * 31 + 101);
      this.foliage.set(k, c);
    }
    return c;
  }
}
