/**
 * Server-side sanity checks.
 *
 * We can't stop a determined cheater without running the whole simulation on
 * the server, but we *can* make every physically impossible score bounce —
 * and because the dawn rises on a fixed curve, "how far could anyone possibly
 * have climbed in N seconds" has an exact closed-form answer.
 */

import { dawnDistance, RULES, UNITS_PER_METRE } from "@/game/config";
import { decodePath, GHOST_MAX_SECONDS } from "@/game/ghost";

export { dawnDistance };

export interface SubmitPayload {
  seed: string;
  name: string;
  player: string;
  score: number;
  metres: number;
  pollen: number;
  blooms: number;
  bestCombo: number;
  duration: number;
  replay: string;
}

export type Validation =
  | { ok: true; value: SubmitPayload }
  | { ok: false; error: string };

const NAME_OK = /^[\p{L}\p{N} '._-]{1,16}$/u;

export function sanitizeName(raw: unknown): string {
  let s = typeof raw === "string" ? raw : "";
  s = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, 16);
  if (!s || !NAME_OK.test(s)) s = "Moth";
  return s;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export function validateSubmission(body: unknown, expectedSeeds: string[]): Validation {
  if (!body || typeof body !== "object") return { ok: false, error: "bad body" };
  const b = body as Record<string, unknown>;

  const seed = String(b.seed ?? "");
  if (!expectedSeeds.includes(seed)) {
    return { ok: false, error: "that garden is not in bloom right now" };
  }

  const player = String(b.player ?? "");
  if (!/^[a-z0-9-]{8,64}$/i.test(player)) return { ok: false, error: "bad player id" };

  const duration = num(b.duration);
  const score = Math.floor(num(b.score));
  const metres = Math.floor(num(b.metres));
  const pollen = Math.floor(num(b.pollen));
  const blooms = Math.floor(num(b.blooms));
  const bestCombo = Math.floor(num(b.bestCombo));

  if (
    [duration, score, metres, pollen, blooms, bestCombo].some((n) => !Number.isFinite(n))
  ) {
    return { ok: false, error: "bad numbers" };
  }
  if (duration < 0.5 || duration > GHOST_MAX_SECONDS + 5) {
    return { ok: false, error: "impossible flight time" };
  }
  if (score < 0 || metres < 0 || pollen < 0 || blooms < 0) {
    return { ok: false, error: "negative" };
  }
  if (bestCombo > RULES.comboMax) return { ok: false, error: "impossible combo" };

  // --- altitude must match the dawn curve (+5% slack for frame jitter)
  const maxMetres = (dawnDistance(duration) / UNITS_PER_METRE) * 1.05 + 5;
  if (metres > maxMetres) return { ok: false, error: "impossible altitude" };

  // --- pollen is physically bounded by how much garden you flew through
  const maxPollen = Math.ceil(maxMetres / 4) + 12;
  if (pollen > maxPollen) return { ok: false, error: "impossible pollen" };

  // --- and the score has to add up from its parts
  const maxScore =
    metres * RULES.metreScore +
    pollen * RULES.pollenScore * RULES.comboMax +
    blooms * RULES.bloomScore +
    10;
  if (score > maxScore) return { ok: false, error: "score does not add up" };

  // --- the replay has to be a real flight of roughly the right length
  const replay = typeof b.replay === "string" ? b.replay : "";
  if (replay.length > 120_000) return { ok: false, error: "replay too large" };
  let keep = replay;
  if (replay) {
    const { path, duration: rd } = decodePath(replay);
    if (path.length === 0) keep = "";
    else if (Math.abs(rd - duration) > Math.max(2, duration * 0.12)) {
      return { ok: false, error: "replay does not match the flight" };
    }
  }

  return {
    ok: true,
    value: {
      seed,
      player,
      name: sanitizeName(b.name),
      score,
      metres,
      pollen,
      blooms,
      bestCombo,
      duration: +duration.toFixed(2),
      replay: keep,
    },
  };
}
