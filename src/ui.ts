/**
 * The whole user interface, with no framework underneath it.
 *
 * The title card, leaderboard shell and result card are already present in
 * the served HTML, so the first paint happens before a single byte of
 * JavaScript has been parsed. This file just wakes it all up: swaps screens
 * by toggling `hidden`, fills in the dynamic text, and drives the canvas.
 *
 * That decision is why the game is ~30 KB over the wire instead of ~200 KB.
 */

import { GameAudio } from "../game/audio";
import { Game, type RunResult } from "../game/engine";
import { decodePath, type GhostRun } from "../game/ghost";
import { residentGhosts } from "../game/residents";
import { dailySeed, msUntilNextSeed } from "../game/rng";

const MIN_COMPANY = 4;

const LS = {
  player: "mothlight:player",
  name: "mothlight:name",
  muted: "mothlight:muted",
  best: (seed: string) => `mothlight:best:${seed}`,
};

interface BoardEntry {
  rank: number;
  name: string;
  score: number;
  player: string;
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `p-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function nightNumber(seed: string): number {
  const [y, m, d] = seed.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 86400000) + 1;
}

function prettyDate(seed: string): string {
  const [y, m, d] = seed.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function verdictFor(r: RunResult): string {
  if (r.ghostsTotal > 0 && r.ghostsBeaten === r.ghostsTotal) return "The last light.";
  if (r.metres > 1400) return "You very nearly touched the moon.";
  if (r.metres > 800) return "The moonfield opened for you.";
  if (r.metres > 450) return "The glasshouse remembers you.";
  if (r.metres > 200) return "A good, long night.";
  if (r.metres > 90) return "The hedgerow let you pass.";
  return "The dawn came early tonight.";
}

export function boot(): void {
  /* ---------------------------------------------------------------- */
  /* state                                                             */
  /* ---------------------------------------------------------------- */

  let seed = dailySeed();
  let screen: "title" | "playing" | "result" = "title";
  let paused = false;
  let rows: BoardEntry[] = [];
  let offline = true;
  let loadingBoard = true;
  let ghosts: GhostRun[] = [];
  let result: RunResult | null = null;
  let best = 0;

  let player = localStorage.getItem(LS.player) ?? "";
  if (!player) {
    player = uid();
    localStorage.setItem(LS.player, player);
  }
  let name = localStorage.getItem(LS.name) ?? "";
  let muted = localStorage.getItem(LS.muted) === "1";
  best = Number(localStorage.getItem(LS.best(seed)) ?? 0);

  /* ---------------------------------------------------------------- */
  /* dom                                                               */
  /* ---------------------------------------------------------------- */

  const canvas = el<HTMLCanvasElement>("canvas");
  const stage = el("stage");
  const screens = {
    title: el("title"),
    result: el("result"),
    pause: el("pause"),
  };
  const nameInput = el<HTMLInputElement>("name");
  const seedline = el("seedline");
  const boardList = el("board-list");
  const boardSub = el("board-sub");
  const boardEmpty = el("board-empty");
  const countdown = el("countdown");
  const muteBtn = el<HTMLButtonElement>("mute");
  const toastEl = el("toast");

  nameInput.value = name;

  /* ---------------------------------------------------------------- */
  /* engine                                                            */
  /* ---------------------------------------------------------------- */

  const audio = new GameAudio();
  const game = new Game({
    canvas,
    seed,
    audio,
    fontFamily: getComputedStyle(document.body).fontFamily || "sans-serif",
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    onEnd: finishRun,
  });
  game.mount();
  audio.setMuted(muted);
  // handle for the headless DOM test in scripts/dom-smoke.ts
  (globalThis as unknown as { __mothlightGame?: Game }).__mothlightGame = game;
  paintMute();

  new ResizeObserver(() => game.resize()).observe(stage);

  /* ---------------------------------------------------------------- */
  /* screens                                                           */
  /* ---------------------------------------------------------------- */

  function show(next: typeof screen): void {
    screen = next;
    screens.title.hidden = next !== "title";
    screens.result.hidden = next !== "result";
    screens.pause.hidden = true;
    document.documentElement.classList.toggle("is-playing", next === "playing");
    if (next === "playing") document.documentElement.classList.remove("show-board");
    stage.classList.toggle("playing", next === "playing");
  }

  function toast(msg: string): void {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    window.setTimeout(() => (toastEl.hidden = true), 2600);
  }

  /* ---------------------------------------------------------------- */
  /* title text                                                        */
  /* ---------------------------------------------------------------- */

  function paintSeedline(): void {
    const bits = [
      `Night <b>${nightNumber(seed)}</b>`,
      `<b>${prettyDate(seed)}</b>`,
    ];
    if (best > 0) bits.push(`your best <b>${best.toLocaleString()}</b>`);
    seedline.innerHTML = bits.join(" &middot; ");
  }

  function paintMute(): void {
    muteBtn.dataset.muted = muted ? "1" : "0";
    muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
    muteBtn.title = muted ? "Unmute (M)" : "Mute (M)";
  }

  /* ---------------------------------------------------------------- */
  /* leaderboard                                                       */
  /* ---------------------------------------------------------------- */

  function mergedRows(): BoardEntry[] {
    const real = rows.slice();
    const seen = new Set(real.map((r) => r.player));
    const extra: BoardEntry[] = [];
    if (offline && best > 0 && !seen.has(player)) {
      extra.push({ rank: 0, name: name || "You", score: best, player });
    }
    for (const g of residentGhosts(seed, MIN_COMPANY)) {
      if (!seen.has(g.id)) {
        extra.push({ rank: 0, name: g.name, score: g.score, player: g.id });
      }
    }
    return [...real, ...extra]
      .sort((a, b) => b.score - a.score)
      .slice(0, 25)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }

  function paintBoard(): void {
    boardSub.textContent = offline ? "Local roost" : "Everyone, everywhere";
    const list = mergedRows();

    if (loadingBoard) {
      boardEmpty.hidden = false;
      boardEmpty.textContent = "Listening for wingbeats…";
      boardList.innerHTML = "";
      return;
    }
    boardEmpty.hidden = list.length > 0;
    if (!list.length) {
      boardEmpty.textContent =
        "Nobody has flown tonight's garden yet. The first name here is yours.";
    }

    boardList.innerHTML = list
      .map((r) => {
        const resident = r.player.startsWith("resident:");
        const cls = [r.player === player ? "me" : "", resident ? "resident" : ""]
          .filter(Boolean)
          .join(" ");
        return (
          `<li${cls ? ` class="${cls}"` : ""}` +
          `${resident ? ' title="A resident of tonight\'s garden"' : ""}>` +
          `<span class="r">${r.rank}</span>` +
          `<span class="n">${escapeHtml(r.name)}${resident ? " <i>❧</i>" : ""}</span>` +
          `<span class="s">${r.score.toLocaleString()}</span></li>`
        );
      })
      .join("");
  }

  function tickCountdown(): void {
    const s = Math.max(0, Math.floor(msUntilNextSeed() / 1000));
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    countdown.textContent = `${h}:${m}:${ss}`;

    // the garden turns over at UTC midnight, even with the tab left open
    const live = dailySeed();
    if (live !== seed) {
      seed = live;
      game.seed = live;
      best = Number(localStorage.getItem(LS.best(seed)) ?? 0);
      paintSeedline();
      void refreshBoard();
      void loadGhosts();
      toast("A new garden has grown.");
    }
  }

  /* ---------------------------------------------------------------- */
  /* network                                                           */
  /* ---------------------------------------------------------------- */

  async function refreshBoard(): Promise<void> {
    try {
      const res = await fetch(`/api/leaderboard?seed=${encodeURIComponent(seed)}`);
      const data = (await res.json()) as { rows?: BoardEntry[]; offline?: boolean };
      rows = data.rows ?? [];
      offline = Boolean(data.offline);
    } catch {
      rows = [];
      offline = true;
    } finally {
      loadingBoard = false;
      paintBoard();
    }
  }

  async function loadGhosts(): Promise<void> {
    let real: GhostRun[] = [];
    try {
      const res = await fetch(`/api/ghosts?seed=${encodeURIComponent(seed)}`);
      const data = (await res.json()) as {
        ghosts?: { id: string; name: string; score: number; replay: string }[];
      };
      real = (data.ghosts ?? [])
        .map((g) => {
          const { path, duration } = decodePath(g.replay);
          return { id: g.id, name: g.name, score: g.score, path, duration };
        })
        .filter((g) => g.path.length > 8);
    } catch {
      real = [];
    }
    ghosts =
      real.length >= MIN_COMPANY
        ? real.slice(0, 6)
        : [...real, ...residentGhosts(seed, MIN_COMPANY - real.length)];
    game.setGhosts(ghosts);
  }

  /* ---------------------------------------------------------------- */
  /* run lifecycle                                                     */
  /* ---------------------------------------------------------------- */

  function play(): void {
    audio.unlock();
    audio.setMuted(muted);
    name = nameInput.value.trim();
    localStorage.setItem(LS.name, name);
    game.setGhosts(ghosts);
    game.launch();
    paused = false;
    show("playing");
  }

  function quit(): void {
    game.setPaused(false);
    game.quit();
    paused = false;
    show("title");
    paintSeedline();
    paintBoard();
  }

  function finishRun(r: RunResult): void {
    result = r;
    show("result");

    const key = LS.best(r.seed);
    const prev = Number(localStorage.getItem(key) ?? 0);
    const isPb = r.score > prev;
    if (isPb) {
      localStorage.setItem(key, String(r.score));
      best = r.score;
    }

    el("verdict").textContent = verdictFor(r);
    el("score-value").textContent = r.score.toLocaleString();
    el("pb").hidden = !isPb;
    el("stat-metres").textContent = String(r.metres);
    el("stat-pollen").textContent = String(r.pollen);
    el("stat-chain").textContent = `×${r.bestCombo}`;
    el("stat-rank").textContent = `${r.duration.toFixed(0)}s`;
    el("stat-rank-label").textContent = "aloft";

    const outflew = el("outflew");
    if (r.ghostsTotal > 0) {
      outflew.hidden = false;
      outflew.innerHTML =
        `You outflew <b>${r.ghostsBeaten}</b> of ${r.ghostsTotal} moths ` +
        `in the sky with you.`;
    } else {
      outflew.hidden = true;
    }

    void submit(r);
  }

  async function submit(r: RunResult): Promise<void> {
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seed: r.seed,
          name: name || "Moth",
          player,
          score: r.score,
          metres: r.metres,
          pollen: r.pollen,
          blooms: r.blooms,
          bestCombo: r.bestCombo,
          duration: r.duration,
          replay: r.replay,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        offline?: boolean;
        rank?: number;
        total?: number;
      };
      if (data.ok && !data.offline && data.rank) {
        el("stat-rank").textContent = `#${data.rank}`;
        el("stat-rank-label").textContent = `of ${data.total}`;
      }
    } catch {
      /* the flight still counts on this device */
    }
    await refreshBoard();
    await loadGhosts();
  }

  async function share(): Promise<void> {
    if (!result) return;
    const text = [
      `MOTHLIGHT — night ${nightNumber(result.seed)}`,
      `${result.score.toLocaleString()} ✦   ${result.metres} m   ×${result.bestCombo}`,
      result.ghostsTotal > 0
        ? `outflew ${result.ghostsBeaten}/${result.ghostsTotal} moths`
        : `${result.duration.toFixed(0)}s aloft`,
      location.origin,
    ].join("\n");

    if (navigator.share) {
      try {
        await navigator.share({ title: "MOTHLIGHT", text });
        return;
      } catch {
        /* dismissed — fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("Flight copied — go on, brag a little");
    } catch {
      toast("Couldn't copy, sorry");
    }
  }

  /* ---------------------------------------------------------------- */
  /* pause                                                             */
  /* ---------------------------------------------------------------- */

  function pause(): void {
    if (screen !== "playing" || paused) return;
    paused = true;
    game.setPaused(true);
    screens.pause.hidden = false;
  }

  function resume(): void {
    if (!paused) return;
    paused = false;
    game.setPaused(false);
    screens.pause.hidden = true;
  }

  /* ---------------------------------------------------------------- */
  /* wiring                                                            */
  /* ---------------------------------------------------------------- */

  el("play").addEventListener("click", play);
  el("again").addEventListener("click", play);
  el("back").addEventListener("click", quit);
  el("share").addEventListener("click", () => void share());
  el("resume").addEventListener("click", resume);

  const setBoardSheet = (open: boolean) =>
    document.documentElement.classList.toggle("show-board", open);
  el("board-open").addEventListener("click", () => setBoardSheet(true));
  el("board-open-2").addEventListener("click", () => setBoardSheet(true));
  el("board-close").addEventListener("click", () => setBoardSheet(false));
  el("giveup").addEventListener("click", quit);
  screens.pause.addEventListener("pointerdown", (e) => {
    if (e.target === screens.pause) resume();
  });

  muteBtn.addEventListener("click", () => {
    muted = !muted;
    localStorage.setItem(LS.muted, muted ? "1" : "0");
    audio.setMuted(muted);
    paintMute();
  });

  nameInput.addEventListener("change", () => {
    name = nameInput.value.trim();
    localStorage.setItem(LS.name, name);
    paintBoard();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "m" && document.activeElement !== nameInput) {
      muteBtn.click();
      return;
    }
    if (screen === "playing") {
      if (e.key === "Escape") quit();
      else if (paused && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        resume();
      }
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      if (document.activeElement === nameInput && e.key === " ") return;
      e.preventDefault();
      play();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
  });
  window.addEventListener("blur", pause);

  /* ---------------------------------------------------------------- */
  /* go                                                                */
  /* ---------------------------------------------------------------- */

  paintSeedline();
  paintBoard();
  tickCountdown();
  setInterval(tickCountdown, 1000);
  ghosts = residentGhosts(seed, MIN_COMPANY);
  game.setGhosts(ghosts);
  void refreshBoard();
  void loadGhosts();

  document.documentElement.classList.add("ready");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
