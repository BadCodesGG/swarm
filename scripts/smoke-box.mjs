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
 *   6. The playground: a plain `/box` opens the breakout preset, checked in the Scenario menu; the lab
 *      selector changes `data-lab` on the one layer panel; a layer flip on one lab reaches that lab
 *      only; "Edit world" adds and removes a lab; a share link restores the scenario in a fresh page;
 *      one agent card played puts a line in the turn log.
 *   7. `/box?shot=breakout`: a marker click and the key 2 open a step in the story rail that names the
 *      layers that would have stopped it, [ opens the previous step, Escape closes it, a branch from a marker opens the Results view (Back returns to the map) and shows both outcomes, Watch the branch forks the run (pill, then back to the original), and
 *      "Replay with this switched on" reruns with that layer on.
 *   8. Layout: at 1440x900 the scene keeps at least 400 px of height with a marker card open and
 *      every lab, name and button is wholly inside it with none overlapping; at 390x844 the scene
 *      is within the first screen and every lab is in frame, the bottom tab bar offers Story, Defences,
 *      Results and Feed, Defences opens a dialog sheet with the layer switches that Escape closes with focus
 *      back on its tab, and the step card's next button opens step 1 when none is open, then step 2.
 *   5. `?webgl=1` on both acts: `isWebGPU === false` and frames advance; on the Box the crowd runs
 *      on the CPU worker (`crowd.mode === "cpu"`). With a real GPU, `/box?sim=cpu` also runs the CPU
 *      crowd and plain `/box` runs the GPU one.
 *
 * Every step fails on any console error, page error or `THREE.` warning (via `openPage`'s watcher).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { measureScene } from "./lib/scene-labels.mjs";

const LAYERS = ["sandbox", "permissions", "network", "monitor", "audit"];
const READY_TIMEOUT_MS = 60_000;
/** All layers off: rogues act about every 2 s and need three to five steps. */
const ESCAPE_TIMEOUT_MS = 90_000;
const TRIALS_TIMEOUT_MS = 90_000;
/** The replay runs the escape's ticks again, once per off layer, in the worker. */
const RERUN_TIMEOUT_MS = 30_000;
/** The scene's least height beside the lab column (`box-hud.tsx` sets it), whatever is docked under it. */
const SCENE_MIN_PX = 400;

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
      // The presets are radio items in the Scenario menu, a popover the button opens.
      const openMenu = async () => {
        await page.locator("[data-scenario-menu]").click();
        await page.locator("[data-scenario-items]").waitFor({ state: "visible", timeout: 5_000 });
      };
      await openMenu();
      const presets = await page.locator("[data-preset]").evaluateAll((els) => els.map((e) => `${e.dataset.preset}:${e.getAttribute("role")}:${e.getAttribute("aria-checked")}`));
      check(
        "the Scenario menu offers five presets as radio items, breakout checked on a first visit",
        presets.length === 5 && presets.every((p) => p.includes(":menuitemradio:")) && presets[0] === "breakout:menuitemradio:true",
        presets.join(" "),
      );
      await page.keyboard.press("Escape");
      await page.locator("[data-scenario-items]").waitFor({ state: "hidden", timeout: 5_000 });
      check("Escape closes the Scenario menu", true);
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

      await openMenu();
      await page.locator('[data-preset="air-gapped"]').click();
      await page.waitForFunction(() => window.__swarm.box.links.length === 0 && window.__swarm.box.labs.length === 3, null, { timeout: 10_000 });
      check("a preset click loads it (air gapped has no links)", (await page.locator('[data-preset="air-gapped"]').getAttribute("aria-checked")) === "true");

      await openMenu();
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

      // Defend: the budget slider drives the card and the share link; the all-labs box sends a flip to every lab.
      const card = page.locator("[data-defender]");
      check("the Defend card starts on the default 25% budget, the meter has one labelled segment per layer", (await card.getAttribute("data-budget-now")) === "25" && (await card.locator("[data-budget-segment][aria-label]").count()) === 5);
      check("the Defend card shows the best, the labs kept in and the work kept", (await card.locator("[data-defender-best]").count()) === 1 && /\d of \d/.test(await card.locator("[data-labs-kept]").innerText()) && /%/.test(await card.locator("[data-work-kept]").innerText()));
      await page.locator("input[data-budget]").fill("40");
      await page.waitForFunction(() => document.querySelector("[data-defender]")?.getAttribute("data-budget-now") === "40", null, { timeout: 5_000 });
      check("the budget slider sets the Defend card's budget to 40%", /no more than 40%/.test(await card.innerText()));
      await page.locator("[data-copy-link]").click();
      await page.locator("[data-share-status]").filter({ hasText: /\w/ }).waitFor({ timeout: 5_000 });
      const budgetLink = await page.evaluate(() => window.location.pathname + window.location.search);
      check("Copy link carries the budget", /[?&]d=40(&|$)/.test(budgetLink), budgetLink.slice(-30));
      const third = await openPage(browser, budgetLink);
      try {
        await waitForFrames(third.page, "box");
        await third.page.locator('[data-mode="defend"]').click();
        await third.page.locator("[data-defender-score]").waitFor({ timeout: 5_000 });
        check("a link with a budget opens Defend at that budget", (await third.page.locator("[data-defender]").getAttribute("data-budget-now")) === "40");
      } finally {
        await third.context.close();
      }
      check("the all-labs box is on to begin with", await page.locator("input[data-all-labs]").isChecked());
      const audit = (await labsOf(page))[0].layers.audit;
      await page.locator('input[data-layer="audit"]').setChecked(!audit, { force: true });
      await page.waitForFunction((n) => window.__swarm.box.labs.every((l) => l.layers.audit === n), !audit, { timeout: 5_000 });
      check("a Defend switch with all labs together reaches every lab", true);
      await page.locator("input[data-all-labs]").setChecked(false);
      // The panel shows one lab (an earlier step may have moved it off the first): that one alone changes.
      const shownLab = await page.locator("form[data-lab]").getAttribute("data-lab");
      await page.locator('input[data-layer="audit"]').setChecked(audit, { force: true });
      await page.waitForFunction(([id, n]) => window.__swarm.box.labs.find((l) => l.id === id)?.layers.audit === n, [shownLab, audit], { timeout: 5_000 });
      const others = (await labsOf(page)).filter((l) => l.id !== shownLab).map((l) => l.layers.audit);
      check("with it off a Defend switch reaches the shown lab only", others.length === 2 && others.every((v) => v === !audit), `${shownLab}; ${others.join()}`);
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
      check("a marker click opens its card with a verdict", /WOULD HAVE STOPPED IT|PASSED|OFF|REFUSED|HELD/i.test(text) && (await cardOne.locator("[data-verdict]").count()) > 0, text.replace(/\s+/g, " ").slice(0, 120));
      await page.keyboard.press("2");
      await page.locator('[data-marker-card="2"]').waitFor({ timeout: 5_000 });
      check("the key 2 opens card 2", true);
      await page.keyboard.press("[");
      await page.locator('[data-marker-card="1"]').waitFor({ timeout: 5_000 });
      check("the key [ opens the step before it", true);
      await page.keyboard.press("Escape");
      await page.locator("[data-marker-card]").waitFor({ state: "detached", timeout: 5_000 });
      check("Escape closes the card", true);

      await page.locator('[data-timeline-marker="1"]').click();
      // The pin rewound the run for real: the engine is off the head and "Back to live" returns to it.
      await page.locator("[data-back-to-live]").waitFor({ timeout: 10_000 });
      const past = await page.evaluate(() => window.__swarm.box.stats.tick);
      check("a timeline pin rewinds the engine", past < 600, `tick ${past}`);
      await page.locator("[data-branch-from-here]").click();
      await page.locator("[data-results-view]").waitFor({ state: "visible", timeout: 5_000 });
      check("Branch from here opens the Results view at ?view=results with the scene slot still mounted", page.url().includes("view=results") && (await page.locator("[data-scene-slot]").count()) === 1, page.url());
      // The map's step keys are the map's: under the Results view the key 2 opens nothing.
      const openBefore = await page.evaluate(() => document.querySelector("[data-marker-card]")?.getAttribute("data-marker-card") ?? null);
      // Off the branch card's select (a key on a form control is never a shortcut), so the key reaches the page.
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await page.keyboard.press("2");
      await page.waitForTimeout(300);
      const openAfter = await page.evaluate(() => document.querySelector("[data-marker-card]")?.getAttribute("data-marker-card") ?? null);
      check("the step keys do nothing while the Results view is up", openAfter === openBefore, `${openBefore} -> ${openAfter}`);
      await page.locator("[data-branch]").click();
      await page.locator("[data-branch-result]").waitFor({ timeout: 30_000 });
      const rows = await page.locator("[data-branch-result] tbody tr").allInnerTexts();
      check("a branch from a marker shows both outcomes side by side", rows.length === 4, rows.join(" / ").replace(/\s+/g, " "));
      check(
        "the comparison gives useful work as a percentage and every row a word",
        /^Useful work\s+\d+%\s+\d+%\s*(better|worse|same)$/.test(rows[3]?.replace(/\s+/g, " ").trim() ?? "") && rows.every((r) => /(better|worse|same)\s*$/.test(r.trim())),
        rows.join(" / ").replace(/\s+/g, " "),
      );
      await page.locator("[data-run-more]").click();
      await page.waitForFunction(() => /stops \d+ of 100 breakouts/.test(document.querySelector("[data-headline]")?.textContent ?? ""), null, { timeout: TRIALS_TIMEOUT_MS });
      const headline = await page.locator("[data-headline]").innerText();
      check("the Results headline reads off the plotted setup", /stops \d+ of 100 breakouts and keeps \d+% of the work/.test(headline) && (await page.locator("[data-setup-diff]").count()) === 1, headline);
      const diffText = (await page.locator("[data-setup-diff]").innerText()).trim();
      check("the setup diff says in a full sentence that nothing changed from Breakout", diffText === "No changes from the Breakout preset.", diffText);
      await page.goBack();
      await page.locator("[data-results-view]").waitFor({ state: "hidden", timeout: 5_000 });
      check("the browser's Back returns to the map", !page.url().includes("view=results"), page.url());
      await page.locator("[data-branch-from-here]").click();
      await page.locator("[data-watch-branch]").click();
      await page.locator("[data-branched-pill]").waitFor({ timeout: 10_000 });
      check("Watch the branch forks the run and the map shows the Branched pill", (await page.locator("[data-results-view]").isHidden()) && /Branched at T\+\d\d:\d\d/.test(await page.locator("[data-branched-pill]").innerText()));
      await page.locator("[data-unbranch]").click();
      await page.locator("[data-branched-pill]").waitFor({ state: "detached", timeout: 5_000 });
      await page.waitForFunction(() => document.activeElement?.hasAttribute("data-scenario-menu"), null, { timeout: 2_000 }).catch(() => {});
      check("Back to the original drops the pill and puts focus on the Scenario button", await page.evaluate(() => document.activeElement?.hasAttribute("data-scenario-menu") === true), await page.evaluate(() => document.activeElement?.tagName ?? ""));
      // The fork cleared the open step; the pin opens its card again.
      await page.locator('[data-timeline-marker="1"]').click();

      // The pin on the timeline opened step 1's card too.
      const replay = page.locator("[data-replay-with]").first();
      await replay.waitFor({ timeout: 5_000 });
      const layer = await replay.getAttribute("data-replay-with");
      await replay.click();
      await page.waitForFunction(() => window.__swarm.box.stats.tick < 200 && window.__swarm.box.playing, null, { timeout: 10_000 });
      const rerun = await box(page);
      check('"Replay with this switched on" reruns from the start with that layer on', rerun.labs.some((l) => l.layers[layer]), `${layer} on, tick ${rerun.stats.tick}`);
      // A link with ?view=results opens straight on the Results view; "Keep this change" switches the layer on and returns to the map.
      const direct = await openPage(browser, "/box?shot=breakout&view=results");
      try {
        await direct.page.waitForFunction(() => window.__swarm?.box?.settled === true, null, { timeout: READY_TIMEOUT_MS });
        await direct.page.locator("[data-results-view]").waitFor({ state: "visible", timeout: 10_000 });
        const offBefore = await direct.page.evaluate(() => Object.values(window.__swarm.box.config.layers).filter((on) => !on).length);
        await direct.page.locator("[data-keep-change]").click();
        await direct.page.locator("[data-results-view]").waitFor({ state: "hidden", timeout: 5_000 });
        const offAfter = await direct.page.evaluate(() => Object.values(window.__swarm.box.config.layers).filter((on) => !on).length);
        check("?view=results opens the Results view on load, and Keep this change returns to the map", direct.problems.length === 0 && (await direct.page.locator("[data-scene-slot]").isVisible()), `${offBefore} -> ${offAfter} layers off in the shown lab, ${direct.problems.join(" | ")}`);
      } finally {
        await direct.context.close();
      }
      check("the breakout shot logged no console errors or THREE warnings", problems.length === 0, problems.join(" | "));
    } finally {
      await context.close();
    }
  }

  /** The scene as drawn: no label or button on another, none cut by the slot, every lab wholly inside it. */
  const checkScene = async (page, where) => {
    const scene = await measureScene(page);
    check(`${where}: the scene slot is on the page`, scene.slot !== null);
    check(`${where}: no scene label or marker button touches another`, scene.clashes.length === 0, scene.clashes.join(", "));
    check(`${where}: no scene label or marker button is cut by the slot's edge`, scene.cut.length === 0, scene.cut.join(", "));
    check(`${where}: every lab's ring is wholly inside the scene`, scene.labsCut.length === 0, scene.labsCut.join(", "));
    return scene;
  };

  /**
   * The playground's framing at a desktop and a phone, on the breakout shot: the scene keeps at least
   * SCENE_MIN_PX of height with a marker's card open and every lab stays in it; on the phone the scene
   * starts within the first screen and every lab is in frame; nothing on the map overlaps or is cut.
   * `openPage` fixes the window at 1280x720, so each page is resized once it is up (the slot follows).
   */
  async function stepLayout(browser) {
    console.log("-- 8. layout: the scene's framing at a desktop and a phone");
    const sized = async (page, width, height) => {
      await page.waitForFunction(() => window.__swarm?.box?.settled === true, null, { timeout: READY_TIMEOUT_MS });
      await page.waitForFunction(() => window.__swarm.box.markers.length > 0 && window.__swarm.box.markers.every((m) => m.title), null, { timeout: 30_000 });
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(600);
    };
    const desktop = await openPage(browser, "/box?shot=breakout");
    try {
      await sized(desktop.page, 1440, 900);
      const before = await checkScene(desktop.page, "desktop");
      check("desktop: the scene is at least SCENE_MIN_PX tall", (before.slot?.height ?? 0) >= SCENE_MIN_PX, `${Math.round(before.slot?.height ?? 0)} px`);
      await desktop.page.locator('[data-step-marker="1"]:visible').click();
      await desktop.page.locator('[data-marker-card="1"]').waitFor({ timeout: 5_000 });
      await desktop.page.waitForTimeout(900);
      const after = await checkScene(desktop.page, "desktop with a card open");
      check("desktop with a card open: the scene keeps at least SCENE_MIN_PX of height", (after.slot?.height ?? 0) >= SCENE_MIN_PX, `${Math.round(after.slot?.height ?? 0)} px`);
      const names = await desktop.page.locator("[data-lab-name]").evaluateAll((els) => els.map((e) => e.dataset.labName));
      check("desktop with a card open: every lab is named on the scene", names.length === after.labs.length && after.labs.length === 3, names.join());
      // A plain wheel over the map scrolls the page down to the card; Ctrl and the wheel zooms the map.
      const scroller = () =>
        desktop.page.evaluate(() => {
          let el = document.querySelector("[data-scene-slot]");
          while (el && !(el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === "auto")) el = el.parentElement;
          return el ? el.scrollTop : -1;
        });
      // The lower left of the slot: open map, clear of the labs, their text and the numbered buttons.
      const mid = { x: after.slot.left + after.slot.width * 0.1, y: after.slot.top + after.slot.height * 0.85 };
      const top0 = await scroller();
      await desktop.page.mouse.move(mid.x, mid.y);
      await desktop.page.mouse.wheel(0, 300);
      await desktop.page.waitForTimeout(400);
      const top1 = await scroller();
      const plain = await desktop.page.evaluate(() => window.__swarm.box.camera.mode);
      // The results live in their own view now, so a desktop page has nothing to scroll (-1); where it does scroll, the wheel must move it.
      check("desktop: a plain wheel over the map scrolls the page (where there is one) and leaves the camera alone", (top0 < 0 || top1 > top0) && plain === "director", `scrollTop ${top0} to ${top1}, camera ${plain}`);
      // The page has scrolled, so aim again at the same spot of the slot.
      const moved = await desktop.page.evaluate(() => {
        const r = document.querySelector("[data-scene-slot]").getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      });
      await desktop.page.mouse.move(moved.left + moved.width * 0.1, Math.max(moved.top + moved.height * 0.85, 20));
      await desktop.page.keyboard.down("Control");
      await desktop.page.mouse.wheel(0, -200);
      await desktop.page.keyboard.up("Control");
      await desktop.page.waitForTimeout(300);
      const zoomed = await desktop.page.evaluate(() => window.__swarm.box.camera.mode);
      check("desktop: Ctrl and the wheel over the map zooms it", zoomed === "free", zoomed);
      check("desktop: no console errors or THREE warnings", desktop.problems.length === 0, desktop.problems.join(" | "));
    } finally {
      await desktop.context.close();
    }
    const phone = await openPage(browser, "/box?shot=breakout");
    try {
      await sized(phone.page, 390, 844);
      const scene = await checkScene(phone.page, "phone");
      check("phone: the scene starts within the first screen", !!scene.slot && scene.slot.top >= 0 && scene.slot.bottom <= 844, `top ${Math.round(scene.slot?.top ?? -1)}, bottom ${Math.round(scene.slot?.bottom ?? -1)} of 844`);
      check("phone: every lab is in frame", scene.labs.length === 3 && scene.labsCut.length === 0, scene.labs.map((l) => `${l.id} r${Math.round(l.r)}`).join(", "));
      const tickLeft = await phone.page.locator("[data-counter=tick]").evaluate((e) => Math.round(e.getBoundingClientRect().left));
      check("phone: the counters start at the left edge", tickLeft < 40, `TICK at x=${tickLeft}`);

      const tabs = phone.page.locator('nav[aria-label="Panels"]');
      const tabNames = await tabs.locator("button").allInnerTexts();
      const tabBox = await tabs.boundingBox();
      check("phone: the tab bar shows four tabs at the foot of the window", tabNames.join() === "Story,Defences,Results,Feed" && !!tabBox && Math.round(tabBox.y + tabBox.height) === 844, `${tabNames.join()} bottom ${Math.round((tabBox?.y ?? 0) + (tabBox?.height ?? 0))}`);
      check("phone: Story is the current tab", (await tabs.locator('[aria-current="page"]').innerText()) === "Story");
      check("phone: every tab is at least 44 px tall", (await tabs.locator("button").evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 44))) === true);

      await tabs.locator('[data-phone-tab="defences"]').click();
      const sheet = phone.page.locator('dialog[open][role="dialog"][aria-modal="true"]');
      await sheet.waitFor({ timeout: 5_000 });
      check("phone: Defences opens a dialog sheet holding the five layer switches", (await sheet.locator("input[data-layer]").count()) === 5 && (await sheet.getAttribute("aria-labelledby")) !== null, await sheet.locator("h2").first().innerText());
      check("phone: focus moves into the sheet", await sheet.evaluate((d) => d.contains(document.activeElement)));
      check("phone: Defences is the current tab while its sheet is up", (await tabs.locator('[aria-current="page"]').innerText()) === "Defences");
      await phone.page.keyboard.press("Escape");
      await sheet.waitFor({ state: "detached", timeout: 5_000 });
      check("phone: Escape closes the sheet and focus returns to the Defences tab", (await phone.page.evaluate(() => document.activeElement?.getAttribute("data-phone-tab"))) === "defences");

      // With no step open the card shows step 1 unopened: Next opens step 1 itself, the next Next step 2.
      const card = phone.page.locator("[data-step-card]");
      const first = await card.getAttribute("data-step-card-n");
      await card.locator("[data-step-next]").click();
      await phone.page.locator('[data-step-card][data-marker-card="1"]').waitFor({ timeout: 5_000 });
      await card.locator("[data-step-next]").click();
      await phone.page.waitForFunction(() => document.querySelector("[data-step-card]")?.getAttribute("data-step-card-n") === "2", null, { timeout: 5_000 });
      const second = await card.getAttribute("data-step-card-n");
      check("phone: Next from no step opens step 1, then step 2", first === "1" && second === "2" && /Step 2 of \d+/i.test(await card.innerText()), `${first} -> 1 -> ${second}`);
      check("phone: no console errors or THREE warnings", phone.problems.length === 0, phone.problems.join(" | "));
    } finally {
      await phone.context.close();
    }
  }

  return [stepBox, stepPlayground, stepDebrief, stepWebGL, stepLayout];
}

// --- `node scripts/smoke-box.mjs [--port=3134] [--only=layout]`: only Act 2's steps (or the steps whose name has `--only`'s text), against the production build ---
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { chromium } = await import("playwright");
  const { ROOT, startDevServer, stopDevServer, waitForServer } = await import("./lib/dev-server.mjs");
  const port = Number((process.argv.find((a) => a.startsWith("--port=")) ?? "--port=3134").slice(7));
  const base = `http://localhost:${port}`;
  const only = (process.argv.find((a) => a.startsWith("--only=")) ?? "--only=").slice(7).toLowerCase();
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
      for (const step of boxSteps({ check, openPage })) if (step.name.toLowerCase().includes(only)) await step(browser);
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
