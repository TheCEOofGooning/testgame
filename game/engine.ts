/**
 * MOTHLIGHT — simulation + renderer.
 *
 * Design notes that matter:
 *  • Fixed 120 Hz simulation step with an accumulator, so physics is identical
 *    on a 60 Hz laptop and a 144 Hz monitor — essential when the leaderboard
 *    is global and runs are replayed as ghosts.
 *  • Zero allocations in the hot loop: particles are pooled, sprites are
 *    pre-baked, the trail is a ring buffer.
 *  • The renderer only ever calls drawImage / fillRect / simple paths. No
 *    shadowBlur, no filters, no per-frame gradients except one sky fill.
 */

import { GameAudio } from "./audio";
import {
  CAM,
  CHUNK_H,
  CHUNKS_PER_BIOME,
  FIELD_H,
  FIELD_W,
  MAX_VIEW_H,
  MIN_VIEW_H,
  HALF_W,
  LIGHT,
  MOTH,
  RULES,
  UNITS_PER_METRE,
  BIOMES,
  type Biome,
} from "./config";
import { ghostAt, GhostRecorder, type GhostRun } from "./ghost";
import { mulberry32 } from "./rng";
import { mixColor, quantize, rgba, SpriteCache } from "./sprites";
import { World, type Chunk } from "./world";

const STEP = 1 / 120;
const MAX_FRAME = 0.1;

export type Phase = "attract" | "flying" | "settling" | "done";

export interface HudSnapshot {
  score: number;
  metres: number;
  glimmers: number;
  combo: number;
  /** seconds left on the current chain, 0..1 of its window */
  comboLeft: number;
  ghostsAlive: number;
  ghostsTotal: number;
  time: number;
  biome: string;
  /** 0 = safely in the dark, 1 = the dawn is about to take you */
  danger: number;
}

/** The field's on-screen rectangle, in CSS pixels. */
export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** CSS pixels per world unit */
  u: number;
}

export interface RunResult {
  seed: string;
  score: number;
  metres: number;
  pollen: number;
  blooms: number;
  duration: number;
  bestCombo: number;
  ghostsBeaten: number;
  ghostsTotal: number;
  biome: string;
  replay: string;
}

export interface GameOptions {
  canvas: HTMLCanvasElement;
  seed: string;
  audio: GameAudio;
  fontFamily: string;
  reducedMotion?: boolean;
  onEnd: (r: RunResult) => void;
  onHud?: (h: HudSnapshot) => void;
  /** Fired on every resize so a DOM overlay can sit exactly on the field. */
  onViewport?: (r: ViewRect) => void;
  /** Fired once when a new biome is entered, for the DOM banner. */
  onBanner?: (text: string, sub: string) => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
  kind: 0 | 1; // 0 = additive glow, 1 = soft dot
  alive: boolean;
}

const TRAIL_N = 34;

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private audio: GameAudio;
  private opts: GameOptions;
  private sprites!: SpriteCache;

  private world: World;
  seed: string;
  phase: Phase = "attract";

  // --- camera & time
  private camY = 0;
  private camSpeed = CAM.startSpeed;
  private t = 0;
  /** elapsed flight time, frozen the instant the last glimmer goes out */
  private flightT = 0;
  private settleT = 0;

  // --- moth
  private mx = 0;
  private my = CAM.restOffset;
  private mvx = 0;
  private mvy = 0;
  private mothAngle = 0;
  private flutter = 0;
  private invuln = 0;
  private inWeb = 0;

  // --- light
  private lx = 0;
  private ly = CAM.restOffset + 60;
  private targetX = 0;
  private targetY = CAM.restOffset + 60;
  private pointerSeen = false;
  private keys = new Set<string>();

  // --- run state
  private glimmers = RULES.glimmersStart;
  private score = 0;
  private pollenCount = 0;
  private pollenPoints = 0;
  private bloomCount = 0;
  private combo = 0;
  private bestCombo = 0;
  private comboT = 0;
  private dawnT = 0;
  private metres = 0;

  // --- ghosts
  private ghosts: GhostRun[] = [];
  private ghostPos = { x: 0, y: 0 };
  private recorder = new GhostRecorder();

  // --- fx
  private particles: Particle[] = [];
  private trail = new Float32Array(TRAIL_N * 2);
  private trailHead = 0;
  private shake = 0;
  private flash = 0;
  private hurtFlash = 0;
  private banner = { text: "", sub: "", t: 0 };
  private lastBiome = "";

  // --- loop
  private raf = 0;
  private lastTs = 0;
  private acc = 0;
  private running = false;
  private dpr = 1;
  private viewW = 0;
  private viewH = 0;
  private scale = 1;
  private offX = 0;
  private offY = 0;
  /** world-units of garden visible vertically on *this* screen */
  private fieldH = FIELD_H;
  private quality = 1;
  private paused = false;
  private frameAvg = 16;
  private hudAcc = 0;

  constructor(opts: GameOptions) {
    this.opts = opts;
    this.canvas = opts.canvas;
    this.audio = opts.audio;
    this.seed = opts.seed;
    this.world = new World(opts.seed);
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2d canvas unavailable");
    this.ctx = ctx;
    for (let i = 0; i < 560; i++) {
      this.particles.push({
        x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1,
        size: 4, color: "#fff", drag: 1, kind: 0, alive: false,
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* lifecycle                                                          */
  /* ------------------------------------------------------------------ */

  mount(): void {
    this.sprites = new SpriteCache();
    this.resize();
    this.attachInput();
    this.running = true;
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    this.resetAttract();
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.detachInput();
  }

  setGhosts(g: GhostRun[]): void {
    this.ghosts = g;
  }

  /** Freeze the simulation (tab hidden, window blurred) but keep painting. */
  setPaused(p: boolean): void {
    if (this.paused === p) return;
    this.paused = p;
    this.acc = 0;
    this.lastTs = performance.now();
    if (p) this.audio.setClimb(0);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Abandon the current flight and drift back to the title screen. */
  quit(): void {
    this.audio.leaveGarden();
    this.killParticles();
    this.resetAttract();
  }

  launch(): void {
    this.world = new World(this.seed);
    this.camY = 0;
    this.camSpeed = CAM.startSpeed;
    this.t = 0;
    this.flightT = 0;
    this.settleT = 0;
    this.mx = 0;
    this.my = CAM.restOffset;
    this.mvx = 0;
    this.mvy = 0;
    this.invuln = 0;
    this.inWeb = 0;
    this.glimmers = RULES.glimmersStart;
    this.score = 0;
    this.metres = 0;
    this.pollenCount = 0;
    this.pollenPoints = 0;
    this.bloomCount = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.comboT = 0;
    this.dawnT = 0;
    this.shake = 0;
    this.hurtFlash = 0;
    this.flash = 0;
    this.lastBiome = "";
    this.recorder.reset();
    this.killParticles();
    this.lx = this.mx;
    this.ly = this.my + 40;
    this.targetX = this.lx;
    this.targetY = this.ly;
    for (let i = 0; i < TRAIL_N; i++) {
      this.trail[i * 2] = this.mx;
      this.trail[i * 2 + 1] = this.my;
    }
    this.phase = "flying";
    this.audio.enterGarden();
  }

  private resetAttract(): void {
    this.phase = "attract";
    this.world = new World(this.seed);
    this.camY = CHUNK_H * 2;
    this.t = 0;
    this.mx = 0;
    this.my = this.camY + this.fieldH * 0.45;
    this.mvx = 0;
    this.mvy = 0;
    this.glimmers = RULES.glimmersStart;
  }

  /* ------------------------------------------------------------------ */
  /* input                                                              */
  /* ------------------------------------------------------------------ */

  private onPointer = (e: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const fx = (e.clientX - rect.left - this.offX / this.dpr) / this.scaleCss();
    const fy = (e.clientY - rect.top - this.offY / this.dpr) / this.scaleCss();
    const lift = e.pointerType === "touch" ? LIGHT.touchLift : 0;
    this.targetX = clamp(fx - HALF_W, -HALF_W + 8, HALF_W - 8);
    this.targetY = clamp(
      this.camY + (this.fieldH - fy) + lift,
      this.camY + 12,
      this.camY + this.fieldH - 12,
    );
    this.pointerSeen = true;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (
      [
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
        "w", "a", "s", "d", "W", "A", "S", "D", " ",
      ].includes(e.key)
    ) {
      e.preventDefault();
      this.keys.add(e.key.toLowerCase());
      this.pointerSeen = true;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onResize = () => this.resize();

  private onBlur = () => this.keys.clear();

  private attachInput(): void {
    window.addEventListener("pointermove", this.onPointer, { passive: true });
    window.addEventListener("pointerdown", this.onPointer, { passive: true });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("blur", this.onBlur);
  }

  private detachInput(): void {
    window.removeEventListener("pointermove", this.onPointer);
    window.removeEventListener("pointerdown", this.onPointer);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("blur", this.onBlur);
  }

  private scaleCss(): number {
    return this.scale / this.dpr;
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const cw = parent ? parent.clientWidth : window.innerWidth;
    const ch = parent ? parent.clientHeight : window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.viewW = Math.max(1, Math.floor(cw * this.dpr));
    this.viewH = Math.max(1, Math.floor(ch * this.dpr));
    if (this.canvas.width !== this.viewW) this.canvas.width = this.viewW;
    if (this.canvas.height !== this.viewH) this.canvas.height = this.viewH;
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    // Fit the column's width, but never squash the view shorter than
    // MIN_VIEW_H; then let tall screens reveal up to MAX_VIEW_H of extra
    // garden before we letterbox.
    this.scale = Math.min(this.viewW / FIELD_W, this.viewH / MIN_VIEW_H);
    this.fieldH = clamp(this.viewH / this.scale, MIN_VIEW_H, MAX_VIEW_H);
    this.offX = (this.viewW - FIELD_W * this.scale) / 2;
    this.offY = (this.viewH - this.fieldH * this.scale) / 2;
    if (this.opts.onViewport) {
      const u = this.scaleCss();
      this.opts.onViewport({
        x: this.offX / this.dpr,
        y: this.offY / this.dpr,
        w: FIELD_W * u,
        h: this.fieldH * u,
        u,
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* main loop                                                          */
  /* ------------------------------------------------------------------ */

  private tick = (ts: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    if (!(dt > 0)) dt = STEP;
    this.frameAvg += ((dt * 1000) - this.frameAvg) * 0.05;
    if (this.frameAvg > 26 && this.quality > 0.5) this.quality = 0.5;
    else if (this.frameAvg < 18 && this.quality < 1) this.quality = 1;
    if (dt > MAX_FRAME) dt = MAX_FRAME;

    if (this.paused) {
      this.acc = 0;
    } else {
      this.acc += dt;
      let guard = 0;
      while (this.acc >= STEP && guard++ < 12) {
        this.step(STEP);
        this.acc -= STEP;
      }
    }
    this.render();

  };

  private hud(): HudSnapshot {
    return {
      score: Math.floor(this.score),
      metres: Math.floor(this.metres),
      glimmers: this.glimmers,
      combo: this.combo,
      comboLeft: clamp(this.comboT / RULES.comboWindow, 0, 1),
      ghostsAlive: this.ghostsAlive(),
      ghostsTotal: this.ghosts.length,
      time: this.t,
      biome: this.biomeNow().name,
      danger: clamp(this.dawnT / RULES.dawnGrace, 0, 1),
    };
  }

  private ghostsAlive(): number {
    let n = 0;
    for (const g of this.ghosts) if (g.duration > this.t) n++;
    return n;
  }

  /* ------------------------------------------------------------------ */
  /* simulation                                                         */
  /* ------------------------------------------------------------------ */

  private step(dt: number): void {
    this.hudAcc += dt;
    if (this.hudAcc > 0.1 && this.opts.onHud) {
      this.hudAcc = 0;
      this.opts.onHud(this.hud());
    }
    if (this.phase === "attract") return this.stepAttract(dt);
    if (this.phase === "done") return;

    this.t += dt;

    if (this.phase === "settling") {
      this.settleT += dt;
      this.mvy -= 520 * dt;
      this.mvx *= Math.exp(-1.6 * dt);
      this.mx += this.mvx * dt;
      this.my += this.mvy * dt;
      this.camSpeed *= Math.exp(-2.4 * dt);
      this.camY += this.camSpeed * dt;
      this.stepParticles(dt);
      this.pushTrail();
      if (this.settleT > 2.3) this.finish();
      return;
    }

    // ---- the dawn climbs, faster and faster
    this.camSpeed = Math.min(CAM.maxSpeed, CAM.startSpeed + CAM.accel * this.t);
    this.camY += this.camSpeed * dt;
    this.metres = this.camY / UNITS_PER_METRE;
    this.score = this.metres * RULES.metreScore + this.pollenPoints;
    this.audio.setClimb(
      (this.camSpeed - CAM.startSpeed) / (CAM.maxSpeed - CAM.startSpeed),
    );

    this.world.ensure(this.camY - CHUNK_H, this.camY + this.fieldH + CHUNK_H);

    // ---- keyboard nudges the light like a second cursor
    if (this.keys.size) {
      const s = LIGHT.keyboardSpeed * dt;
      if (this.keys.has("arrowleft") || this.keys.has("a")) this.targetX -= s;
      if (this.keys.has("arrowright") || this.keys.has("d")) this.targetX += s;
      if (this.keys.has("arrowup") || this.keys.has("w")) this.targetY += s;
      if (this.keys.has("arrowdown") || this.keys.has("s")) this.targetY -= s;
    }
    if (!this.pointerSeen) {
      this.targetX = 0;
      this.targetY = this.camY + CAM.restOffset + 60;
    }
    this.targetX = clamp(this.targetX, -HALF_W + 8, HALF_W - 8);
    this.targetY = clamp(this.targetY, this.camY + 12, this.camY + this.fieldH - 12);

    const k = 1 - Math.exp(-LIGHT.follow * dt);
    this.lx += (this.targetX - this.lx) * k;
    this.ly += (this.targetY - this.ly) * k;

    // ---- the moth chases the light (underdamped spring = that lovely lag)
    let ax = (this.lx - this.mx) * MOTH.pull;
    let ay = (this.ly - this.my) * MOTH.pull;

    let drag = MOTH.drag;
    if (this.inWeb > 0) {
      this.inWeb -= dt;
      drag = 13;
      ax *= 0.45;
      ay *= 0.45;
    }

    // hazards that push rather than hurt
    for (const c of this.world.live()) {
      for (const h of c.hazards) {
        if (h.kind !== "gust") continue;
        if (this.my > h.y && this.my < h.y + h.h) {
          const edge = Math.min(this.my - h.y, h.y + h.h - this.my);
          const falloff = Math.min(1, edge / 60);
          ax += h.dir * h.strength * falloff;
        }
      }
    }

    this.mvx = (this.mvx + ax * dt) * Math.exp(-drag * dt);
    this.mvy = (this.mvy + ay * dt) * Math.exp(-drag * dt);
    const sp = Math.hypot(this.mvx, this.mvy);
    if (sp > MOTH.maxSpeed) {
      const f = MOTH.maxSpeed / sp;
      this.mvx *= f;
      this.mvy *= f;
    }
    this.mx += this.mvx * dt;
    this.my += this.mvy * dt;

    // glass walls
    const wall = HALF_W - MOTH.radius;
    if (this.mx < -wall) {
      this.mx = -wall;
      this.mvx = Math.abs(this.mvx) * MOTH.restitution;
    } else if (this.mx > wall) {
      this.mx = wall;
      this.mvx = -Math.abs(this.mvx) * MOTH.restitution;
    }
    const ceil = this.camY + this.fieldH - MOTH.radius - 6;
    if (this.my > ceil) {
      this.my = ceil;
      this.mvy = -Math.abs(this.mvy) * MOTH.restitution;
    }

    // ---- the dawn line: linger in the light and the night is over for you
    const dawnLine = this.camY + 46;
    if (this.my < dawnLine) {
      this.dawnT += dt;
      this.my = Math.max(this.my, this.camY - 40);
      if (this.dawnT > RULES.dawnGrace) {
        this.dawnT = 0;
        this.sting(this.mx, this.camY, true);
        this.mvy = 520;
      }
    } else {
      this.dawnT = Math.max(0, this.dawnT - dt * 1.6);
    }

    this.flutter += dt * MOTH.flutterRate * (1 + sp / 400);
    this.mothAngle += (clamp(this.mvx / 900, -0.6, 0.6) - this.mothAngle) * (1 - Math.exp(-8 * dt));

    if (this.invuln > 0) this.invuln -= dt;
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }

    this.collide(dt);
    this.stepParticles(dt);
    this.pushTrail();
    this.recorder.sample(dt, this.mx, this.my);

    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.4);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.8);

    // biome banner
    const b = this.biomeNow();
    if (b.name !== this.lastBiome) {
      this.lastBiome = b.name;
      this.banner = { text: b.name, sub: b.blurb, t: 3.4 };
      this.opts.onBanner?.(b.name, b.blurb);
    }
    if (this.banner.t > 0) this.banner.t -= dt;
  }

  private stepAttract(dt: number): void {
    this.t += dt;
    this.camY += 26 * dt;
    this.world.ensure(this.camY - CHUNK_H, this.camY + this.fieldH + CHUNK_H);
    // a drowsy figure-eight so the title screen is alive
    const a = this.t * 0.42;
    this.lx = Math.sin(a) * 210;
    this.ly = this.camY + this.fieldH * 0.52 + Math.sin(a * 2) * 150;
    const ax = (this.lx - this.mx) * 6;
    const ay = (this.ly - this.my) * 6;
    this.mvx = (this.mvx + ax * dt) * Math.exp(-2.6 * dt);
    this.mvy = (this.mvy + ay * dt) * Math.exp(-2.6 * dt);
    this.mx += this.mvx * dt;
    this.my += this.mvy * dt;
    this.flutter += dt * 7;
    this.mothAngle += (clamp(this.mvx / 700, -0.5, 0.5) - this.mothAngle) * (1 - Math.exp(-6 * dt));
    this.pushTrail();
    this.stepParticles(dt);
    if (Math.random() < dt * 6) {
      this.spawn(
        this.mx + (Math.random() - 0.5) * 30,
        this.my + (Math.random() - 0.5) * 30,
        (Math.random() - 0.5) * 20, 10 + Math.random() * 20,
        1.6, 5, "#ffe7a8", 0,
      );
    }
  }

  /* ----------------------------- collision ---------------------------- */

  private collide(dt: number): void {
    const R = MOTH.radius;
    for (const c of this.world.live()) {
      // --- hazards
      for (const h of c.hazards) {
        if (h.kind === "thorn") {
          if (
            this.invuln <= 0 &&
            segDist(this.mx, this.my, h.x0, h.y0, h.x1, h.y1) < h.r + R
          ) {
            this.sting(this.mx, this.my);
          }
        } else if (h.kind === "web") {
          const d2 = dist2(this.mx, this.my, h.x, h.y);
          if (d2 < h.r * h.r) {
            if (this.inWeb <= 0) {
              this.audio.web();
              this.combo = 0;
              for (let i = 0; i < 8 * this.quality; i++) {
                this.spawn(
                  this.mx, this.my,
                  (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120,
                  0.6, 4, "#cfd9e8", 1,
                );
              }
            }
            this.inWeb = 0.09;
          }
        } else if (h.kind === "spider") {
          const sx = spiderX(h, this.t);
          if (
            this.invuln <= 0 &&
            dist2(this.mx, this.my, sx, h.y) < (h.r + R) * (h.r + R)
          ) {
            this.sting(sx, h.y);
          }
        }
      }

      // --- treasure
      for (const tr of c.treasure) {
        if (tr.taken) continue;
        if (tr.kind === "pollen") {
          const d2 = dist2(this.mx, this.my, tr.x, tr.y);
          if (d2 < 36 * 36) {
            tr.taken = true;
            this.pollenCount++;
            this.combo = Math.min(RULES.comboMax, this.combo + 1);
            this.bestCombo = Math.max(this.bestCombo, this.combo);
            this.comboT = RULES.comboWindow;
            this.pollenPoints += RULES.pollenScore * this.combo;
            this.audio.pollen(this.combo);
            this.flash = Math.min(1, this.flash + 0.22);
            const col = c.biome.pollen;
            for (let i = 0; i < 9 * this.quality; i++) {
              const a = Math.random() * Math.PI * 2;
              const s = 40 + Math.random() * 140;
              this.spawn(tr.x, tr.y, Math.cos(a) * s, Math.sin(a) * s, 0.55, 7, col, 0);
            }
          }
        } else {
          const d2 = dist2(this.mx, this.my, tr.x, tr.y);
          if (d2 < (tr.r + R) * (tr.r + R)) {
            tr.taken = true;
            this.bloomCount++;
            this.pollenPoints += RULES.bloomScore;
            if (this.glimmers < RULES.glimmersMax) this.glimmers++;
            this.audio.bloom();
            this.flash = 1;
            for (let i = 0; i < 40 * this.quality; i++) {
              const a = Math.random() * Math.PI * 2;
              const s = 60 + Math.random() * 260;
              this.spawn(
                tr.x, tr.y, Math.cos(a) * s, Math.sin(a) * s,
                1.1, 8, i % 3 === 0 ? "#ffffff" : c.biome.accent, 0,
              );
            }
          }
        }
      }
    }
  }

  private sting(fx: number, fy: number, byDawn = false): void {
    if (this.invuln > 0) return;
    this.glimmers--;
    this.invuln = MOTH.invuln;
    this.combo = 0;
    this.audio.sting();
    this.shake = this.opts.reducedMotion ? 0.2 : 1;
    this.hurtFlash = 1;
    const dx = this.mx - fx;
    const dy = this.my - fy;
    const d = Math.hypot(dx, dy) || 1;
    const push = byDawn ? 0 : 360;
    this.mvx += (dx / d) * push;
    this.mvy += (dy / d) * push + (byDawn ? 0 : 90);
    for (let i = 0; i < 26 * this.quality; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 300;
      this.spawn(
        this.mx, this.my, Math.cos(a) * s, Math.sin(a) * s,
        0.8, 6, i % 4 === 0 ? "#ffd2a0" : "#ff8f6b", 0,
      );
    }
    if (this.glimmers <= 0) this.beginSettle();
  }

  private beginSettle(): void {
    this.phase = "settling";
    this.flightT = this.t;
    this.settleT = 0;
    this.audio.leaveGarden();
    this.audio.sleep();
  }

  private finish(): void {
    this.phase = "done";
    let beaten = 0;
    for (const g of this.ghosts) if (g.duration < this.flightT) beaten++;
    this.opts.onEnd({
      seed: this.seed,
      score: Math.floor(this.score),
      metres: Math.floor(this.metres),
      pollen: this.pollenCount,
      blooms: this.bloomCount,
      duration: +this.flightT.toFixed(2),
      bestCombo: this.bestCombo,
      ghostsBeaten: beaten,
      ghostsTotal: this.ghosts.length,
      biome: this.lastBiome,
      replay: this.recorder.encode(),
    });
  }

  /* ----------------------------- particles ---------------------------- */

  private spawn(
    x: number, y: number, vx: number, vy: number,
    life: number, size: number, color: string, kind: 0 | 1,
  ): void {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.alive) continue;
      p.alive = true;
      p.x = x; p.y = y; p.vx = vx; p.vy = vy;
      p.life = life; p.max = life; p.size = size;
      p.color = color; p.kind = kind; p.drag = 1.8;
      return;
    }
  }

  private killParticles(): void {
    for (const p of this.particles) p.alive = false;
  }

  private stepParticles(dt: number): void {
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      const f = Math.exp(-p.drag * dt);
      p.vx *= f;
      p.vy *= f;
      p.vy += 26 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  private pushTrail(): void {
    this.trailHead = (this.trailHead + 1) % TRAIL_N;
    this.trail[this.trailHead * 2] = this.mx;
    this.trail[this.trailHead * 2 + 1] = this.my;
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                          */
  /* ------------------------------------------------------------------ */

  private biomeNow(): Biome {
    const band = Math.floor(this.camY / (CHUNK_H * CHUNKS_PER_BIOME));
    return BIOMES[((band % BIOMES.length) + BIOMES.length) % BIOMES.length];
  }

  private biomeBlend(): { a: Biome; b: Biome; t: number } {
    const bandF = this.camY / (CHUNK_H * CHUNKS_PER_BIOME);
    const i = Math.floor(bandF);
    const frac = bandF - i;
    const t = smoothstep(0.78, 1, frac);
    const n = BIOMES.length;
    return {
      a: BIOMES[((i % n) + n) % n],
      b: BIOMES[(((i + 1) % n) + n) % n],
      t,
    };
  }

  private render(): void {
    const g = this.ctx;
    const { a, b, t } = this.biomeBlend();
    const sky0 = mixColor(a.sky[0], b.sky[0], t);
    const sky1 = mixColor(a.sky[1], b.sky[1], t);
    const foliage = mixColor(a.foliage, b.foliage, t);
    const accent = mixColor(a.accent, b.accent, t);

    this.drawSurround(sky0, sky1);

    let shx = 0;
    let shy = 0;
    if (this.shake > 0) {
      const m = this.shake * this.shake * 14;
      shx = (Math.random() - 0.5) * m;
      shy = (Math.random() - 0.5) * m;
    }
    g.setTransform(this.scale, 0, 0, this.scale, this.offX + shx * this.scale, this.offY + shy * this.scale);

    g.beginPath();
    g.rect(0, 0, FIELD_W, this.fieldH);
    g.save();
    g.clip();

    // ---------- sky
    const grad = g.createLinearGradient(0, this.fieldH, 0, 0);
    grad.addColorStop(0, sky0);
    grad.addColorStop(1, sky1);
    g.fillStyle = grad;
    g.fillRect(0, 0, FIELD_W, this.fieldH);

    this.drawStars();
    this.drawMoon(accent);
    this.drawDecor({ depth: 0.16, color: mixColor(foliage, sky1, 0.62), alpha: 0.55, scale: 0.85 });
    this.drawDecor({ depth: 0.34, color: mixColor(foliage, sky1, 0.34), alpha: 0.75, scale: 1.1 });
    this.drawDecor({ depth: 0.58, color: mixColor(foliage, sky0, 0.12), alpha: 0.55, scale: 0.95 });

    // ---------- world
    this.drawHazards(accent);
    this.drawTreasure();

    // ---------- ghosts of everyone else flying tonight
    this.drawGhosts();

    // ---------- particles (additive)
    this.drawParticles();

    // ---------- the lantern: darkness everywhere you are not
    this.drawLantern();

    // The moth and the light itself are painted *after* the darkness: they
    // carry their own glow, so they stay legible no matter how far you have
    // strayed from the lit part of the garden.
    this.drawTrail();
    this.drawMoth();
    this.drawLightOrb();
    this.drawDecor({ depth: 1.28, color: "#01030a", alpha: 0.38, scale: 1.15, edges: true });

    // ---------- dawn creeping up from below
    this.drawDawn();

    if (this.hurtFlash > 0) {
      g.fillStyle = `rgba(255,96,72,${(this.hurtFlash * 0.22).toFixed(3)})`;
      g.fillRect(0, 0, FIELD_W, this.fieldH);
    }
    if (this.flash > 0) {
      g.globalCompositeOperation = "lighter";
      g.fillStyle = `rgba(255,236,190,${(this.flash * 0.1).toFixed(3)})`;
      g.fillRect(0, 0, FIELD_W, this.fieldH);
      g.globalCompositeOperation = "source-over";
    }

    g.restore();


    // frame the terrarium: a thin rim plus a soft spill of light onto the
    // surrounding dark, so a wide monitor reads as "a window into a garden"
    // rather than "a game that didn't fill the screen".
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 4; i++) {
      g.strokeStyle = `rgba(255,213,150,${(0.05 - i * 0.011).toFixed(3)})`;
      g.lineWidth = (i + 1) * 7;
      g.strokeRect(-i * 4, -i * 4, FIELD_W + i * 8, this.fieldH + i * 8);
    }
    g.globalCompositeOperation = "source-over";
    g.strokeStyle = "rgba(197,220,255,0.1)";
    g.lineWidth = 1.5;
    g.strokeRect(0.75, 0.75, FIELD_W - 1.5, this.fieldH - 1.5);
  }

  /**
   * Everything outside the play column. The garden continues out here, just
   * much darker — it keeps ultrawide screens from looking like a mistake.
   */
  private drawSurround(sky0: string, sky1: string): void {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const grad = g.createLinearGradient(0, this.viewH, 0, 0);
    grad.addColorStop(0, sky0);
    grad.addColorStop(1, sky1);
    g.fillStyle = grad;
    g.fillRect(0, 0, this.viewW, this.viewH);

    const tile = 512;
    const off = (((this.camY * 0.03) % tile) + tile) % tile;
    g.globalAlpha = 0.3;
    for (let y = -tile + off; y < this.viewH + tile; y += tile) {
      for (let x = 0; x < this.viewW + tile; x += tile) {
        g.drawImage(this.sprites.starsFar, x, y);
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = "rgba(2,4,10,0.62)";
    g.fillRect(0, 0, this.viewW, this.viewH);

    // Ambilight. On a wide monitor the garden only occupies a column, and
    // the rest used to be flat black. Spilling the lantern's warmth into
    // the surround makes the margins feel lit by the game rather than
    // switched off — and it costs one gradient per frame.
    const cx = this.offX + (FIELD_W * this.scale) / 2;
    const cy = this.offY + (this.fieldH - (this.my - this.camY)) * this.scale;
    const r = Math.max(this.viewW, this.fieldH * this.scale) * 0.92;
    const spill = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    spill.addColorStop(0, "rgba(255,206,130,0.16)");
    spill.addColorStop(0.35, "rgba(188,168,255,0.06)");
    spill.addColorStop(1, "rgba(0,0,0,0)");
    g.globalCompositeOperation = "lighter";
    g.fillStyle = spill;
    g.fillRect(0, 0, this.viewW, this.viewH);
    g.globalCompositeOperation = "source-over";
  }

  private drawStars(): void {
    const g = this.ctx;
    const tile = 512;
    for (const [sprite, depth, alpha] of [
      [this.sprites.starsFar, 0.06, 0.75],
      [this.sprites.starsNear, 0.14, 0.5],
    ] as const) {
      const off = (((this.camY * depth) % tile) + tile) % tile;
      g.globalAlpha = alpha;
      for (let y = -tile + off; y < this.fieldH + tile; y += tile) {
        for (let x = 0; x < FIELD_W; x += tile) g.drawImage(sprite, x, y);
      }
      g.globalAlpha = 1;
    }
  }

  private drawMoon(accent: string): void {
    // The moon hangs at a fixed, unreachable height. You never get there.
    const g = this.ctx;
    const moonY = 128 + Math.sin(this.camY * 0.0004) * 24;
    const r = 42;
    const x = FIELD_W * 0.76;
    const glow = this.sprites.glow(190, "#dce7ff", 1.5);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.4;
    g.drawImage(glow, x - 190, moonY - 190, 380, 380);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";

    g.fillStyle = "#e9eeff";
    g.beginPath();
    g.arc(x, moonY, r, 0, Math.PI * 2);
    g.fill();
    // soft limb shading so it isn't a flat sticker
    g.fillStyle = rgba(accent, 0.1);
    g.beginPath();
    g.arc(x + r * 0.3, moonY + r * 0.28, r * 0.92, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = rgba(accent, 0.14);
    for (const [cx, cy, cr] of [
      [-0.32, -0.22, 0.17],
      [0.26, 0.2, 0.12],
      [0.02, 0.45, 0.08],
      [-0.1, -0.52, 0.07],
    ] as const) {
      g.beginPath();
      g.arc(x + cx * r, moonY + cy * r, cr * r, 0, Math.PI * 2);
      g.fill();
    }
  }

  /**
   * Parallax foliage. Each layer scrolls at its own rate and is streamed
   * from its own deterministic row index, so nothing has to be stored and
   * the garden looks the same every time you fly it.
   *
   * Distant layers are mixed toward the sky colour — cheap atmospheric
   * perspective that does more for depth than any amount of blur.
   */
  private drawDecor(layer: {
    depth: number;
    color: string;
    alpha: number;
    scale: number;
    edges?: boolean;
  }): void {
    if (this.quality < 1 && layer.depth > 1) return;
    const g = this.ctx;
    const ROW = 340;
    const camP = this.camY * layer.depth;
    const first = Math.floor(camP / ROW) - 1;
    const last = Math.floor((camP + this.fieldH) / ROW) + 1;
    const color = quantize(layer.color, 20);
    g.globalAlpha = layer.alpha;
    for (let k = first; k <= last; k++) {
      const r = mulberry32((k * 2654435761 + Math.floor(layer.depth * 977)) >>> 0);
      const n = layer.edges ? 1 : 1 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        // foreground fronds hug the edges so they never block the lane
        const u = r();
        const x = layer.edges
          ? (u < 0.5 ? u * 0.3 : 0.85 + (u - 0.5) * 0.3) * FIELD_W
          : u * (FIELD_W + 200) - 100;
        const y = k * ROW + r() * ROW;
        const s = (0.6 + r() * 1.1) * layer.scale;
        const kind = Math.floor(r() * 4) as 0 | 1 | 2 | 3;
        const sy = this.fieldH - (y - camP);
        const size = 200 * s;
        if (sy < -size || sy > this.fieldH + size) continue;
        g.drawImage(this.sprites.frond(kind, color, r() * 4), x - size / 2, sy - size, size, size);
      }
    }
    g.globalAlpha = 1;
  }

  private drawHazards(accent: string): void {
    const g = this.ctx;
    for (const c of this.world.live()) {
      for (const h of c.hazards) {
        if (h.kind === "thorn") {
          const y0 = this.sy(h.y0);
          const y1 = this.sy(h.y1);
          if (Math.min(y0, y1) > this.fieldH + 90 || Math.max(y0, y1) < -90) continue;
          const x0 = this.sx(h.x0);
          const x1 = this.sx(h.x1);
          const len = Math.hypot(x1 - x0, y1 - y0) || 1;
          const ux = (x1 - x0) / len;
          const uy = (y1 - y0) / len;
          const nx = -uy;
          const ny = ux;
          const w0 = h.r * 1.05;
          const w1 = h.r * 0.5;

          // leaves first, so they tuck behind the stem
          const lr = mulberry32(Math.floor(h.seed) + 7);
          g.fillStyle = "#16221a";
          for (let i = 0; i < 3; i++) {
            const t = 0.18 + lr() * 0.66;
            const side = lr() < 0.5 ? 1 : -1;
            const px = x0 + ux * len * t;
            const py = y0 + uy * len * t;
            const lw = h.r * (0.85 + lr() * 0.5);
            g.beginPath();
            g.ellipse(
              px + nx * lw * 1.5 * side + ux * lw * 0.3,
              py + ny * lw * 1.5 * side + uy * lw * 0.3,
              lw, lw * 0.44,
              Math.atan2(uy, ux) + side * 0.75, 0, Math.PI * 2,
            );
            g.fill();
          }

          // the stem: a tapering bramble, fattest where it leaves the wall
          g.fillStyle = "#121b14";
          g.beginPath();
          g.moveTo(x0 + nx * w0, y0 + ny * w0);
          g.lineTo(x1 + nx * w1, y1 + ny * w1);
          g.arc(x1, y1, w1, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false);
          g.lineTo(x0 - nx * w0, y0 - ny * w0);
          g.closePath();
          g.fill();

          // a single hair-thin moonlit edge, not a second fat stripe
          g.strokeStyle = "rgba(188,214,180,0.16)";
          g.lineWidth = 1.4;
          g.beginPath();
          g.moveTo(x0 + nx * w0, y0 + ny * w0);
          g.lineTo(x1 + nx * w1, y1 + ny * w1);
          g.stroke();

          // thorns: small, hooked back toward the wall, pale at the point
          const n = Math.max(3, Math.floor(len / 30));
          for (let i = 1; i <= n; i++) {
            const t = i / (n + 1);
            const w = w0 + (w1 - w0) * t;
            const side = i % 2 === 0 ? 1 : -1;
            const px = x0 + ux * len * t;
            const py = y0 + uy * len * t;
            const bx = px + nx * w * side;
            const by = py + ny * w * side;
            const sp = h.r * 0.95;
            const tipX = bx + nx * sp * side - ux * sp * 0.75;
            const tipY = by + ny * sp * side - uy * sp * 0.75;
            g.fillStyle = "#223320";
            g.beginPath();
            g.moveTo(bx - ux * w * 0.75, by - uy * w * 0.75);
            g.quadraticCurveTo(
              bx + nx * sp * 0.45 * side + ux * w * 0.1,
              by + ny * sp * 0.45 * side + uy * w * 0.1,
              tipX, tipY,
            );
            g.quadraticCurveTo(
              bx + nx * sp * 0.2 * side - ux * w * 0.1,
              by + ny * sp * 0.2 * side - uy * w * 0.1,
              bx + ux * w * 0.75, by + uy * w * 0.75,
            );
            g.closePath();
            g.fill();
            g.fillStyle = "rgba(206,224,196,0.4)";
            g.beginPath();
            g.arc(tipX, tipY, 1.3, 0, Math.PI * 2);
            g.fill();
          }
        } else if (h.kind === "web") {
          const cy = this.sy(h.y);
          if (cy < -h.r * 2 || cy > this.fieldH + h.r * 2) continue;
          const cx = this.sx(h.x);
          g.strokeStyle = "rgba(214,228,246,0.26)";
          g.lineWidth = 1.4;
          const spokes = 9;
          for (let i = 0; i < spokes; i++) {
            const a = (i / spokes) * Math.PI * 2 + h.seed * 0.01;
            g.beginPath();
            g.moveTo(cx, cy);
            g.lineTo(cx + Math.cos(a) * h.r, cy + Math.sin(a) * h.r);
            g.stroke();
          }
          for (let ring = 1; ring <= 4; ring++) {
            const rr = (h.r * ring) / 4;
            g.beginPath();
            for (let i = 0; i <= spokes; i++) {
              const a = (i / spokes) * Math.PI * 2 + h.seed * 0.01;
              const px = cx + Math.cos(a) * rr;
              const py = cy + Math.sin(a) * rr * 0.96;
              if (i === 0) g.moveTo(px, py);
              else g.lineTo(px, py);
            }
            g.stroke();
          }
        } else if (h.kind === "spider") {
          const cy = this.sy(h.y);
          if (cy < -40 || cy > this.fieldH + 40) continue;
          g.strokeStyle = "rgba(214,228,246,0.11)";
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(this.sx(h.xa), cy);
          g.lineTo(this.sx(h.xb), cy);
          g.stroke();
          const cx = this.sx(spiderX(h, this.t));
          // a short dangle of silk, so it reads as hanging rather than stuck on
          g.strokeStyle = "rgba(214,228,246,0.13)";
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(cx, cy + 6);
          g.stroke();
          g.fillStyle = "#16100f";
          g.beginPath();
          g.ellipse(cx, cy + 11, h.r * 0.68, h.r * 0.85, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = "rgba(190,205,230,0.1)";
          g.beginPath();
          g.ellipse(cx - h.r * 0.2, cy + 8, h.r * 0.26, h.r * 0.3, 0, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = "#16100f";
          g.lineWidth = 2.4;
          for (let i = -1; i <= 1; i += 1) {
            for (const s of [-1, 1]) {
              g.beginPath();
              g.moveTo(cx, cy + 8);
              g.quadraticCurveTo(cx + s * 16, cy + 6 + i * 6, cx + s * 22, cy + 18 + i * 5);
              g.stroke();
            }
          }
          g.fillStyle = "#ff6b6b";
          g.beginPath();
          g.arc(cx - 4, cy + 2, 2, 0, Math.PI * 2);
          g.arc(cx + 4, cy + 2, 2, 0, Math.PI * 2);
          g.fill();
        } else if (h.kind === "drop") {
          const cy = this.sy(h.y);
          if (cy < -30 || cy > this.fieldH + 30) continue;
          const cx = this.sx(h.x);
          g.fillStyle = "rgba(170,214,255,0.82)";
          g.beginPath();
          g.moveTo(cx, cy - h.r * 1.8);
          g.quadraticCurveTo(cx + h.r, cy, cx, cy + h.r);
          g.quadraticCurveTo(cx - h.r, cy, cx, cy - h.r * 1.8);
          g.fill();
          g.fillStyle = "rgba(255,255,255,0.5)";
          g.beginPath();
          g.arc(cx - h.r * 0.3, cy - h.r * 0.1, h.r * 0.22, 0, Math.PI * 2);
          g.fill();
        } else if (h.kind === "gust") {
          const y = this.sy(h.y);
          const yh = h.h;
          if (y < -yh || y - yh > this.fieldH) continue;
          g.strokeStyle = rgba(accent, 0.12);
          g.lineWidth = 2;
          const rr = mulberry32(Math.floor(h.seed));
          for (let i = 0; i < 9; i++) {
            const ly = y - rr() * yh;
            const w = 70 + rr() * 150;
            const phase = (this.t * h.strength * 0.5 + rr() * 1000) % (FIELD_W + 260);
            const lx = h.dir > 0 ? phase - 130 : FIELD_W + 130 - phase;
            g.beginPath();
            g.moveTo(lx, ly);
            g.lineTo(lx + h.dir * w, ly - 6);
            g.stroke();
          }
        }
      }
    }
  }

  private drawTreasure(): void {
    const g = this.ctx;
    g.globalCompositeOperation = "lighter";
    for (const c of this.world.live()) {
      for (const tr of c.treasure) {
        if (tr.taken) continue;
        const cy = this.sy(tr.y);
        if (cy < -80 || cy > this.fieldH + 80) continue;
        const cx = this.sx(tr.x);
        if (tr.kind === "pollen") {
          const pulse = 0.78 + Math.sin(this.t * 3 + tr.phase) * 0.22;
          const s = 21 * pulse;
          g.globalAlpha = 0.95;
          g.drawImage(this.sprites.spark, cx - s, cy - s, s * 2, s * 2);
        } else {
          g.globalAlpha = 0.5;
          const glow = this.sprites.glow(110, c.biome.accent, 1.2);
          g.drawImage(glow, cx - 110, cy - 110, 220, 220);
        }
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";

    // bloom petals drawn opaque on top of their glow
    for (const c of this.world.live()) {
      for (const tr of c.treasure) {
        if (tr.taken || tr.kind !== "bloom") continue;
        const cy = this.sy(tr.y);
        if (cy < -80 || cy > this.fieldH + 80) continue;
        const cx = this.sx(tr.x);
        const spin = this.t * 0.4 + tr.seed;
        for (let i = 0; i < tr.petals; i++) {
          const a = (i / tr.petals) * Math.PI * 2 + spin;
          g.fillStyle = rgba(c.biome.accent, 0.9);
          g.beginPath();
          g.ellipse(
            cx + Math.cos(a) * tr.r * 0.52,
            cy + Math.sin(a) * tr.r * 0.52,
            tr.r * 0.44, tr.r * 0.24, a, 0, Math.PI * 2,
          );
          g.fill();
        }
        g.fillStyle = "#fff6d8";
        g.beginPath();
        g.arc(cx, cy, tr.r * 0.3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  private drawGhosts(): void {
    if (!this.ghosts.length || this.phase === "attract") return;
    const g = this.ctx;
    for (const gh of this.ghosts) {
      const alive = ghostAt(gh, this.t, this.ghostPos);
      if (!alive) continue;
      const cy = this.sy(this.ghostPos.y);
      if (cy < -60 || cy > this.fieldH + 60) continue;
      const cx = this.sx(this.ghostPos.x);
      const dying = this.t > gh.duration;
      const fade = dying ? Math.max(0, 1 - (this.t - gh.duration) / 1) : 1;
      const hue = (hashHue(gh.name) % 360) / 360;
      const col = hslString(hue, 0.55, 0.78);
      g.globalAlpha = 0.3 * fade;
      g.globalCompositeOperation = "lighter";
      const glow = this.sprites.glow(46, col, 1.1);
      g.drawImage(glow, cx - 46, cy - 46, 92, 92);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 0.46 * fade;
      drawMothShape(g, cx, cy, 0.78, Math.sin(this.t * 9 + hue * 10), 0, col, "rgba(0,0,0,0)");
      g.globalAlpha = 0.5 * fade;
      g.fillStyle = "rgba(226,238,255,0.75)";
      g.font = `500 15px ${this.opts.fontFamily}`;
      g.textAlign = "center";
      g.fillText(gh.name, cx, cy - 30);
      g.globalAlpha = 1;
    }
  }

  private drawParticles(): void {
    const g = this.ctx;
    g.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      if (!p.alive) continue;
      const cy = this.sy(p.y);
      if (cy < -40 || cy > this.fieldH + 40) continue;
      const cx = this.sx(p.x);
      const a = Math.max(0, p.life / p.max);
      g.globalAlpha = p.kind === 0 ? a : a * 0.7;
      const s = p.size * (0.6 + a * 0.8);
      const sprite = this.sprites.glow(24, p.color, p.kind === 0 ? 1 : 1.8);
      g.drawImage(sprite, cx - s, cy - s, s * 2, s * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  private drawTrail(): void {
    const g = this.ctx;
    g.globalCompositeOperation = "lighter";
    for (let i = 1; i < TRAIL_N; i++) {
      const idx = (this.trailHead - i + TRAIL_N * 2) % TRAIL_N;
      const a = 1 - i / TRAIL_N;
      const cx = this.sx(this.trail[idx * 2]);
      const cy = this.sy(this.trail[idx * 2 + 1]);
      const s = 13 * a + 2;
      g.globalAlpha = a * a * 0.3;
      g.drawImage(this.sprites.glow(24, "#ffe9bb", 1.2), cx - s, cy - s, s * 2, s * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  private drawMoth(): void {
    const g = this.ctx;
    const cx = this.sx(this.mx);
    const cy = this.sy(this.my);
    const blink = this.invuln > 0 && Math.floor(this.invuln * 14) % 2 === 0;
    const settle = this.phase === "settling" ? Math.max(0, 1 - this.settleT / 2.3) : 1;

    g.globalCompositeOperation = "lighter";
    g.globalAlpha = (blink ? 0.32 : 0.85) * settle;
    const glowR = 66 + Math.sin(this.t * 4) * 6;
    g.drawImage(
      this.sprites.glow(96, "#ffdc9a", 1.15),
      cx - glowR, cy - glowR, glowR * 2, glowR * 2,
    );
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = blink ? 0.45 : 1;

    const flap =
      this.phase === "settling"
        ? Math.sin(this.settleT * 3) * (1 - this.settleT / 2.3)
        : Math.sin(this.flutter);
    drawMothShape(g, cx, cy, 1, flap, this.mothAngle, "#f6ead2", "#c9b48f");
    g.globalAlpha = 1;

    // combo pip
    if (this.combo > 1 && this.phase === "flying") {
      g.fillStyle = `rgba(255,232,170,${Math.min(1, this.comboT / RULES.comboWindow + 0.3)})`;
      g.font = `700 22px ${this.opts.fontFamily}`;
      g.textAlign = "center";
      g.fillText(`×${this.combo}`, cx, cy - 44);
    }
  }

  private drawLantern(): void {
    const g = this.ctx;
    const lx = this.sx(this.lx);
    const ly = this.sy(this.ly);
    const d = this.sprites.darkness;
    const r = this.fieldH * 0.92;
    const dim =
      this.phase === "settling" ? 1 - Math.min(1, this.settleT / 1.2) * 0.65 : 1;

    g.globalAlpha = dim;
    g.drawImage(d, lx - r, ly - r, r * 2, r * 2);
    g.globalAlpha = 1;
    // fill everything the darkness sprite didn't cover
    g.fillStyle = `rgba(2,4,10,${(SpriteCache.DARK_ALPHA * dim).toFixed(3)})`;
    const l = lx - r;
    const rr = lx + r;
    const tp = ly - r;
    const bt = ly + r;
    if (l > 0) g.fillRect(0, 0, l, this.fieldH);
    if (rr < FIELD_W) g.fillRect(rr, 0, FIELD_W - rr, this.fieldH);
    if (tp > 0) g.fillRect(Math.max(0, l), 0, Math.min(FIELD_W, rr) - Math.max(0, l), tp);
    if (bt < this.fieldH) {
      g.fillRect(Math.max(0, l), bt, Math.min(FIELD_W, rr) - Math.max(0, l), this.fieldH - bt);
    }

  }

  /** Your light: the only thing in the garden you actually control. */
  private drawLightOrb(): void {
    const g = this.ctx;
    const lx = this.sx(this.lx);
    const ly = this.sy(this.ly);
    const pulse = 1 + Math.sin(this.t * 2.6) * 0.06;

    g.globalCompositeOperation = "lighter";
    const R = 190 * pulse;
    g.globalAlpha = 0.5;
    g.drawImage(this.sprites.glow(180, "#ffcf84", 1.7), lx - R, ly - R, R * 2, R * 2);
    const c = LIGHT.radius * 2.1 * pulse;
    g.globalAlpha = 0.85;
    g.drawImage(this.sprites.glow(64, "#ffeec2", 1), lx - c, ly - c, c * 2, c * 2);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#fffbf2";
    g.beginPath();
    g.arc(lx, ly, 4.5, 0, Math.PI * 2);
    g.fill();
  }

  private drawDawn(): void {
    const g = this.ctx;
    const danger = clamp(this.dawnT / RULES.dawnGrace, 0, 1);
    const h = 70 + danger * 150;
    const grad = g.createLinearGradient(0, this.fieldH, 0, this.fieldH - h);
    grad.addColorStop(0, `rgba(255,172,92,${0.5 + danger * 0.4})`);
    grad.addColorStop(0.45, `rgba(255,128,96,${0.17 + danger * 0.3})`);
    grad.addColorStop(1, "rgba(255,110,120,0)");
    g.fillStyle = grad;
    g.fillRect(0, this.fieldH - h, FIELD_W, h);
    g.globalCompositeOperation = "lighter";
    g.fillStyle = `rgba(255,205,150,${0.1 + danger * 0.22})`;
    g.fillRect(0, this.fieldH - 5, FIELD_W, 5);
    g.globalCompositeOperation = "source-over";
  }

  /* --------------------------- coordinate maps -------------------------- */

  private sx(worldX: number): number {
    return worldX + HALF_W;
  }

  private sy(worldY: number): number {
    return this.fieldH - (worldY - this.camY);
  }
}

/* -------------------------------------------------------------------- */
/* helpers                                                              */
/* -------------------------------------------------------------------- */

function drawMothShape(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  flap: number,
  angle: number,
  wing: string,
  body: string,
): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle * 0.5);
  g.scale(scale, scale);
  const squash = 0.35 + Math.abs(flap) * 0.65;

  for (const s of [-1, 1] as const) {
    g.fillStyle = wing;
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(s * 10, -16 * squash, s * 30, -20 * squash, s * 26, -2 * squash);
    g.bezierCurveTo(s * 24, 10 * squash, s * 12, 13 * squash, 0, 5);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.22)";
    g.beginPath();
    g.ellipse(s * 17, -6 * squash, 5, 3.4 * squash, 0, 0, Math.PI * 2);
    g.fill();
  }

  g.fillStyle = body;
  g.beginPath();
  g.ellipse(0, 1, 4.6, 9.5, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = body;
  g.lineWidth = 1.3;
  g.beginPath();
  g.moveTo(-1.5, -7);
  g.quadraticCurveTo(-7, -14, -9, -18);
  g.moveTo(1.5, -7);
  g.quadraticCurveTo(7, -14, 9, -18);
  g.stroke();
  g.restore();
}

function spiderX(h: { xa: number; xb: number; speed: number; phase: number }, t: number): number {
  const u = 0.5 + 0.5 * Math.sin(t * h.speed * Math.PI * 2 + h.phase);
  return h.xa + (h.xb - h.xa) * u;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function hslString(h: number, s: number, l: number): string {
  // convert to rgb so the sprite cache key stays stable
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
  };
  return `rgb(${f(0)},${f(8)},${f(4)})`;
}

export type { Chunk };
