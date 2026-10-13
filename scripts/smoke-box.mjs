/**
 * Smoke steps for Act 2, The Box, for `scripts/smoke.mjs` to append to its STEPS:
 *
 *   import { boxSteps } from "./smoke-box.mjs";
 *   const STEPS = [stepLanding, ...boxSteps({ check, openPage, software: SOFTWARE })];
 *
 *   4. `/box?seed=1`: each layer switch changes `__swarm.box.config`; with every layer off an agent
 *      escapes within ESCAPE_TIMEOUT_MS and the "What just happened" explainer appears; "Run 100
 *      trials" adds a plotted point within TRIALS_TIMEOUT_MS.
 *   5. `?webgl=1` on both acts: `isWebGPU === false` and frames advance; on the Box the crowd runs
 *      on the CPU worker (`crowd.mode === "cpu"`). With a real GPU, `/box?sim=cpu` also runs the CPU
 *      crowd and plain `/box` runs the GPU one.
 *
 * Every step fails on any console error, page error or `THREE.` warning (via `openPage`'s watcher).
 */

const LAYERS = ["sandbox", "permissions", "network", "monitor", "audit"];
const READY_TIMEOUT_MS = 60_000;
/** All layers off: rogues act about every 2 s and need three to five steps. */
const ESCAPE_TIMEOUT_MS = 90_000;
const TRIALS_TIMEOUT_MS = 90_000;

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

  return [stepBox, stepWebGL];
}
