/**
 * Renders real frames of the game to PNG, headlessly.
 *
 * Runs the actual engine against a native 2D canvas, flies an autopilot for
 * N seconds, and writes the frame out. Used both as a visual regression
 * check and to produce the screenshots in the README.
 *
 *   npx tsx scripts/shot.ts [seconds] [out.png] [width] [height]
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const fontDir = join(process.cwd(), "public", "fonts");
if (existsSync(fontDir)) {
  for (const f of readdirSync(fontDir)) {
    try {
      GlobalFonts.registerFromPath(join(fontDir, f), f.startsWith("inter") ? "Inter" : "Fraunces");
    } catch {
      /* non-fatal: the art is what we're looking at */
    }
  }
}

const g = globalThis as any;
g.document = {
  createElement: (tag: string) =>
    tag === "canvas" ? (createCanvas(1, 1) as any) : {},
  body: { style: {} },
};
g.window = {
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 900,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  matchMedia: () => ({ matches: false }),
};
g.requestAnimationFrame = () => 0;
g.cancelAnimationFrame = () => undefined;
g.performance = { now: () => Date.now() };

async function main() {
  const seconds = Number(process.argv[2] ?? 20);
  const out = process.argv[3] ?? "shots/frame.png";
  const W = Number(process.argv[4] ?? 1280);
  const H = Number(process.argv[5] ?? 860);
  const hold = process.argv[6] === "center";

  const { Game } = await import("../game/engine");
  const { GameAudio } = await import("../game/audio");
  const { residentGhosts } = await import("../game/residents");
  const { dailySeed } = await import("../game/rng");
  const { FIELD_H, HALF_W } = await import("../game/config");

  const surface = createCanvas(W, H);
  (surface as any).style = {};
  (surface as any).parentElement = { clientWidth: W, clientHeight: H };

  const seed = dailySeed();
  const game = new Game({
    canvas: surface as any,
    seed,
    audio: new GameAudio(),
    fontFamily: "Inter, sans-serif",
    onEnd: () => undefined,
  });

  game.mount();
  game.setGhosts(residentGhosts(seed, 4));
  const any = game as any;
  any.launch();

  const STEP = 1 / 120;
  const steps = Math.round(seconds * 120);
  for (let i = 0; i < steps; i++) {
    // autopilot: chase the nearest pollen, keep a safe cushion above the dawn
    let bx = 0;
    let by = any.camY + FIELD_H * 0.5;
    let bestD = Infinity;
    for (const ch of any.world.live()) {
      for (const tr of ch.treasure) {
        if (tr.taken || tr.kind !== "pollen") continue;
        const dy = tr.y - any.my;
        if (dy < -40) continue;
        const d = Math.hypot(tr.x - any.mx, dy * 0.5);
        if (d < bestD) {
          bestD = d;
          bx = tr.x;
          by = tr.y;
        }
      }
    }
    any.pointerSeen = true;
    if (hold) {
      bx = Math.sin(i / 220) * 150;
      by = any.camY + FIELD_H * 0.45;
    }
    any.targetX = Math.max(-HALF_W + 10, Math.min(HALF_W - 10, bx));
    any.targetY = Math.max(any.camY + 260, Math.min(any.camY + FIELD_H - 20, by));
    any.glimmers = 3; // keep the camera flying for the screenshot
    any.invuln = Math.max(any.invuln, 0.2);
    any.step(STEP);
  }
  any.render();

  if (process.argv[7] === "zoom") {
    const z = 3;
    const side = 560;
    const sx = any.offX + (any.mx + 360) * any.scale - side / (2 * z);
    const sy = any.offY + (any.fieldH - (any.my - any.camY)) * any.scale - side / (2 * z);
    const zc = createCanvas(side, side);
    const zg = zc.getContext("2d");
    zg.imageSmoothingEnabled = true;
    zg.drawImage(surface as any, sx, sy, side / z, side / z, 0, 0, side, side);
    writeFileSync(out.replace(/\.png$/, "-zoom.png"), zc.toBuffer("image/png"));
  }

  const dir = out.split("/").slice(0, -1).join("/");
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(out, surface.toBuffer("image/png"));
  console.log(
    `  wrote ${out}  ${W}×${H}  t=${seconds}s  alt=${Math.round(any.camY / 10)}m  ` +
      `biome=${any.lastBiome}`,
  );
}

void main();
