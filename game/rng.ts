/**
 * Deterministic, allocation-free PRNG.
 *
 * Every player who flies on the same date gets *the exact same garden*, which
 * is what makes the daily leaderboard meaningful (and makes ghost replays line
 * up perfectly with your own run).
 */

export type Rng = () => number;

/** xmur3 string hash -> 32-bit seed */
export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32 — tiny, fast, good enough distribution for level generation */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(seedText: string): Rng {
  return mulberry32(hashSeed(seedText));
}

/** float in [min,max) */
export function range(r: Rng, min: number, max: number): number {
  return min + r() * (max - min);
}

/** int in [min,max] */
export function rangeInt(r: Rng, min: number, max: number): number {
  return Math.floor(min + r() * (max - min + 1));
}

export function pick<T>(r: Rng, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length) % arr.length];
}

export function chance(r: Rng, p: number): boolean {
  return r() < p;
}

/**
 * The daily seed. Uses UTC so the whole world flies the same garden at the
 * same moment and the leaderboard resets for everyone simultaneously.
 */
export function dailySeed(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Milliseconds until the next daily garden grows (UTC midnight). */
export function msUntilNextSeed(now: Date = new Date()): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return next - now.getTime();
}
