/**
 * Procedural garden generation.
 *
 * The garden is an infinite vertical column built from 480-unit chunks. Each
 * chunk is generated from `hash(seed:index)` so it is *perfectly reproducible*
 * — the same on every device, every reload, and for every player on the same
 * day. Nothing about the layout is ever sent over the wire; a 10-character
 * date string is the entire level file.
 */

import {
  CHUNK_H,
  HALF_W,
  biomeAt,
  difficultyAt,
  type Biome,
} from "./config";
import { chance, range, rangeInt, rngFor, type Rng } from "./rng";

export interface Thorn {
  kind: "thorn";
  /** capsule from (x0,y0) to (x1,y1) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
  side: -1 | 1;
  seed: number;
}

export interface Web {
  kind: "web";
  x: number;
  y: number;
  r: number;
  side: -1 | 1;
  seed: number;
}

export interface Drop {
  kind: "drop";
  x: number;
  y: number;
  /** falling speed, units/sec */
  vy: number;
  r: number;
  /** so a drop that has fallen past the player can be recycled upward */
  spawnY: number;
}

export interface Gust {
  kind: "gust";
  y: number;
  h: number;
  dir: -1 | 1;
  strength: number;
  seed: number;
}

export interface Spider {
  kind: "spider";
  /** thread line */
  y: number;
  xa: number;
  xb: number;
  speed: number;
  phase: number;
  r: number;
}

export interface Pollen {
  kind: "pollen";
  x: number;
  y: number;
  phase: number;
  taken: boolean;
}

export interface Bloom {
  kind: "bloom";
  x: number;
  y: number;
  r: number;
  petals: number;
  seed: number;
  taken: boolean;
}

export type Hazard = Thorn | Web | Drop | Gust | Spider;
export type Treasure = Pollen | Bloom;

export interface Decor {
  x: number;
  y: number;
  s: number;
  /** parallax depth 0.15 (far) .. 0.6 (near) */
  depth: number;
  kind: 0 | 1 | 2;
  seed: number;
}

export interface Chunk {
  index: number;
  /** world Y of the chunk floor (y grows upward) */
  y0: number;
  y1: number;
  biome: Biome;
  hazards: Hazard[];
  treasure: Treasure[];
  decor: Decor[];
  /** the "intended" safe lane through this chunk, for generation sanity */
  pathX: number;
}

const MIN_GAP = 178;

/** Smooth, deterministic lane position so the garden has a readable flow. */
export function laneX(seedText: string, index: number): number {
  const a = rngFor(`${seedText}:lane:${Math.floor(index / 3)}`)();
  const b = rngFor(`${seedText}:lane:${Math.floor(index / 3) + 1}`)();
  const t = (index % 3) / 3;
  const e = t * t * (3 - 2 * t); // smoothstep
  const v = a + (b - a) * e;
  return (v * 2 - 1) * (HALF_W - 120);
}

function weightedHazard(r: Rng, b: Biome): keyof Biome["weights"] {
  const w = b.weights;
  const total = w.thorn + w.web + w.drop + w.gust + w.spider;
  let n = r() * total;
  if ((n -= w.thorn) < 0) return "thorn";
  if ((n -= w.web) < 0) return "web";
  if ((n -= w.drop) < 0) return "drop";
  if ((n -= w.gust) < 0) return "gust";
  return "spider";
}

export function generateChunk(seedText: string, index: number): Chunk {
  const r = rngFor(`${seedText}#${index}`);
  const biome = biomeAt(index);
  const diff = difficultyAt(index);
  const y0 = index * CHUNK_H;
  const y1 = y0 + CHUNK_H;
  const pathX = laneX(seedText, index);

  const hazards: Hazard[] = [];
  const treasure: Treasure[] = [];
  // Background foliage is *not* stored per chunk: each parallax layer scrolls
  // at its own rate, so the renderer streams it from its own deterministic
  // row index instead (see `decorRow`).
  const decor: Decor[] = [];

  // --- the first two chunks are a gentle, hazard-free "learn to fly" runway
  const calm = index < 2;

  const hazardCount = calm ? 0 : rangeInt(r, 2, 2 + Math.round(diff * 3));

  for (let i = 0; i < hazardCount; i++) {
    const y = y0 + ((i + 0.5) / hazardCount) * CHUNK_H + range(r, -48, 48);
    const kind = weightedHazard(r, biome);

    if (kind === "thorn") {
      // A branch reaching in from one wall. Length is capped so the lane
      // always keeps a flyable gap.
      const side: -1 | 1 = pathX > 0 ? -1 : 1;
      const flip = chance(r, 0.35) ? ((side * -1) as -1 | 1) : side;
      const wallX = flip * HALF_W;
      const gapEdge = pathX + flip * MIN_GAP * 0.5;
      let len = Math.abs(wallX - gapEdge);
      len = Math.min(len, HALF_W * (0.55 + diff * 0.5));
      len = Math.max(len, 70);
      const tilt = range(r, -0.34, 0.34);
      hazards.push({
        kind: "thorn",
        x0: wallX,
        y0: y,
        x1: wallX - flip * len,
        y1: y + Math.sin(tilt) * len,
        r: range(r, 12, 19),
        side: flip,
        seed: r() * 1000,
      });
      continue;
    }

    if (kind === "web") {
      const side: -1 | 1 = chance(r, 0.5) ? -1 : 1;
      const rad = range(r, 95, 95 + diff * 85);
      hazards.push({
        kind: "web",
        x: side * (HALF_W - rad * range(r, 0.25, 0.6)),
        y,
        r: rad,
        side,
        seed: r() * 1000,
      });
      continue;
    }

    if (kind === "drop") {
      const n = rangeInt(r, 2, 3 + Math.round(diff * 3));
      for (let d = 0; d < n; d++) {
        const x = range(r, -HALF_W + 30, HALF_W - 30);
        const sy = y + range(r, 0, CHUNK_H * 0.5);
        hazards.push({
          kind: "drop",
          x,
          y: sy,
          spawnY: sy,
          vy: range(r, 300, 430 + diff * 220),
          r: range(r, 7, 11),
        });
      }
      continue;
    }

    if (kind === "gust") {
      hazards.push({
        kind: "gust",
        y,
        h: range(r, 150, 290),
        dir: chance(r, 0.5) ? -1 : 1,
        strength: range(r, 230, 230 + diff * 420),
        seed: r() * 1000,
      });
      continue;
    }

    // spider
    const span = range(r, 170, 330);
    const cx = clampLane(range(r, -HALF_W + span / 2, HALF_W - span / 2));
    hazards.push({
      kind: "spider",
      y,
      xa: cx - span / 2,
      xb: cx + span / 2,
      speed: range(r, 0.35, 0.35 + diff * 0.75),
      phase: r() * Math.PI * 2,
      r: 17,
    });
  }

  // --- pollen: strung along the lane like a necklace, rewarding good lines
  const strands = rangeInt(r, 2, 3);
  for (let s = 0; s < strands; s++) {
    const n = rangeInt(r, 3, 6);
    const baseY = y0 + range(r, 20, CHUNK_H - 140);
    const baseX = clampLane(pathX + range(r, -150, 150));
    const curve = range(r, -1, 1);
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1);
      treasure.push({
        kind: "pollen",
        x: clampLane(baseX + Math.sin(t * Math.PI) * curve * 150),
        y: baseY + t * range(r, 90, 150),
        phase: r() * Math.PI * 2,
        taken: false,
      });
    }
  }

  // --- a bloom (heals a glimmer) roughly every third chunk
  if (!calm && chance(r, 0.34)) {
    treasure.push({
      kind: "bloom",
      x: clampLane(pathX + range(r, -180, 180)),
      y: y0 + range(r, 80, CHUNK_H - 80),
      r: 46,
      petals: rangeInt(r, 5, 8),
      seed: r() * 1000,
      taken: false,
    });
  }

  return { index, y0, y1, biome, hazards, treasure, decor, pathX };
}

function clampLane(x: number): number {
  const m = HALF_W - 54;
  return x < -m ? -m : x > m ? m : x;
}

/**
 * Keeps a rolling window of chunks alive around the camera. Chunks below the
 * window are dropped, so memory is O(1) no matter how high you climb.
 */
export class World {
  readonly seed: string;
  private chunks = new Map<number, Chunk>();
  private lo = 0;
  private hi = -1;

  constructor(seed: string) {
    this.seed = seed;
  }

  /** Ensure chunks covering [yBottom, yTop] exist; recycle the rest. */
  ensure(yBottom: number, yTop: number): void {
    const lo = Math.max(0, Math.floor(yBottom / CHUNK_H) - 1);
    const hi = Math.floor(yTop / CHUNK_H) + 1;
    for (let i = lo; i <= hi; i++) {
      if (!this.chunks.has(i)) this.chunks.set(i, generateChunk(this.seed, i));
    }
    for (const key of this.chunks.keys()) {
      if (key < lo - 1 || key > hi + 1) this.chunks.delete(key);
    }
    this.lo = lo;
    this.hi = hi;
  }

  *live(): Generator<Chunk> {
    for (let i = this.lo; i <= this.hi; i++) {
      const c = this.chunks.get(i);
      if (c) yield c;
    }
  }

  get count(): number {
    return this.chunks.size;
  }
}
