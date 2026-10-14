/**
 * Screenshots of the site-wide furniture from the production build: a first-visit tour step on each
 * act, the "?" shortcut sheet, the WebGL 2 badge, the hand-off, the landing doors and the About
 * page's Act 2 section, each at 1440x900 and at 390x844.
 *
 *   npm run build && node scripts/shot-site.mjs [--port=3141] [--only=tour-inside,landing]
 *
 * Writes `.shots/site-<name>-<d|m>.png` (d: desktop, m: phone), replacing the last run's. The tour
 * is forced with `?tour=1` (scripted browsers skip it otherwise); the acts run on their fixed shot
 * clock so a frame is repeatable. Any console error or `THREE.` warning fails the run.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT, startDevServer, stopDevServer, waitForServer } from "./lib/dev-server.mjs";

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(value("port", 3141));
const BASE = `http://localhost:${PORT}`;
const SHOTS = path.join(ROOT, ".shots");
const ONLY = value("only", "").split(",").filter(Boolean);

const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer", "--use-angle=d3d11", "--ignore-gpu-blocklist"];

const VIEWPORTS = {
  d: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  m: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const INSIDE = "shot=hero&source=medium&seed=50";
const settled = (act) => (page) => page.waitForFunction((a) => window.__swarm?.[a]?.settled === true, act, { timeout: 120_000 }).then(() => page.waitForTimeout(1600));

/** [name, route, prepare(page)] */
const SHOTS_LIST = [
  ["tour-inside", `/inside?${INSIDE}&tour=1`, async (page) => {
    await settled("inside")(page);
    await page.locator("[data-dialog=tour-inside] [data-tour-next]").click();
    await page.waitForTimeout(300);
  }],
  ["tour-box", "/box?shot=breakout&tour=1", async (page) => {
    await settled("box")(page);
    await page.locator("[data-dialog=tour-box]").waitFor();
    await page.locator("[data-dialog=tour-box] [data-tour-next]").click();
    await page.waitForTimeout(300);
  }],
  ["help-inside", `/inside?${INSIDE}`, async (page) => {
    await settled("inside")(page);
    await page.keyboard.press("?");
    await page.locator("[data-dialog=help-inside]").waitFor();
  }],
  ["help-box", "/box?shot=breakout", async (page) => {
    await settled("box")(page);
    await page.keyboard.press("?");
    await page.locator("[data-dialog=help-box]").waitFor();
  }],
  ["badge-inside", `/inside?${INSIDE}&webgl=1`, async (page) => {
    await settled("inside")(page);
    await page.locator("[data-webgl-badge]").first().waitFor();
  }],
  ["badge-box", "/box?shot=breakout&webgl=1", async (page) => {
    await settled("box")(page);
    await page.locator("[data-webgl-badge]").first().waitFor();
  }],
  ["handoff-box", "/box?from=inside&agents=18&models=opus,sonnet,haiku", async (page) => {
    await page.locator("[data-handoff-note]").waitFor();
    await page.waitForTimeout(2500);
  }],
  ["landing", "/", async (page) => {
    await page.waitForLoadState("load");
  }],
  ["about-act2", "/about#act-2", async (page) => {
    await page.locator("#act-2").scrollIntoViewIfNeeded();
    await page.evaluate(() => document.getElementById("act-2")?.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(300);
  }],
];

const server = startDevServer(PORT, "start");
let exitCode = 1;
try {
  await waitForServer(BASE);
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "chromium", args: GPU_ARGS });
  try {
    for (const [name, route, prepare] of SHOTS_LIST) {
      if (ONLY.length && !ONLY.includes(name)) continue;
      for (const [vp, options] of Object.entries(VIEWPORTS)) {
        const context = await browser.newContext(options);
        try {
          const page = await context.newPage();
          const problems = [];
          page.on("console", (msg) => {
            const text = msg.text();
            if (msg.type() === "error" || text.includes("THREE.")) problems.push(text);
          });
          page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
          await page.goto(`${BASE}${route}`, { waitUntil: "load" });
          await prepare(page);
          const out = path.join(SHOTS, `site-${name}-${vp}.png`);
          await page.screenshot({ path: out });
          console.log(`${problems.length ? "WARN" : "ok  "} ${out}${problems.length ? `  ${problems.join(" | ")}` : ""}`);
          if (problems.length) throw new Error(`${name}-${vp}: console problems`);
        } finally {
          await context.close();
        }
      }
    }
    exitCode = 0;
  } finally {
    await browser.close();
  }
} catch (err) {
  console.error(`shot-site failed: ${err.message}`);
} finally {
  stopDevServer(server);
}
process.exit(exitCode);
