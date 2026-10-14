/**
 * Takes a reproducible screenshot of the Act 2 escape moment from the production build.
 *
 *   npm run build && node scripts/shot-box.mjs [--webgl] [--mobile] [--seed=1812] [--name=box]
 *     [--port=3128] [--query=sim=cpu] [--shot=escape|breakout] [--do=marker,agent,branch,results,fork,lower]
 *
 * Starts `next start`, opens `/box?shot=escape` (the network layer off, the run stopped on the tick
 * of its first escape; `--shot=breakout` is the three-lab breakout preset stopped on its second breach) in Playwright Chromium at 1440x900, DPR 1 (--mobile: 390x844, DPR 3, touch),
 * waits for the engine to settle, the trials plot to fill and the loader to fade, asserts WebGPU
 * (unless --webgl), zero console errors or `THREE.` warnings, no two scene labels or marker buttons
 * overlapping and none cut by the scene's edge (as drawn, after the `--do` actions), and writes `.shots/<name>-<n>.png`
 * with the next free n. On --mobile it also scrolls the page and writes `<name>-<n>-panels.png`,
 * since the panels stack under the scene there. Launch strategies are tried in order, as in shot.mjs.
 */

import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT, startDevServer, stopDevServer, waitForServer } from "./lib/dev-server.mjs";
import { measureScene } from "./lib/scene-labels.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PORT = Number(value("port", 3128));
const BASE = `http://localhost:${PORT}`;
const SHOTS = path.join(ROOT, ".shots");

/** Playground states to reach before the shot: `marker` opens step 1's card, `agent` plays a card in agent mode, `branch` branches from step 1, `results` opens the Results view and runs its comparison, `fork` (after `results`) presses "Watch the branch" and shoots the map with its Branched pill, `lower` also shoots the page scrolled to its foot. */
const actions = value("do", "").split(",").filter(Boolean);

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
    if (!wantWebGL && !info.isWebGPU) return { ok: false, info, errors, threeWarnings, reason: "fell back to WebGL2" };
    if (actions.includes("rewind")) {
      // A pin on the timeline seeks the engine back to just before that step.
      await page.locator('[data-timeline-marker="3"]').click();
      await page.locator("[data-back-to-live]").waitFor({ timeout: 10_000 });
    }
    if (actions.includes("branch")) {
      await page.locator('[data-timeline-marker="1"]').click();
      await page.locator("[data-branch-from-here]").click();
      await page.locator("[data-branch]").click();
      await page.locator("[data-branch-result]").waitFor({ timeout: 30_000 });
    }
    if (actions.includes("results")) {
      if (!(await page.locator("[data-results-view]").isVisible())) await page.locator("[data-open-results]:visible").click();
      await page.locator("[data-results-view]").waitFor({ state: "visible", timeout: 10_000 });
      if (!(await page.locator("[data-branch-result]").count())) {
        await page.locator("[data-branch]").click();
        await page.locator("[data-branch-result]").waitFor({ timeout: 30_000 });
      }
    }
    if (actions.includes("fork")) {
      await page.locator("[data-watch-branch]").click();
      await page.locator("[data-branched-pill]").waitFor({ timeout: 10_000 });
    }
    // With the Results view up, the scene slot is hidden on purpose: its labs and labels are not on screen to check.
    const resultsShown = await page.locator("[data-results-view]").isVisible();
    if (actions.includes("marker") && !(await page.locator("[data-marker-card]").count())) await page.locator('[data-step-marker="1"]:visible').click();
    if (actions.includes("agent")) {
      await page.locator('[data-mode="agent"]').click();
      for (let i = 0; i < 3; i++) {
        const card = page.locator("[data-card]").first();
        if (!(await card.count())) break;
        await card.click();
      }
    }
    await page.waitForTimeout(actions.length ? 900 : 0);
    // The text as the shot shows it: after the actions, since a card or a rewind changes what is on the map.
    info.labels = await page.evaluate(() => {
      // The engine keeps its own hidden copies of the map text while the page draws it.
      const q = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length > 0);
      return {
        rings: q("[data-ring]").map((e) => e.textContent),
        markers: q("[data-marker]").map((e) => e.textContent),
        trail: q("[data-trail]").map((e) => e.textContent),
        // The map: lab names with their state, link names, the OUTSIDE label and the numbered step buttons.
        labNames: q("[data-lab-name]").map((e) => e.textContent),
        linkNames: q("[data-link-name]").map((e) => e.textContent),
        outside: q("[data-outside]").map((e) => e.textContent),
        stepMarkers: q("[data-step-marker]").map((e) => e.textContent),
        points: document.querySelector("svg[data-plot-points]")?.getAttribute("data-plot-points"),
      };
    });
    // Drawn boxes that touch, and boxes or labs the slot's edge cuts, as Chromium laid them out (not the placer's estimate).
    info.scene = await measureScene(page);
    info.resultsShown = resultsShown;
    // The camera as the shot shows it: a rewind or a branch puts the director on a beat.
    info.camera = await page.evaluate(() => JSON.parse(JSON.stringify(window.__swarm.box.camera)));
    const base = await nextShotBase();
    const outs = [`${base}.png`];
    await page.screenshot({ path: outs[0] });
    if (mobile || actions.includes("lower")) {
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
    console.log(`  labs: ${info.labels.labNames.join(" | ").replace(/\s+/g, " ")}`);
    console.log(`  links: ${info.labels.linkNames.join(" | ") || "(none)"}; outside: ${info.labels.outside.join(" | ") || "(none)"}`);
    console.log(`  steps: ${info.labels.stepMarkers.join(" ") || "(none)"}; camera ${info.camera?.mode}, focus ${info.camera?.focus ?? "none"}`);
  }
  for (const out of result.outs) console.log(`  saved ${path.relative(ROOT, out)}`);
  const { scene } = info;
  if (scene.slot) console.log(`  scene slot ${Math.round(scene.slot.width)}x${Math.round(scene.slot.height)} at ${Math.round(scene.slot.left)},${Math.round(scene.slot.top)}; labs ${scene.labs.map((l) => `${l.id} r${Math.round(l.r)}`).join(", ")}`);
  const problems = [
    ...result.errors,
    ...result.threeWarnings.map((w) => `THREE warning: ${w}`),
    ...scene.clashes.map((c) => `scene labels overlap: ${c}`),
    ...(info.resultsShown ? [] : scene.cut).map((c) => `scene label cut by the slot's edge: ${c}`),
    // On the overview every lab is in the scene; on a beat the director frames one lab on purpose.
    ...(!info.resultsShown && info.camera?.mode === "director" && !info.camera.focus ? scene.labsCut : []).map((id) => `lab not wholly inside the scene: ${id}`),
  ];
  if (problems.length) {
    console.error(`Console errors, warnings, label overlaps or cut-off labels (${problems.length}):`);
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
