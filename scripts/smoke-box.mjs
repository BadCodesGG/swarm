/**
 * Smoke steps for Act 2, The Box, for `scripts/smoke.mjs` to append to its STEPS:
 *
 *   import { boxSteps } from "./smoke-box.mjs";
 *   const STEPS = [stepLanding, ...boxSteps({ check, openPage, software: SOFTWARE })];
 *
 *   4. `/box?seed=1`: each layer switch changes `__swarm.box.config`; with every layer off an agent
 *      escapes within ESCAPE_TIMEOUT_MS and the "What just happened" explainer appears, then names a
 *      layer to turn on once the worker's replay has proved it; "Run 100 trials" adds a plotted
 *      point within TRIALS_TIMEOUT_MS.
 *   6. The playground: a plain `/box` opens the breakout preset with its strip of presets; the lab
 *      selector changes `data-lab` on the one layer panel; a layer flip on one lab reaches that lab
 *      only; "Edit world" adds and removes a lab; a share link restores the scenario in a fresh page;
 *      one agent card played puts a line in the turn log.
 *   7. `/box?shot=breakout`: a marker click and the key 2 open a detail card that names the layers
 *      that would have stopped it, Escape closes it, a branch from a marker shows both outcomes, and
 *      "Replay with this switched on" reruns with that layer on.
 *   5. `?webgl=1` on both acts: `isWebGPU === false` and frames advance; on the Box the crowd runs
 *      on the CPU worker (`crowd.mode === "cpu"`). With a real GPU, `/box?sim=cpu` also runs the CPU
 *      crowd and plain `/box` runs the GPU one.
 *
 * Every step fails on any console error, page error or `THREE.` warning (via `openPage`'s watcher).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LAYERS = ["sandbox", "permissions", "network", "monitor", "audit"];
const READY_TIMEOUT_MS = 60_000;
/** All layers off: rogues act about every 2 s and need three to five steps. */
const ESCAPE_TIMEOUT_MS = 90_000;
const TRIALS_TIMEOUT_MS = 90_000;
/** The replay runs the escape's ticks again, once per off layer, in the worker. */
const RERUN_TIMEOUT_MS = 30_000;

const box = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__swarm?.box ?? null)));

async function waitForFrames(page, act, min = 10) {
  await page.waitForFunction(([a, n]) => (window.__swarm?.[a]?.frame ?? 0) > n, [act, min], { timeout: READY_TIMEOUT_MS });
}

/** Steps 4 and 5. `check(label, ok, detail)` and `openPage(browser, route)` are smoke.mjs's own. */
export function boxSteps({ check, openPage, software = false }) {
  async function stepBox(browser) {
    console.log("-- 4. box");
    const { context, page, problems, response } = await openPage(browser, "/box?seed=1");
    try {
      check("/box is 200", response?.status() === 200, String(response?.status()));
      await waitForFrames(page, "box");
      const start = await box(page);
      check("/box runs the simulation", start.stats.tick > 0, `tick ${start.stats.tick}, ${start.crowd.count} agents, crowd ${start.crowd.mode}`);

      for (const layer of LAYERS) {
        const before = (await box(page)).config.layers[layer];
        await page.locator(`input[data-layer="${layer}"]`).setChecked(!before, { force: true });
        await page
          .waitForFunction(([l, b]) => window.__swarm.box.config.layers[l] !== b, [layer, before], { timeout: 5_000 })
          .catch(() => {});
        const after = (await box(page)).config.layers[layer];
        check(`switching ${layer} changes __swarm.box.config`, after === !before, `${before} -> ${after}`);
        await page.locator(`input[data-layer="${layer}"]`).setChecked(before, { force: true });
        await page.waitForFunction(([l, b]) => window.__swarm.box.config.layers[l] === b, [layer, before], { timeout: 5_000 });
      }

      for (const layer of LAYERS) await page.locator(`input[data-layer="${layer}"]`).setChecked(false, { force: true });
      const off = await box(page);
      check("every layer can be switched off", LAYERS.every((l) => off.config.layers[l] === false));
      const t0 = Date.now();
      await page.waitForFunction(() => (window.__swarm?.box?.stats?.escaped ?? 0) > 0, null, { timeout: ESCAPE_TIMEOUT_MS });
      const escaped = await box(page);
      check("all layers off lets an agent escape", escaped.stats.escaped > 0, `${escaped.stats.escaped} out by tick ${escaped.stats.tick}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      await page.locator('section[aria-label="What just happened"]').waitFor({ timeout: 5_000 });
      check("the escape explainer appears", true);
      // The rerun button waits for the worker's replay, which proves the layer it names would have stopped that agent.
      const rerun = page.locator("[data-rerun]");
      await rerun.waitFor({ timeout: RERUN_TIMEOUT_MS });
      const named = await rerun.getAttribute("data-rerun");
      check("the explainer names a layer to turn on and rerun", LAYERS.includes(named), named);
      const card = await page.locator('section[aria-label="What just happened"] li', { hasText: named.toUpperCase() }).innerText();
      check("that layer's card agrees", card.includes("nothing to stop it"), card.replace(/\s+/g, " "));

      const plotted = () => page.locator("svg[data-plot-points]").getAttribute("data-plot-points").then(Number);
      const pointsBefore = await plotted();
      const t1 = Date.now();
      await page.locator("[data-run-trials]").click();
      await page.waitForFunction((n) => Number(document.querySelector("svg[data-plot-points]")?.getAttribute("data-plot-points")) > n, pointsBefore, {
        timeout: TRIALS_TIMEOUT_MS,
      });
      check('"Run 100 trials" adds a plotted point', (await plotted()) > pointsBefore, `${pointsBefore} -> ${await plotted()} in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
      check("/box logged no console errors or THREE warnings", problems.length === 0, problems.join(" | "));
    } finally {
      await context.close();
    }
  }

  async function stepWebGL(browser) {
    console.log("-- 5. WebGL2 fallback and crowd modes");
    const runs = [
      { route: "/inside?webgl=1", act: "inside", expect: { isWebGPU: false } },
      { route: "/box?webgl=1&seed=1", act: "box", expect: { isWebGPU: false, mode: "cpu" } },
    ];
    if (!software) {
      runs.push({ route: "/box?sim=cpu&seed=1", act: "box", expect: { isWebGPU: true, mode: "cpu" } });
      runs.push({ route: "/box?seed=1", act: "box", expect: { isWebGPU: true, mode: "gpu" } });
    }
    for (const run of runs) {
      const { context, page, problems } = await openPage(browser, run.route);
      try {
        await waitForFrames(page, run.act);
        const first = await page.evaluate((a) => window.__swarm[a].frame, run.act);
        await page.waitForFunction(([a, f]) => window.__swarm[a].frame > f + 10, [run.act, first], { timeout: READY_TIMEOUT_MS });
        const info = await page.evaluate((a) => JSON.parse(JSON.stringify(window.__swarm[a])), run.act);
        check(`${run.route}: isWebGPU is ${run.expect.isWebGPU}`, info.isWebGPU === run.expect.isWebGPU, String(info.isWebGPU));
        if (run.expect.mode) check(`${run.route}: crowd runs on the ${run.expect.mode.toUpperCase()}`, info.crowd?.mode === run.expect.mode, info.crowd?.mode);
        if (run.act === "box") {
          const t = info.stats.tick;
          await page.waitForFunction((tick) => window.__swarm.box.stats.tick > tick + 5, t, { timeout: READY_TIMEOUT_MS });
          check(`${run.route}: the simulation advances`, true, `past tick ${t + 5}`);
        }
        check(`${run.route}: frames advance, no console errors or THREE warnings`, problems.length === 0, problems.join(" | "));
      } finally {
        await context.close();
      }
    }
  }

  const labsOf = async (page) => (await box(page)).labs;
  const layerSig = (labs) => labs.map((l) => `${l.id}:${Object.values(l.layers).map(Number).join("")}`).join(" ");

  /** A plain /box: the strip, the lab selector, the builder, the share round trip, the two play modes. */
  async function stepPlayground(browser) {
    console.log("-- 6. the playground");
    const { context, page, problems } = await openPage(browser, "/box");
    try {
      await waitForFrames(page, "box");
      const presets = await page.locator("[data-preset]").evaluateAll((els) => els.map((e) => `${e.dataset.preset}:${e.getAttribute("aria-pressed")}`));
      check("the preset strip offers five presets, breakout current on a first visit", presets.length === 5 && presets[0] === "breakout:true", presets.join(" "));
      const labs = await labsOf(page);
      check("a first visit opens the breakout preset's three labs", labs.map((l) => l.id).join() === "meridian,kestrel,halcyon", labs.map((l) => l.id).join());

      check("one layer panel, five layer inputs", (await page.locator("input[data-layer]").count()) === 5);
      check("the panel starts on the first lab", (await page.locator("form[data-lab]").getAttribute("data-lab")) === "meridian");
      await page.locator('[data-lab-tab="kestrel"]').click();
      check("the lab selector changes data-lab", (await page.locator("form[data-lab]").getAttribute("data-lab")) === "kestrel");
      check("still one set of layer inputs", (await page.locator("input[data-layer]").count()) === 5);
      const net = (await labsOf(page))[1].layers.network;
      await page.locator('input[data-layer="network"]').setChecked(!net, { force: true });
      await page.waitForFunction((n) => window.__swarm.box.labs[1].layers.network !== n, net, { timeout: 5_000 });
      const after = await labsOf(page);
      check("a flip on KESTREL reaches KESTREL only", after[1].layers.network === !net && after[0].layers.network === labs[0].layers.network && after[2].layers.network === labs[2].layers.network);

      await page.locator('[data-preset="air-gapped"]').click();
      await page.waitForFunction(() => window.__swarm.box.links.length === 0 && window.__swarm.box.labs.length === 3, null, { timeout: 10_000 });
      check("a preset click loads it (air gapped has no links)", (await page.locator('[data-preset="air-gapped"]').getAttribute("aria-pressed")) === "true");

      await page.locator("[data-edit-world]").click();
      await page.locator("[data-add-lab]").click();
      await page.waitForFunction(() => window.__swarm.box.labs.length === 4, null, { timeout: 10_000 });
      check("Edit world adds a lab", true, "4 labs");
      await page.locator('[data-remove-lab="orrery"]').click();
      await page.waitForFunction(() => window.__swarm.box.labs.length === 3, null, { timeout: 10_000 });
      check("and removes it again", true, "3 labs");

      await page.locator('[data-lab-tab="halcyon"]').click();
      const before = (await labsOf(page))[2].layers.sandbox;
      await page.locator('input[data-layer="sandbox"]').setChecked(!before, { force: true });
      await page.waitForFunction((b) => window.__swarm.box.labs[2].layers.sandbox !== b, before, { timeout: 5_000 });
      await page.locator("[data-copy-link]").click();
      await page.locator("[data-share-status]").filter({ hasText: /\w/ }).waitFor({ timeout: 5_000 });
      const shared = await page.evaluate(() => window.location.pathname + window.location.search);
      const wanted = layerSig(await labsOf(page));
      check("Copy link puts the scenario in the address bar", shared.includes("b=halcyon"), shared.slice(0, 80));
      const second = await openPage(browser, shared);
      try {
        await waitForFrames(second.page, "box");
        const got = layerSig(await labsOf(second.page));
        check("loading the shared link restores the scenario", got === wanted, `${wanted} vs ${got}`);
        check("the restored page logged no errors", second.problems.length === 0, second.problems.join(" | "));
      } finally {
        await second.context.close();
      }

      await page.locator('[data-mode="agent"]').click();
      await page.locator("[data-card]").first().click();
      await page.locator('[data-turn-log] [data-turn="1"]').waitFor({ timeout: 5_000 });
      check("one agent-mode card played puts a line in the turn log", true, (await page.locator('[data-turn="1"]').innerText()).replace(/\s+/g, " ").slice(0, 100));
      await page.locator('[data-mode="defend"]').click();
      await page.locator("[data-defender-score]").waitFor({ timeout: 5_000 });
      check("defend mode shows a score", true, await page.locator("[data-defender-score]").innerText());
      check("/box logged no console errors or THREE warnings", problems.length === 0, problems.join(" | "));
    } finally {
      await context.close();
    }
  }

  /** The breakout shot: markers, cards, the 1 to 9 keys, a branch, and the replay with a layer on. */
  async function stepDebrief(browser) {
    console.log("-- 7. markers, cards and branches");
    const { context, page, problems } = await openPage(browser, "/box?shot=breakout");
    try {
      await page.waitForFunction(() => window.__swarm?.box?.settled === true, null, { timeout: READY_TIMEOUT_MS });
      await page.waitForFunction(() => window.__swarm.box.markers.length > 0 && window.__swarm.box.markers.every((m) => m.title), null, { timeout: 30_000 });
      const markers = (await box(page)).markers;
      check("the breakout shot numbers its steps", markers.length >= 2, markers.map((m) => `${m.n}:${m.title}`).join(" | "));
      await page.locator('[data-step-marker="1"]:visible').click();
      const cardOne = page.locator('[data-marker-card="1"]');
      await cardOne.waitFor({ timeout: 5_000 });
      const text = await cardOne.innerText();
      check("a marker click opens its card", text.includes("WOULD HAVE STOPPED IT"), text.replace(/\s+/g, " ").slice(0, 120));
      await page.keyboard.press("2");
      await page.locator('[data-marker-card="2"]').waitFor({ timeout: 5_000 });
      check("the key 2 opens card 2", true);
      await page.keyboard.press("Escape");
      await page.locator("[data-marker-card]").waitFor({ state: "detached", timeout: 5_000 });
      check("Escape closes the card", true);

      await page.locator('[data-timeline-marker="1"]').click();
      await page.locator("[data-branch]").click();
      await page.locator("[data-branch-result]").waitFor({ timeout: 30_000 });
      const rows = await page.locator("[data-branch-result] tbody tr").allInnerTexts();
      check("a branch from a marker shows both outcomes side by side", rows.length === 4, rows.join(" / ").replace(/\s+/g, " "));

      // The pin on the timeline opened step 1's card too.
      const replay = page.locator("[data-replay-with]").first();
      await replay.waitFor({ timeout: 5_000 });
      const layer = await replay.getAttribute("data-replay-with");
      await replay.click();
      await page.waitForFunction(() => window.__swarm.box.stats.tick < 200 && window.__swarm.box.playing, null, { timeout: 10_000 });
      const rerun = await box(page);
      check('"Replay with this switched on" reruns from the start with that layer on', rerun.labs.some((l) => l.layers[layer]), `${layer} on, tick ${rerun.stats.tick}`);
      check("the breakout shot logged no console errors or THREE warnings", problems.length === 0, problems.join(" | "));
    } finally {
      await context.close();
    }
  }

  return [stepBox, stepPlayground, stepDebrief, stepWebGL];
}

// --- `node scripts/smoke-box.mjs [--port=3134]`: only Act 2's steps, against the production build ---
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { chromium } = await import("playwright");
  const { ROOT, startDevServer, stopDevServer, waitForServer } = await import("./lib/dev-server.mjs");
  const port = Number((process.argv.find((a) => a.startsWith("--port=")) ?? "--port=3134").slice(7));
  const base = `http://localhost:${port}`;
  const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer", "--use-angle=d3d11", "--ignore-gpu-blocklist"];
  const check = (label, ok, detail = "") => {
    if (!ok) throw new Error(`${label}${detail ? ` (${detail})` : ""}`);
    console.log(`PASS  ${label}${detail ? ` (${detail})` : ""}`);
  };
  const openPage = async (browser, route) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const problems = [];
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(m.text());
      else if (m.text().includes("THREE.")) problems.push(`warning: ${m.text()}`);
    });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    const response = await page.goto(`${base}${route}`, { waitUntil: "load" });
    return { context, page, problems, response };
  };
  if (!existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    console.error("FAIL  no production build: run `npm run build` first");
    process.exit(1);
  }
  let code = 1;
  const server = startDevServer(port, "start");
  try {
    await waitForServer(base);
    const browser = await chromium.launch({ headless: true, channel: "chromium", args: GPU_ARGS });
    try {
      for (const step of boxSteps({ check, openPage })) await step(browser);
    } finally {
      await browser.close();
    }
    console.log("BOX SMOKE OK");
    code = 0;
  } catch (err) {
    console.error(`box smoke failed: ${err.message}`);
  } finally {
    stopDevServer(server);
  }
  process.exit(code);
}
