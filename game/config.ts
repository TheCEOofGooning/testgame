/** Tuning constants for MOTHLIGHT. World units are roughly "centimetres". */

/** Width of the playable column. The camera never moves horizontally. */
export const FIELD_W = 720;
/**
 * Reference height of the window into the garden.
 *
 * The column is always exactly FIELD_W wide — that part is identical on every
 * device, because horizontal room is what dodging actually costs. How much
 * garden you can see *vertically* flexes a little with the screen's aspect,
 * clamped hard to the range below, so a phone and an ultrawide both get a
 * playable picture without one of them being handed the game.
 */
export const FIELD_H = 960;
export const MIN_VIEW_H = 900;
export const MAX_VIEW_H = 1240;

export const HALF_W = FIELD_W / 2;

/** Vertical slab the generator fills in one go. */
export const CHUNK_H = 480;
/** How many chunks make up one biome band. */
export const CHUNKS_PER_BIOME = 7;

/** 10 world units = 1 metre of altitude. */
export const UNITS_PER_METRE = 10;

export const CAM = {
  /** starting climb rate (units/sec) */
  startSpeed: 168,
  /** acceleration of the dawn (units/sec²) */
  accel: 2.15,
  maxSpeed: 560,
  /** the moth sits this far above the bottom of the window at rest */
  restOffset: 300,
};

export const MOTH = {
  /** Spring constant pulling the moth toward your light. Together with the
   *  damping below this is an *underdamped* spring (zeta ~ 0.53): the moth
   *  overshoots a little and swings back, which is the entire game. */
  pull: 24,
  /** velocity damping (per second, exponential) */
  drag: 5.2,
  maxSpeed: 1150,
  radius: 15,
  /** bounce off the glass walls of the column */
  restitution: 0.42,
  /** how long you are intangible after a sting */
  invuln: 1.25,
  /** idle wing-flutter wobble */
  flutterAmp: 2.4,
  flutterRate: 11,
};

export const LIGHT = {
  /** pointer smoothing (per second, exponential) */
  follow: 26,
  keyboardSpeed: 760,
  radius: 26,
  /** touch holds the light this far above the fingertip so the thumb
   *  never covers the moth */
  touchLift: 92,
};

export const RULES = {
  glimmersMax: 3,
  glimmersStart: 3,
  /** seconds you may linger below the dawn line before it costs you */
  dawnGrace: 1.15,
  comboWindow: 2.6,
  comboMax: 9,
  pollenScore: 11,
  bloomScore: 150,
  /** points per metre climbed */
  metreScore: 1,
};

/**
 * Exact altitude of the dawn after `t` seconds, in world units.
 *
 * Because nothing the player does can influence the camera, this closed form
 * is the single source of truth for "how high could anyone possibly be at
 * time t" — used by the ghost system to stay in sync and by the server to
 * reject impossible scores.
 */
export function dawnDistance(t: number): number {
  const tCap = (CAM.maxSpeed - CAM.startSpeed) / CAM.accel;
  if (t <= tCap) return CAM.startSpeed * t + 0.5 * CAM.accel * t * t;
  const atCap = CAM.startSpeed * tCap + 0.5 * CAM.accel * tCap * tCap;
  return atCap + CAM.maxSpeed * (t - tCap);
}

export type BiomeId =
  | "hedgerow"
  | "pond"
  | "greenhouse"
  | "thunderhead"
  | "moonfield";

export interface Biome {
  id: BiomeId;
  name: string;
  /** background gradient, bottom -> top */
  sky: [string, string];
  /** silhouette foliage colour */
  foliage: string;
  /** accent / particle colour */
  accent: string;
  /** glow colour of pollen in this band */
  pollen: string;
  /** relative spawn weights */
  weights: {
    thorn: number;
    web: number;
    drop: number;
    gust: number;
    spider: number;
  };
  /** ambient drifting motes */
  motes: number;
  blurb: string;
}

export const BIOMES: Biome[] = [
  {
    id: "hedgerow",
    name: "The Hedgerow",
    sky: ["#0a1726", "#122c3d"],
    foliage: "#07131c",
    accent: "#7ee0a8",
    pollen: "#ffe49c",
    weights: { thorn: 6, web: 2, drop: 0, gust: 1, spider: 1 },
    motes: 26,
    blurb: "Where every night begins.",
  },
  {
    id: "pond",
    name: "The Still Pond",
    sky: ["#061a2b", "#0d3450"],
    foliage: "#041320",
    accent: "#7fd8ff",
    pollen: "#cfeeff",
    weights: { thorn: 3, web: 3, drop: 4, gust: 2, spider: 1 },
    motes: 34,
    blurb: "Mind the rain. It remembers you.",
  },
  {
    id: "greenhouse",
    name: "The Glasshouse",
    sky: ["#101026", "#2a1b3d"],
    foliage: "#120d20",
    accent: "#ffa8e0",
    pollen: "#ffd0f0",
    weights: { thorn: 5, web: 6, drop: 1, gust: 1, spider: 3 },
    motes: 22,
    blurb: "Someone has been weaving in here.",
  },
  {
    id: "thunderhead",
    name: "The Thunderhead",
    sky: ["#171428", "#30243f"],
    foliage: "#0d0a18",
    accent: "#b6a8ff",
    pollen: "#e6dcff",
    weights: { thorn: 3, web: 2, drop: 6, gust: 7, spider: 1 },
    motes: 18,
    blurb: "The sky is shoving. Lean into it.",
  },
  {
    id: "moonfield",
    name: "The Moonfield",
    sky: ["#0d1030", "#1d2a5c"],
    foliage: "#080a1c",
    accent: "#dfe9ff",
    pollen: "#ffffff",
    weights: { thorn: 4, web: 3, drop: 4, gust: 5, spider: 2 },
    motes: 40,
    blurb: "Almost there. Almost morning.",
  },
];

export function biomeAt(chunkIndex: number): Biome {
  const band = Math.floor(chunkIndex / CHUNKS_PER_BIOME);
  return BIOMES[band % BIOMES.length];
}

/** 0 -> 1 difficulty curve, saturating. */
export function difficultyAt(chunkIndex: number): number {
  return 1 - Math.exp(-chunkIndex / 16);
}
