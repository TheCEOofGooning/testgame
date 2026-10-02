/**
 * Screenshots the real game UI in real Chromium, against a running server.
 *
 *   node scripts/uishot.mjs <path> <out.png> [w] [h] [script] [waitMs] [waitForId]
 *
 *   script     JS evaluated in the page before the shot, to drive the UI
 *              (click play, move the pointer, press a key…)
 *   waitMs     settle time before the shutter, in milliseconds
 *   waitForId  wait until the element with this id is no longer [hidden]
 *              — how the result-card screenshot waits out a whole flight
 */
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { execSync } from "node:child_process";

/*
 * The two packages below are deliberately NOT in package.json: between them
 * they weigh about 70 MB, and nobody building or playing the game needs
 * them. Install them only when you want to take screenshots:
 *
 *   npm i --no-save puppeteer-core @sparticuz/chromium
 *
 * @sparticuz/chromium ships a Chromium build and its NSS libraries inside
 * the npm tarball, which is how this works on machines that cannot reach
 * Google's or Playwright's download CDNs.
 */
let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.error(
    "scripts/uishot.mjs needs a browser.\n" +
      "  npm i --no-save puppeteer-core @sparticuz/chromium",
  );
  process.exit(1);
}

const PKG = "node_modules/@sparticuz/chromium/bin";
const LIB = "/tmp/cl/lib";
if (!fs.existsSync(LIB)) {
  fs.mkdirSync("/tmp/cl", { recursive: true });
  fs.writeFileSync("/tmp/al2023.tar", zlib.brotliDecompressSync(fs.readFileSync(path.join(PKG, "al2023.tar.br"))));
  execSync("tar xf /tmp/al2023.tar -C /tmp/cl");
}
if (!fs.existsSync("/tmp/chromium")) {
  fs.writeFileSync("/tmp/chromium", zlib.brotliDecompressSync(fs.readFileSync(path.join(PKG, "chromium.br"))));
  fs.chmodSync("/tmp/chromium", 0o755);
}

const [
  ,
  ,
  urlPath = "/",
  out = "ui.png",
  w = "1440",
  h = "900",
  script = "",
  waitMs = "450",
  waitVisible = "",
] = process.argv;

const browser = await puppeteer.launch({
  executablePath: "/tmp/chromium",
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: `${LIB}:/tmp`, FONTCONFIG_PATH: "/tmp/fonts", HOME: "/tmp" },
  args: [
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
    "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars",
    "--font-render-hinting=none", "--force-color-profile=srgb",
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
page.on("console", (m) => { if (m.type() === "error") console.log("  [page error]", m.text()); });
page.on("pageerror", (e) => console.log("  [page exception]", e.message));

await page.goto(`http://127.0.0.1:3000${urlPath}`, { waitUntil: "networkidle0", timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
if (script) await page.evaluate(script);
if (waitVisible) {
  await page.waitForFunction(
    (id) => {
      const n = document.getElementById(id);
      return Boolean(n) && !n.hasAttribute("hidden");
    },
    { timeout: 120000, polling: 250 },
    waitVisible,
  );
}
await new Promise((r) => setTimeout(r, Number(waitMs)));
await page.screenshot({ path: out });
console.log("→", out, `${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
await browser.close();
