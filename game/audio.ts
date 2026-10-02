/**
 * Procedural audio. There are no sound files in this game — not one byte is
 * downloaded. Every pad, pluck and gust is synthesised in the browser with
 * the Web Audio API, which keeps the whole thing tiny and instant.
 *
 * Musically everything lives in a D major pentatonic so the game can never
 * play a wrong note, no matter how fast you chain pollen.
 */

const PENTA = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99, 880.0];

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private wet: GainNode | null = null;
  private padGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private pads: OscillatorNode[] = [];
  private noise: AudioBufferSourceNode | null = null;
  private started = false;
  muted = false;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    type WithWebkit = typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (globalThis as WithWebkit).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    this.master = master;

    // cheap, pleasant "garden" space: a short feedback delay
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.26;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 2200;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    wet.connect(delay);
    delay.connect(damp);
    damp.connect(fb);
    fb.connect(delay);
    damp.connect(master);
    this.wet = wet;

    // ---- ambient pad
    const padGain = ctx.createGain();
    padGain.gain.value = 0.0;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.frequency.value = 760;
    padFilter.Q.value = 0.8;
    padGain.connect(padFilter);
    padFilter.connect(master);
    padFilter.connect(wet);
    this.padGain = padGain;

    for (const [f, det] of [
      [146.83, -4],
      [220.0, 3],
      [293.66, 6],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = 0.33;
      o.connect(g);
      g.connect(padGain);
      o.start();
      this.pads.push(o);
    }

    // slow breathing LFO on the pad filter
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 280;
    lfo.connect(lfoGain);
    lfoGain.connect(padFilter.frequency);
    lfo.start();

    // ---- wind (filtered noise, tracks climb speed)
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 420;
    bp.Q.value = 0.7;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    src.connect(bp);
    bp.connect(wg);
    wg.connect(master);
    src.start();
    this.noise = src;
    this.windGain = wg;
    this.windFilter = bp;
  }

  private get t(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (!this.master || !this.ctx) return;
    this.master.gain.cancelScheduledValues(this.t);
    this.master.gain.setTargetAtTime(m ? 0.0001 : 0.5, this.t, 0.08);
  }

  /** Fade the ambience in when a run begins. */
  enterGarden(): void {
    this.unlock();
    if (!this.ctx || !this.padGain || !this.master) return;
    this.started = true;
    this.master.gain.setTargetAtTime(this.muted ? 0.0001 : 0.5, this.t, 0.2);
    this.padGain.gain.setTargetAtTime(0.1, this.t, 1.6);
  }

  leaveGarden(): void {
    if (!this.ctx || !this.padGain || !this.windGain) return;
    this.started = false;
    this.padGain.gain.setTargetAtTime(0.0, this.t, 0.8);
    this.windGain.gain.setTargetAtTime(0.0, this.t, 0.5);
  }

  /** speed01: 0 at the start of a run, 1 at terminal dawn speed. */
  setClimb(speed01: number): void {
    if (!this.ctx || !this.windGain || !this.windFilter || !this.started) return;
    this.windGain.gain.setTargetAtTime(0.012 + speed01 * 0.055, this.t, 0.35);
    this.windFilter.frequency.setTargetAtTime(360 + speed01 * 720, this.t, 0.4);
  }

  private pluck(freq: number, dur: number, type: OscillatorType, vol: number): void {
    if (!this.ctx || !this.master || !this.wet) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    g.connect(this.wet);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Rising pentatonic ladder — the longer your chain, the higher it sings. */
  pollen(combo: number): void {
    const i = Math.min(PENTA.length - 1, Math.max(0, combo - 1));
    this.pluck(PENTA[i], 0.5, "sine", 0.19);
    this.pluck(PENTA[i] * 2, 0.22, "triangle", 0.05);
  }

  bloom(): void {
    [0, 2, 4, 6].forEach((n, i) => {
      setTimeout(() => this.pluck(PENTA[n], 0.9, "sine", 0.17), i * 70);
    });
  }

  sting(): void {
    if (!this.ctx || !this.master) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(58, t + 0.3);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(220, t + 0.3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(f);
    f.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.36);
  }

  web(): void {
    this.pluck(98, 0.35, "sawtooth", 0.06);
  }

  /** A soft four-note descent as the moth folds its wings. */
  sleep(): void {
    [6, 4, 2, 0].forEach((n, i) => {
      setTimeout(() => this.pluck(PENTA[n] / 2, 1.5, "sine", 0.16), i * 230);
    });
  }

  ui(): void {
    this.pluck(587.33, 0.14, "sine", 0.1);
  }
}
