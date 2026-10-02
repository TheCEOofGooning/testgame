/**
 * Garden residents.
 *
 * Every social game has the same opening-night problem: the first player to
 * arrive finds an empty room. So each garden comes with a handful of moths
 * who already live there — deterministic flights generated from the same
 * daily seed, identical for everyone, and quietly retired as real players
 * fill the sky.
 *
 * They are generated from the dawn curve, so they share the sky honestly:
 * same altitude at the same second as a real ghost, no cheating allowed.
 */

import { CHUNK_H, dawnDistance, FIELD_H, HALF_W } from "./config";
import { GHOST_HZ, type GhostRun } from "./ghost";
import { mulberry32, hashSeed, range } from "./rng";
import { laneX } from "./world";

const NAMES = [
  "Vesper", "Luna", "Fen", "Tamsin", "Moss", "Pip", "Bramble",
  "Juniper", "Ash", "Wren", "Clover", "Sorrel", "Rook", "Hazel",
];

/** How good each resident is, so the board has a gentle difficulty ladder. */
const TIERS = [0.42, 0.62, 0.82, 1.0];

export function residentGhosts(seed: string, count = 4): GhostRun[] {
  const out: GhostRun[] = [];
  // deterministic shuffle so tonight's residents all have different names
  const nightNames = NAMES.slice();
  const shuffle = mulberry32(hashSeed(`${seed}:names`));
  for (let i = nightNames.length - 1; i > 0; i--) {
    const j = Math.floor(shuffle() * (i + 1));
    [nightNames[i], nightNames[j]] = [nightNames[j], nightNames[i]];
  }

  for (let i = 0; i < count; i++) {
    const r = mulberry32(hashSeed(`${seed}:resident:${i}`));
    const name = nightNames[i % nightNames.length];
    const tier = TIERS[i % TIERS.length];
    const duration = +range(r, 22, 48 + tier * 70).toFixed(2);

    const n = Math.max(8, Math.floor(duration * GHOST_HZ));
    const path = new Float32Array(n * 2);

    // three incommensurate wobbles so the flight never looks like a sine wave
    const w1 = range(r, 0.5, 1.1);
    const w2 = range(r, 1.6, 2.7);
    const w3 = range(r, 3.3, 4.9);
    const p1 = r() * 6.283;
    const p2 = r() * 6.283;
    const p3 = r() * 6.283;
    const sloppiness = 1 - tier;

    for (let s = 0; s < n; s++) {
      const t = s / GHOST_HZ;
      const camY = dawnDistance(t);
      const chunk = camY / CHUNK_H;
      const lane = laneX(seed, Math.floor(chunk + 1.2));
      const wobble =
        Math.sin(t * w1 + p1) * 120 * (0.6 + sloppiness) +
        Math.sin(t * w2 + p2) * 54 * sloppiness +
        Math.sin(t * w3 + p3) * 22;
      const x = clamp(lane + wobble, -HALF_W + 24, HALF_W - 24);

      // better residents ride lower, closer to the dawn, where the view is
      // longer — exactly the line a good human player learns to take
      const height = FIELD_H * (0.52 - tier * 0.16) + Math.sin(t * w2 * 0.7 + p3) * 110;
      const y = camY + clamp(height, 90, FIELD_H - 90);

      path[s * 2] = x;
      path[s * 2 + 1] = y;
    }

    const metres = dawnDistance(duration) / 10;
    const score = Math.round(metres + duration * range(r, 26, 44) * tier);

    out.push({
      id: `resident:${seed}:${i}`,
      name,
      score,
      path,
      duration,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
