/**
 * Headless harness.
 *
 * Stubs just enough of the DOM to boot the real engine in Node, then flies it
 * with an autopilot. Used to prove three things without a browser:
 *   1. a full run (sim + render path) never throws,
 *   2. the difficulty curve produces sane score/altitude numbers,
 *   3. recorded ghosts round-trip and stay inside the server's cheat bounds.
 *
 *   npx tsx scripts/harness.ts
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const noop = () => undefined;

function fakeGradient() {
  return { addColorStop: noop };
}

function fakeCtx(): any {
  const ctx: any = new Proxy(
    {
      canvas: null,
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      fillStyle: "#000",
      strokeStyle: "#000",
      lineWidth: 1,
      lineCap: "butt",
      font: "",
      textAlign: "left",
      textBaseline: "alphabetic",
    },
    {
      get(target, prop) {
        if (prop in target) return (target as any)[prop];
        if (prop === "createLinearGradient" || prop === "createRadialGradient") {
          return fakeGradient;
        }
        if (prop === "measureText") return () => ({ width: 10 });
        if (prop === "getImageData") {
          return () => ({ data: new Uint8ClampedArray(4) });
        }
        return noop;
      },
      set(target, prop, value) {
        (target as any)[prop] = value;
        return true;
      },
    },
  );
  return ctx;
}

function fakeCanvas(w = 800, h = 1200): any {
  const c: any = {
    width: w,
    height: h,
    style: {},
    getContext: () => fakeCtx(),
    parentElement: null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
  };
  return c;
}

const listeners = new Map<string, Set<(e: any) => void>>();

const g = globalThis as any;
g.document = {
  createElement: (tag: string) => (tag === "canvas" ? fakeCanvas(512, 512) : {}),
  body: { style: {} },
  fonts: { ready: Promise.resolve() },
};
g.window = {
  devicePixelRatio: 1,
  innerWidth: 800,
  innerHeight: 1200,
  addEventListener: (k: string, fn: any) => {
    if (!listeners.has(k)) listeners.set(k, new Set());
    listeners.get(k)!.add(fn);
  },
  removeEventListener: (k: string, fn: any) => listeners.get(k)?.delete(fn),
  matchMedia: () => ({ matches: false }),
  AudioContext: undefined,
};
g.requestAnimationFrame = () => 0;
g.cancelAnimationFrame = noop;
g.getComputedStyle = () => ({ fontFamily: "sans-serif" });

/* ------------------------------------------------------------------ */

async function main() {
  const { Game } = await import("../game/engine");
  const { GameAudio } = await import("../game/audio");
  const { dailySeed } = await import("../game/rng");
  const { decodePath } = await import("../game/ghost");
  const { validateSubmission, dawnDistance } = await import("../lib/validate");
  const { FIELD_H, HALF_W, UNITS_PER_METRE } = await import("../game/config");
  const { World } = await import("../game/world");

  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
    if (!ok) failures++;
  };

  /* ---------------- determinism ---------------- */
  console.log("\n— garden determinism");
  const seed = dailySeed();
  const w1 = new World(seed);
  const w2 = new World(seed);
  w1.ensure(0, 4000);
  w2.ensure(0, 4000);
  const a = JSON.stringify([...w1.live()].map((c) => c.hazards.length));
  const b = JSON.stringify([...w2.live()].map((c) => c.hazards.length));
  check("two Worlds with the same seed generate identically", a === b);

  const w3 = new World("different-seed");
  w3.ensure(0, 4000);
  const c3 = JSON.stringify([...w3.live()].map((c) => c.hazards.length));
  check("a different seed grows a different garden", a !== c3);

  let total = 0;
  let hazards = 0;
  let treasure = 0;
  for (const c of w1.live()) {
    total++;
    hazards += c.hazards.length;
    treasure += c.treasure.length;
  }
  check(
    "chunks carry hazards and treasure",
    hazards > 0 && treasure > 0,
    `${total} chunks, ${hazards} hazards, ${treasure} treasure`,
  );
  check("the first chunk is a calm runway", [...w1.live()][0].hazards.length === 0);

  /* ---------------- a full autopiloted flight ---------------- */
  console.log("\n— autopilot flight");
  const audio = new GameAudio(); // never unlocked -> every method no-ops
  let result: any = null;
  const game = new Game({
    canvas: fakeCanvas(800, 1200),
    seed,
    audio,
    fontFamily: "sans-serif",
    onEnd: (r) => (result = r),
  });
  const anyGame = game as any;
  anyGame.sprites = {
    glow: () => fakeCanvas(8, 8),
    frond: () => fakeCanvas(8, 8),
    spark: fakeCanvas(8, 8),
    starsFar: fakeCanvas(8, 8),
    starsNear: fakeCanvas(8, 8),
    darkness: fakeCanvas(8, 8),
  };
  anyGame.resize();
  anyGame.launch();

  const STEP = 1 / 120;
  let steps = 0;
  const maxSteps = 120 * 300;

  while (anyGame.phase !== "done" && steps < maxSteps) {
    // autopilot: steer the light at the nearest uncollected pollen ahead,
    // otherwise sit comfortably above the dawn.
    let bx = 0;
    let by = anyGame.camY + FIELD_H * 0.55;
    let bestD = Infinity;
    for (const ch of anyGame.world.live()) {
      for (const tr of ch.treasure) {
        if (tr.taken || tr.kind !== "pollen") continue;
        const dy = tr.y - anyGame.my;
        if (dy < -60) continue;
        const d = Math.hypot(tr.x - anyGame.mx, dy * 0.6);
        if (d < bestD) {
          bestD = d;
          bx = tr.x;
          by = tr.y;
        }
      }
    }
    anyGame.pointerSeen = true;
    anyGame.targetX = Math.max(-HALF_W + 8, Math.min(HALF_W - 8, bx));
    anyGame.targetY = Math.max(
      anyGame.camY + 180,
      Math.min(anyGame.camY + FIELD_H - 12, by),
    );
    anyGame.step(STEP);
    if (steps % 4 === 0) anyGame.render();
    steps++;
  }

  const secs = steps / 120;
  check("a complete run finishes without throwing", anyGame.phase === "done");
  check("onEnd delivered a result", Boolean(result));
  console.log(
    `        flew ${secs.toFixed(1)}s · ${result?.metres}m · ${result?.score} pts · ` +
      `${result?.pollen} pollen · best chain ×${result?.bestCombo}`,
  );
  check("the autopilot actually dies eventually", secs < 300, `${secs.toFixed(1)}s`);
  check("the autopilot survives long enough to be fun", secs > 12, `${secs.toFixed(1)}s`);
  check("it collected pollen", (result?.pollen ?? 0) > 5);

  /* ---------------- ghost round trip ---------------- */
  console.log("\n— ghost replay");
  const { path, duration } = decodePath(result.replay);
  check("replay decodes", path.length > 0, `${path.length / 2} samples`);
  check(
    "replay duration matches the flight",
    Math.abs(duration - result.duration) < 2,
    `${duration.toFixed(1)}s vs ${result.duration.toFixed(1)}s`,
  );
  const bytes = Math.ceil((result.replay.length * 3) / 4);
  check("replay is tiny", bytes < 24_000, `${(bytes / 1024).toFixed(1)} KB`);
  let maxErr = 0;
  for (let i = 0; i < path.length; i += 2) {
    maxErr = Math.max(maxErr, Math.abs(path[i]) > HALF_W + 2 ? 999 : 0);
  }
  check("replay stays inside the column", maxErr === 0);

  /* ---------------- server validation ---------------- */
  console.log("\n— anti-cheat");
  const honest = {
    seed,
    name: "Autopilot",
    player: "00000000-0000-4000-8000-000000000000",
    score: result.score,
    metres: result.metres,
    pollen: result.pollen,
    blooms: result.blooms,
    bestCombo: result.bestCombo,
    duration: result.duration,
    replay: result.replay,
  };
  check("an honest flight is accepted", validateSubmission(honest, [seed]).ok);
  check(
    "an impossible altitude is rejected",
    !validateSubmission({ ...honest, metres: 999999, score: 999999 }, [seed]).ok,
  );
  check(
    "an inflated score is rejected",
    !validateSubmission({ ...honest, score: result.score * 50 + 10000 }, [seed]).ok,
  );
  check(
    "a mismatched replay is rejected",
    !validateSubmission({ ...honest, duration: result.duration + 60 }, [seed]).ok,
  );
  check(
    "a foreign seed is rejected",
    !validateSubmission({ ...honest, seed: "1999-01-01" }, [seed]).ok,
  );

  const dawn60 = dawnDistance(60) / UNITS_PER_METRE;
  console.log(`        dawn reaches ${dawn60.toFixed(0)}m at 60s, ` +
    `${(dawnDistance(180) / UNITS_PER_METRE).toFixed(0)}m at 180s`);

  console.log(
    failures === 0
      ? "\n✓ all harness checks passed\n"
      : `\n✗ ${failures} check(s) failed\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
