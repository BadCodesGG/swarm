/**
 * Takes a reproducible screenshot of the Act 1 hero frame from the production build.
 *
 *   npm run build && node scripts/shot.mjs [--seed=50] [--t=944] [--source=medium] [--rate=4]
 *     [--webgl] [--mobile] [--name=hero] [--port=3127] [--query=select=5]
 *
 * Starts `next start`, opens `/inside?shot=hero&source=..&seed=..&t=..` in Playwright Chromium at
 * 1440x900, DPR 1 (--mobile: 390x844, DPR 3, touch), waits for the shot clock to settle and the
 * loader to fade, asserts WebGPU (unless --webgl) and zero console errors or `THREE.` warnings, and
 * writes `.shots/<name>-<n>.png` with the next free n. Launch strategies are tried in order, since
 * WebGPU in automated Chromium depends on headless mode and GPU flags; the one that worked is printed.
 * Omitted --seed, --t and --rate use the page's own hero defaults.
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

const PORT = Number(value("port", 3127));
const BASE = `http://localhost:${PORT}`;
const SHOTS = path.join(ROOT, ".shots");

const wantWebGL = flag("webgl");
const mobile = flag("mobile");
const name = value("name", `${mobile ? "inside-mobile" : "inside"}${wantWebGL ? "-webgl" : ""}`);
const query = new URLSearchParams({ shot: "hero", source: value("source", "medium") });
for (const k of ["seed", "t", "rate"]) {
  const v = value(k, null);
  if (v !== null) query.set(k, v);
}
if (wantWebGL) query.set("webgl", "1");
for (const [k, v] of new URLSearchParams(value("query", ""))) query.set(k, v);
const url = `${BASE}/inside?${query}`;

const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer", "--use-angle=d3d11", "--ignore-gpu-blocklist"];
const STRATEGIES = [
  { label: "headless shell + GPU flags", launch: { headless: true, args: GPU_ARGS } },
  { label: "new headless (channel chromium) + GPU flags", launch: { headless: true, channel: "chromium", args: GPU_ARGS } },
  { label: "headed + GPU flags", launch: { headless: false, args: GPU_ARGS } },
  { label: "headless + SwiftShader WebGPU adapter", launch: { headless: true, args: [...GPU_ARGS, "--use-webgpu-adapter=swiftshader"] } },
];

async function nextShotPath() {
  await mkdir(SHOTS, { recursive: true });
  const taken = (await readdir(SHOTS))
    .map((f) => f.match(new RegExp(`^${name}-(\\d+)\\.png$`)))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const n = taken.length ? Math.max(...taken) + 1 : 1;
  return path.join(SHOTS, `${name}-${n}.png`);
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
    await page.waitForFunction(() => window.__swarm?.inside?.settled === true, null, { timeout: 120_000 });
    // The loader fades over 1.2 s once the engine is up.
    await page.waitForTimeout(1600);
    const info = await page.evaluate(() => ({ ...window.__swarm.inside }));
    info.labels = await page.evaluate(() => ({
      stations: [...document.querySelectorAll("[data-station]")].map((e) => e.textContent),
      probes: [...document.querySelectorAll("[data-probe]")].map((e) => e.textContent),
    }));
    // Where the shot's focus and the orchestrator land on the canvas (CSS px), for zoomed crops.
    info.focusAt = await page.evaluate(() => {
      const s = window.__swarm.inside;
      const o = s.overlay?.();
      const anchor = o?.anchors?.find((a) => a.id === s.camera.agent) ?? null;
      return { focus: anchor ? { x: Math.round(anchor.x), y: Math.round(anchor.y), r: Math.round(anchor.r) } : null, core: o?.core ? { x: Math.round(o.core.x), y: Math.round(o.core.y) } : null };
    });
    if (!wantWebGL && !info.isWebGPU) return { ok: false, info, errors, threeWarnings, reason: "fell back to WebGL2" };
    const out = await nextShotPath();
    await page.screenshot({ path: out });
    return { ok: true, info, errors, threeWarnings, out };
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
    `  ${info.isWebGPU ? "WebGPU" : "WebGL2"}, tier ${info.tier}, ${info.source} seed ${info.seed}, t=${info.t.toFixed(2)} rate ${info.rate}, ` +
      `frame ${info.frame}, ${info.agentsAlive} subagents live, ${info.streaks} streaks, ${info.probes} probes, selected ${info.selected}, ` +
      `active [${info.activeStations.join(", ")}]`,
  );
  const cam = info.camera ?? {};
  console.log(
    `  camera ${cam.mode} ${cam.kind} agent ${cam.agent} flight ${cam.flight} distance ${cam.distance}; ` +
      `focus at ${info.focusAt?.focus ? `${info.focusAt.focus.x},${info.focusAt.focus.y} r${info.focusAt.focus.r}` : "(none)"}; ` +
      `core at ${info.focusAt?.core ? `${info.focusAt.core.x},${info.focusAt.core.y}` : "(none)"}`,
  );
  console.log(`  stations: ${info.labels.stations.join(" | ")}`);
  console.log(`  probes: ${info.labels.probes.join(" | ") || "(none)"}`);
  console.log(`  saved ${path.relative(ROOT, result.out)}`);
  const problems = [...result.errors, ...result.threeWarnings.map((w) => `THREE warning: ${w}`)];
  if (problems.length) {
    console.error(`Console errors or warnings (${problems.length}):`);
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
