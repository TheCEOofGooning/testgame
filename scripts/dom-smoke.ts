/**
 * DOM smoke test.
 *
 * Boots the *real* generated page in jsdom with a stubbed 2D context and
 * drives it like a player would: start a flight, fly for a while, die, read
 * the result card. Catches the whole class of bugs you'd otherwise only find
 * by opening a browser — missing element ids, broken screen transitions,
 * handlers wired to the wrong node.
 *
 *   npx tsx scripts/dom-smoke.ts
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const noop = () => undefined;

function fakeCtx(): any {
  const state: any = {
    canvas: null,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    font: "",
  };
  return new Proxy(state, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === "createLinearGradient" || p === "createRadialGradient") {
        return () => ({ addColorStop: noop });
      }
      if (p === "measureText") return () => ({ width: 10 });
      return noop;
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
  });
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const html = readFileSync("public/play.html", "utf8");
  const dom = new JSDOM(html, {
    url: "https://mothlight.test/",
    pretendToBeVisual: true,
  });

  const { window } = dom;
  const g = globalThis as any;

  (window as any).HTMLCanvasElement.prototype.getContext = function () {
    const c = fakeCtx();
    c.canvas = this;
    return c;
  };
  (window as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (window as any).matchMedia = () => ({
    matches: false,
    addEventListener: noop,
    removeEventListener: noop,
  });
  (window as any).AudioContext = undefined;

  const calls: string[] = [];
  (window as any).fetch = async (url: string, init?: any) => {
    calls.push(`${init?.method ?? "GET"} ${String(url).split("?")[0]}`);
    if (String(url).includes("/api/leaderboard")) {
      return {
        ok: true,
        json: async () => ({ seed: "x", offline: false, rows: [] }),
      };
    }
    if (String(url).includes("/api/ghosts")) {
      return { ok: true, json: async () => ({ ghosts: [] }) };
    }
    return { ok: true, json: async () => ({ ok: true, rank: 3, total: 11 }) };
  };

  g.window = window;
  g.document = window.document;
  Object.defineProperty(g, "navigator", {
    value: window.navigator,
    configurable: true,
  });
  g.localStorage = window.localStorage;
  Object.defineProperty(g, "location", {
    value: window.location,
    configurable: true,
  });
  g.HTMLElement = window.HTMLElement;
  g.HTMLInputElement = window.HTMLInputElement;
  g.ResizeObserver = (window as any).ResizeObserver;
  g.matchMedia = (window as any).matchMedia;
  g.fetch = (window as any).fetch;
  g.getComputedStyle = (el: any) => window.getComputedStyle(el);
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = noop;
  g.setInterval = (() => 0) as any;

  console.log("\n— page markup");
  const ids = [
    "canvas", "stage", "title", "result", "pause", "name", "seedline",
    "board-list", "board-sub", "board-empty", "countdown", "mute", "toast",
    "verdict", "score-value", "pb", "stat-metres", "stat-pollen", "stat-chain",
    "stat-rank", "stat-rank-label", "outflew", "play", "again", "back",
    "share", "resume", "giveup", "board-open", "board-open-2", "board-close",
  ];
  const missing = ids.filter((id) => !window.document.getElementById(id));
  check("every element the UI reaches for exists", missing.length === 0, missing.join(", "));
  check("the title card is in the HTML (paints before JS)", html.includes("MOTHLIGHT"));
  check("CSS is inlined (no render-blocking request)", html.includes("<style>"));
  check("the script is a deferred module", html.includes('type="module"'));

  console.log("\n— boot");
  const { boot } = await import("../src/ui");
  boot();
  check("boot() completed", window.document.documentElement.classList.contains("ready"));
  check("title screen visible", !window.document.getElementById("title")!.hasAttribute("hidden"));
  check("result screen hidden", window.document.getElementById("result")!.hasAttribute("hidden"));
  check(
    "seed line filled in",
    /Night/.test(window.document.getElementById("seedline")!.textContent ?? ""),
    window.document.getElementById("seedline")!.textContent ?? "",
  );

  await new Promise((r) => setTimeout(r, 60));
  check(
    "leaderboard + ghosts were fetched",
    calls.some((c) => c.includes("/api/leaderboard")) &&
      calls.some((c) => c.includes("/api/ghosts")),
    calls.join(", "),
  );
  check(
    "residents fill an empty board",
    (window.document.getElementById("board-list")!.children.length ?? 0) >= 4,
    `${window.document.getElementById("board-list")!.children.length} rows`,
  );

  console.log("\n— a flight, start to finish");
  (window.document.getElementById("name") as HTMLInputElement).value = "Tester";
  window.document.getElementById("play")!.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true }),
  );
  check(
    "clicking play switches to the game",
    window.document.documentElement.classList.contains("is-playing") &&
      window.document.getElementById("title")!.hasAttribute("hidden"),
  );

  // drive the simulation by hand (no rAF in jsdom worth trusting)
  const game: any = (globalThis as any).__mothlightGame;
  check("engine handle exposed for testing", Boolean(game));
  let steps = 0;
  while (game.phase !== "done" && steps < 120 * 240) {
    game.step(1 / 120);
    steps++;
  }
  check("the flight ended", game.phase === "done", `${(steps / 120).toFixed(1)}s`);

  await new Promise((r) => setTimeout(r, 60));
  check(
    "result screen shown",
    !window.document.getElementById("result")!.hasAttribute("hidden"),
  );
  const score = window.document.getElementById("score-value")!.textContent ?? "";
  check("score rendered", /\d/.test(score), score);
  check(
    "verdict rendered",
    (window.document.getElementById("verdict")!.textContent ?? "").length > 3,
    window.document.getElementById("verdict")!.textContent ?? "",
  );
  check(
    "ghost comparison rendered",
    !window.document.getElementById("outflew")!.hasAttribute("hidden"),
    window.document.getElementById("outflew")!.textContent ?? "",
  );
  check(
    "the run was submitted",
    calls.some((c) => c === "POST /api/run"),
  );
  await new Promise((r) => setTimeout(r, 40));
  check(
    "rank came back from the server",
    (window.document.getElementById("stat-rank")!.textContent ?? "").startsWith("#"),
    window.document.getElementById("stat-rank")!.textContent ?? "",
  );

  console.log("\n— going back");
  window.document.getElementById("back")!.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true }),
  );
  check(
    "back returns to the title screen",
    !window.document.getElementById("title")!.hasAttribute("hidden") &&
      !window.document.documentElement.classList.contains("is-playing"),
  );

  console.log(
    failures === 0 ? "\n✓ all DOM checks passed\n" : `\n✗ ${failures} check(s) failed\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
