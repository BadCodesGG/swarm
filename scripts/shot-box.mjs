/**
 * Takes a reproducible screenshot of the Act 2 escape moment from the production build.
 *
 *   npm run build && node scripts/shot-box.mjs [--webgl] [--mobile] [--seed=1812] [--name=box]
 *     [--port=3128] [--query=sim=cpu] [--shot=escape|breakout]
 *
 * Starts `next start`, opens `/box?shot=escape` (the network layer off, the run stopped on the tick
 * of its first escape; `--shot=breakout` is the three-lab breakout preset stopped on its second breach) in Playwright Chromium at 1440x900, DPR 1 (--mobile: 390x844, DPR 3, touch),
 * waits for the engine to settle, the trials plot to fill and the loader to fade, asserts WebGPU
 * (unless --webgl), zero console errors or `THREE.` warnings and no two scene labels overlapping, and writes `.shots/<name>-<n>.png`
 * with the next free n. On --mobile it also scrolls the page and writes `<name>-<n>-panels.png`,
 * since the panels stack under the scene there. Launch strategies are tried in order, as in shot.mjs.
 */

import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT, startDevServer, stopDevServer, waitForServer } from "./lib/dev-server.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PORT = Number(value("port", 3128));
const BASE = `http://localhost:${PORT}`;
const SHOTS = path.join(ROOT, ".shots");

const wantWebGL = flag("webgl");
const mobile = flag("mobile");
const name = value("name", `${mobile ? "box-mobile" : "box"}${wantWebGL ? "-webgl" : ""}`);
const query = new URLSearchParams({ shot: value("shot", "escape") });
const seed = value("seed", null);
if (seed !== null) query.set("seed", seed);
if (wantWebGL) query.set("webgl", "1");
for (const [k, v] of new URLSearchParams(value("query", ""))) query.set(k, v);
const url = `${BASE}/box?${query}`;

const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer", "--use-angle=d3d11", "--ignore-gpu-blocklist"];
const STRATEGIES = [
  { label: "headless shell + GPU flags", launch: { headless: true, args: GPU_ARGS } },
  { label: "new headless (channel chromium) + GPU flags", launch: { headless: true, channel: "chromium", args: GPU_ARGS } },
  { label: "headed + GPU flags", launch: { headless: false, args: GPU_ARGS } },
  { label: "headless + SwiftShader WebGPU adapter", launch: { headless: true, args: [...GPU_ARGS, "--use-webgpu-adapter=swiftshader"] } },
];

async function nextShotBase() {
  await mkdir(SHOTS, { recursive: true });
  const taken = (await readdir(SHOTS))
    .map((f) => f.match(new RegExp(`^${name}-(\\d+)\\.png$`)))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const n = taken.length ? Math.max(...taken) + 1 : 1;
  return path.join(SHOTS, `${name}-${n}`);
}

async function attempt(strategy) {
  const browser = await chromium.launch(strategy.launch);
  const errors = [];
  const threeWarnings = [];
  try {
    const context = await browser.newContext(
      mobile
        ? {
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 3,
            isMobile: true,
            hasTouch: true,
            userAgent:
              "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
          }
        : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    );
    const page = await context.newPage();
    page.on("console", (msg) => {
      const text = msg.text();
      if (msg.type() === "error") errors.push(text);
      else if (text.includes("THREE.")) threeWarnings.push(text);
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => window.__swarm?.box?.settled === true, null, { timeout: 120_000 });
    await page.waitForSelector('[data-plot-ready="true"]', { timeout: 120_000 });
    // The loader fades over 1.2 s once the engine is up.
    await page.waitForTimeout(1600);
    const info = await page.evaluate(() => JSON.parse(JSON.stringify(window.__swarm.box)));
    info.labels = await page.evaluate(() => ({
      rings: [...document.querySelectorAll("[data-ring]")].map((e) => e.textContent),
      markers: [...document.querySelectorAll("[data-marker]")].map((e) => e.textContent),
      trail: [...document.querySelectorAll("[data-trail]")].map((e) => e.textContent),
      // The map: lab names with their state, link names, the OUTSIDE label and the numbered step buttons.
      labNames: [...document.querySelectorAll("[data-lab-name]")].map((e) => e.textContent),
      linkNames: [...document.querySelectorAll("[data-link-name]")].map((e) => e.textContent),
      outside: [...document.querySelectorAll("[data-outside]")].map((e) => e.textContent),
      stepMarkers: [...document.querySelectorAll("[data-step-marker]")].map((e) => e.textContent),
      points: document.querySelector("svg[data-plot-points]")?.getAttribute("data-plot-points"),
      // Scene labels whose drawn boxes touch, as Chromium lays the text out (not the placer's estimate).
      clashes: (() => {
        const boxes = [...document.querySelectorAll("[data-ring], [data-marker], [data-trail], [data-lab-name], [data-link-name], [data-outside]")].map((e) => ({ text: e.textContent, r: e.getBoundingClientRect() }));
        const out = [];
        boxes.forEach((a, i) => {
          for (const b of boxes.slice(i + 1)) {
            if (a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom) out.push(`"${a.text}" / "${b.text}"`);
          }
        });
        return out;
      })(),
    }));
    if (!wantWebGL && !info.isWebGPU) return { ok: false, info, errors, threeWarnings, reason: "fell back to WebGL2" };
    const base = await nextShotBase();
    const outs = [`${base}.png`];
    await page.screenshot({ path: outs[0] });
    if (mobile) {
      await page.evaluate(() => {
        const scroller = document.querySelector("[data-plot-ready]");
        scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
      });
      await page.waitForTimeout(400);
      outs.push(`${base}-panels.png`);
      await page.screenshot({ path: outs[1] });
    }
    return { ok: true, info, errors, threeWarnings, outs };
  } finally {
    await browser.close();
  }
}

const server = startDevServer(PORT, "start");
let exitCode = 1;
try {
  await waitForServer(BASE);
  let result = null;
  for (const strategy of STRATEGIES) {
    console.log(`Trying: ${strategy.label}`);
    try {
      result = await attempt(strategy);
    } catch (err) {
      console.log(`  failed: ${err.message.split("\n")[0]}`);
      continue;
    }
    if (result.ok) {
      console.log(`  worked: ${strategy.label}`);
      break;
    }
    console.log(`  rejected: ${result.reason}`);
  }
  if (!result?.ok) throw new Error("No launch strategy produced a frame");
  const { info } = result;
  console.log(`  ${url}`);
  console.log(
    `  ${info.isWebGPU ? "WebGPU" : "WebGL2"}, tier ${info.tier}, crowd ${info.crowd.mode} x${info.crowd.count}, seed ${info.seed}, ` +
      `tick ${info.stats.tick}, caught ${info.stats.caught}, escaped ${info.stats.escaped}, frame ${info.frame}`,
  );
  console.log(`  rings: ${info.labels.rings.join(" | ")}`);
  console.log(`  markers: ${info.labels.markers.join(" | ") || "(none)"}`);
  console.log(`  trail: ${info.labels.trail.join(" | ") || "(none)"}; plotted ${info.labels.points}`);
  if (info.labels.labNames.length) {
    console.log(`  labs: ${info.labels.labNames.join(" | ").replace(/s+/g, " ")}`);
    console.log(`  links: ${info.labels.linkNames.join(" | ") || "(none)"}; outside: ${info.labels.outside.join(" | ") || "(none)"}`);
    console.log(`  steps: ${info.labels.stepMarkers.join(" ") || "(none)"}; camera ${info.camera?.mode}, focus ${info.camera?.focus ?? "none"}`);
  }
  for (const out of result.outs) console.log(`  saved ${path.relative(ROOT, out)}`);
  const problems = [
    ...result.errors,
    ...result.threeWarnings.map((w) => `THREE warning: ${w}`),
    ...info.labels.clashes.map((c) => `scene labels overlap: ${c}`),
  ];
  if (problems.length) {
    console.error(`Console errors, warnings or label overlaps (${problems.length}):`);
    for (const e of problems) console.error(`  ${e}`);
  } else {
    exitCode = 0;
  }
} catch (err) {
  console.error(err.message);
} finally {
  stopDevServer(server);
}
process.exit(exitCode);
