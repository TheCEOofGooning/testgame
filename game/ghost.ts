/**
 * Ghost replays — the trick that gives MOTHLIGHT multiplayer presence with
 * zero realtime infrastructure.
 *
 * The dawn rises on a fixed curve that no player can influence, so "seconds
 * since launch" is the same thing as "altitude" for everybody. That means a
 * recorded flight path can simply be replayed against the clock and it lines
 * up *perfectly* with your own run — other people's moths fly beside you, hit
 * the same thorns, and drop out of the sky one by one as their runs end.
 *
 * A 90-second flight compresses to about 4 KB, so Neon stores a whole day of
 * the world's best flights in a rounding error of a database.
 */

/** samples per second */
export const GHOST_HZ = 12;
export const GHOST_MAX_SECONDS = 420;

export interface GhostRun {
  id: string;
  name: string;
  score: number;
  /** decoded flight path, [x0,y0,x1,y1,...] in world units */
  path: Float32Array;
  /** seconds the flight lasted */
  duration: number;
}

export class GhostRecorder {
  private xs: number[] = [];
  private ys: number[] = [];
  private acc = 0;
  private readonly step = 1 / GHOST_HZ;

  reset(): void {
    this.xs.length = 0;
    this.ys.length = 0;
    this.acc = 0;
  }

  /** Call every simulation step with the moth's world position. */
  sample(dt: number, x: number, y: number): void {
    this.acc += dt;
    if (this.acc < this.step) return;
    this.acc -= this.step;
    if (this.xs.length >= GHOST_HZ * GHOST_MAX_SECONDS) return;
    this.xs.push(x);
    this.ys.push(y);
  }

  get length(): number {
    return this.xs.length;
  }

  encode(): string {
    return encodePath(this.xs, this.ys);
  }
}

/* ------------------------------------------------------------------ */
/* wire format: "ML1" + hz + count + [int16 x*16, int16 dy*8] per sample */
/* ------------------------------------------------------------------ */

const HEAD = 6;

export function encodePath(xs: number[], ys: number[]): string {
  const n = Math.min(xs.length, ys.length);
  const buf = new ArrayBuffer(HEAD + n * 4);
  const view = new DataView(buf);
  view.setUint8(0, 0x4d); // M
  view.setUint8(1, 0x4c); // L
  view.setUint8(2, 1); // version
  view.setUint8(3, GHOST_HZ);
  view.setUint16(4, n, true);
  let prevY = 0;
  for (let i = 0; i < n; i++) {
    const o = HEAD + i * 4;
    view.setInt16(o, clampI16(Math.round(xs[i] * 16)), true);
    const dy = ys[i] - prevY;
    prevY = ys[i];
    view.setInt16(o + 2, clampI16(Math.round(dy * 8)), true);
  }
  return bytesToBase64(new Uint8Array(buf));
}

export function decodePath(b64: string): { path: Float32Array; duration: number } {
  const bytes = base64ToBytes(b64);
  if (bytes.length < HEAD) return { path: new Float32Array(0), duration: 0 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== 0x4d || view.getUint8(1) !== 0x4c) {
    return { path: new Float32Array(0), duration: 0 };
  }
  const hz = view.getUint8(3) || GHOST_HZ;
  const n = Math.min(view.getUint16(4, true), Math.floor((bytes.length - HEAD) / 4));
  const path = new Float32Array(n * 2);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const o = HEAD + i * 4;
    path[i * 2] = view.getInt16(o, true) / 16;
    y += view.getInt16(o + 2, true) / 8;
    path[i * 2 + 1] = y;
  }
  return { path, duration: n / hz };
}

/** Interpolated ghost position at time t (seconds). Returns false once dead. */
export function ghostAt(
  g: GhostRun,
  t: number,
  out: { x: number; y: number },
): boolean {
  const n = g.path.length / 2;
  if (n === 0) return false;
  const f = t * GHOST_HZ;
  const i = Math.floor(f);
  if (i >= n - 1) {
    out.x = g.path[(n - 1) * 2];
    out.y = g.path[(n - 1) * 2 + 1];
    return i < n + GHOST_HZ; // linger a moment so we can play the fade-out
  }
  const a = f - i;
  out.x = g.path[i * 2] + (g.path[i * 2 + 2] - g.path[i * 2]) * a;
  out.y = g.path[i * 2 + 1] + (g.path[i * 2 + 3] - g.path[i * 2 + 1]) * a;
  return true;
}

/* --------------------------- base64 helpers --------------------------- */

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const b = Buffer.from(b64, "base64");
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function clampI16(v: number): number {
  return v < -32768 ? -32768 : v > 32767 ? 32767 : v;
}
