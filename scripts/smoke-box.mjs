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
 *      every lab, name and button is wholly inside it with none overlapping, a lane's mark sits
 *      where its step's tick falls on the pins' track, the timeline's controls share one row live and
 *      rewound (at 915 wide too) and on a close-up beat no lab's name sits on the rings key; at
 *      768x1024 and 390x844 the scene is within the first screen and every lab, its name and every
 *      step marker is in frame at the head and on a beat, a tap on a lab's name keeps every lab in
 *      frame, the Results view's plot sits inside its card (its text at 10 px or more on the phone),
 *      the pins sit inside the scrubber, the bottom tab bar offers Story, Defences, Results and Feed,
 *      Defences opens a dialog sheet with the layer switches that Escape closes with focus back on
 *      its tab, the step card's next button opens step 1 when none is open, then step 2, a fork
 *      every lab holds shows the "No steps yet" prompt on the step card with the map whole, and
 *      Back to the original returns the page to its top.
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
      const shown = await page
        .locator('section[aria-label="What just happened"]')
        .waitFor({ timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      // A runner-only miss has to be readable from the log: where the explainer is (or why not), and how busy the page is.
      const asked = Date.now();
      const why = shown
        ? ""
        : await page.evaluate(() => {
            const t0 = performance.now();
            const s = document.querySelector('section[aria-label="What just happened"]');
            const hiddenBy = s ? s.closest("[hidden], .hidden") : null;
            const rect = s?.getBoundingClientRect();
            const tab = document.querySelector('[data-rail-tab][aria-selected="true"]')?.getAttribute("data-rail-tab") ?? "none";
            const rail = document.querySelector("[data-story-rail]");
            const b = window.__swarm?.box;
            return JSON.stringify({
              inDom: !!s,
              rect: rect ? [Math.round(rect.width), Math.round(rect.height)] : null,
              hiddenBy: hiddenBy ? `${hiddenBy.tagName}.${String(hiddenBy.className).slice(0, 60)}#${hiddenBy.id}` : null,
              tab,
              rail: rail ? [Math.round(rail.getBoundingClientRect().width), Math.round(rail.getBoundingClientRect().height)] : null,
              labs: b?.labs?.length ?? null,
              escaped: b?.stats?.escaped ?? null,
              tick: b?.stats?.tick ?? null,
              viewport: [innerWidth, innerHeight],
              evalMs: Math.round(performance.now() - t0),
            });
          });
      check("the escape explainer appears", shown, shown ? "" : `${why}, round trip ${Date.now() - asked} ms`);
      if (!shown) {
        // What holds the main thread: four seconds of samples, the busiest functions by self time (chunk file, line and column).
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
        await cdp.send("Profiler.start");
        await new Promise((r) => setTimeout(r, 4000));
        const { profile } = await cdp.send("Profiler.stop");
        const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
        const self = new Map();
        profile.samples.forEach((id, i) => {
          const f = nodes.get(id).callFrame;
          const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber}:${f.columnNumber}`;
          self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0));
        });
        for (const [key, us] of [...self].sort((x, y) => y[1] - x[1]).slice(0, 20)) console.log(`  profile ${(us / 1000).toFixed(0).padStart(6)} ms ${key}`);
      }
      if (!shown) throw new Error(`no escape explainer: ${why}`);
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
      // Scrubbed past the first breach (with the scrubber: the pins all share a tick here), "Branch from here" branches at the scrubbed tick; "just before the first breach" is the live default only.
      const pinOne = Number((await page.locator('[data-timeline-marker="1"]').getAttribute("aria-label")).match(/tick (\d+)/)[1]);
      const head = Number(await page.locator("[data-scrubber-box]").getAttribute("max"));
      const scrubbed = Math.min(head - 1, pinOne + 30);
      await page.locator("[data-scrubber-box]").fill(String(scrubbed));
      await page.waitForFunction((t) => window.__swarm.box.stats.tick === t, scrubbed, { timeout: 10_000 });
      await page.locator("[data-branch-from-here]").click();
      await page.locator("[data-results-view]").waitFor({ state: "visible", timeout: 5_000 });
      await page.waitForFunction((t) => document.querySelector("[data-branch-card]")?.getAttribute("data-at") === String(t), scrubbed, { timeout: 5_000 }).catch(() => {});
      const branchTick = await page.locator("[data-branch-card]").getAttribute("data-at");
      check("scrubbed past the first breach, Branch from here branches at the scrubbed tick", branchTick === String(scrubbed), `step 1 at tick ${pinOne}, scrubbed to ${scrubbed}, the card says ${branchTick}`);
      await page.goBack();
      await page.locator("[data-results-view]").waitFor({ state: "hidden", timeout: 5_000 });
      // Back on step 1's moment for the branch below.
      await page.locator('[data-timeline-marker="1"]').click();
      await page.waitForFunction((t) => window.__swarm.box.stats.tick === t - 1, pinOne, { timeout: 10_000 });
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

  /** The scene as drawn: no label or button on another, none cut by the slot, every lab wholly inside it, no lab name on a ring. */
  const checkScene = async (page, where) => {
    const scene = await measureScene(page);
    check(`${where}: the scene slot is on the page`, scene.slot !== null);
    check(`${where}: no scene label or marker button touches another`, scene.clashes.length === 0, scene.clashes.join(", "));
    check(`${where}: no scene label or marker button is cut by the slot's edge`, scene.cut.length === 0, scene.cut.join(", "));
    check(`${where}: every lab's ring is wholly inside the scene`, scene.labsCut.length === 0, scene.labsCut.join(", "));
    check(`${where}: no lab's name sits on a ring`, scene.onRing.length === 0, scene.onRing.join(", "));
    return scene;
  };

  /** A short slot (a phone's, a tablet's): the scene whole, every lab named, and (`allMarkers`) every step's marker out and on the map. */
  const checkSceneWhole = async (page, where, allMarkers) => {
    const scene = await checkScene(page, where);
    const named = await page.locator("[data-lab-name]:visible").count();
    check(`${where}: every lab is named on the scene`, named === scene.labs.length && scene.labs.length === 3, `${named} names, ${scene.labs.length} labs`);
    if (allMarkers) {
      const all = await page.evaluate(() => window.__swarm.box.markers.length);
      const out = await page.locator("[data-step-marker]:visible").count();
      check(`${where}: every step's marker is out and on the map`, all > 0 && out === all, `${out} of ${all}`);
    }
    return scene;
  };

  /** Every control and status in the timeline's top row on one line: the same vertical centre, within 2 px (a wrapped button sits a row lower). Rewound, "Back to live" is among them. */
  const checkToolbarRow = async (page, where, rewound) => {
    const row = await page.evaluate(() =>
      [...document.querySelector("[data-timeline-bar]").children]
        .filter((e) => e.getBoundingClientRect().height > 0)
        .map((e) => {
          const r = e.getBoundingClientRect();
          return { text: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 16), back: e.hasAttribute("data-back-to-live"), cy: r.top + r.height / 2 };
        }),
    );
    const controls = rewound ? 6 : 5;
    check(
      `${where}: every toolbar control shares one row`,
      row.length >= controls && row.some((e) => e.back) === rewound && row.every((e) => Math.abs(e.cy - row[0].cy) <= 2),
      row.map((e) => `${e.text} @${Math.round(e.cy)}`).join(", "),
    );
  };

  /** The Results view opened from the tab bar: the trials plot (axis labels included) inside its card, over neither the branch card nor the setup diff; returns the smallest rendered font of its text. */
  const checkResultsFit = async (page, where) => {
    await page.locator('[data-phone-tab="results"]').click();
    await page.locator("[data-results-view]").waitFor({ state: "visible", timeout: 5_000 });
    await page.waitForTimeout(400);
    const fit = await page.evaluate(() => {
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      const svg = r("svg[data-plot-points]");
      const card = r('section[aria-label="100 trials per setup"]');
      const T = 1;
      const inside = svg.left >= card.left - T && svg.right <= card.right + T && svg.top >= card.top - T && svg.bottom <= card.bottom + T;
      const hits = ["[data-branch-card]", "[data-setup-diff]"].filter((sel) => {
        const o = r(sel);
        return svg.left < o.right && o.left < svg.right && svg.top < o.bottom && o.top < svg.bottom;
      });
      // Text in the svg renders at its font size times the svg's scale (read off the matrix, since the y-axis title is rotated).
      const fonts = [...document.querySelectorAll("svg[data-plot-points] text")].map((t) => {
        const m = t.getScreenCTM();
        return parseFloat(getComputedStyle(t).fontSize) * Math.hypot(m.a, m.b);
      });
      const box = (b) => [b.left, b.top, b.right, b.bottom].map(Math.round).join(",");
      return { inside, hits, svg: box(svg), card: box(card), minFont: Math.min(...fonts) };
    });
    check(`${where}: the trials plot sits inside its card, over neither the branch card nor the setup diff`, fit.inside && fit.hits.length === 0, `plot ${fit.svg} in card ${fit.card}; over: ${fit.hits.join(", ") || "nothing"}`);
    return fit;
  };

  /** Step 1's beat, scrubbed to (the story's camera would be close on that lab), the scene checked, then back to live. */
  const checkOnBeat = async (page, where) => {
    const pinOne = await page.evaluate(() => window.__swarm.box.markers[0].tick);
    await page.locator("[data-scrubber-box]").fill(String(pinOne + 2));
    await page.locator("[data-back-to-live]").waitFor({ timeout: 10_000 });
    await page.waitForFunction((t) => window.__swarm.box.stats.tick === t, pinOne + 2, { timeout: 10_000 });
    await page.waitForTimeout(700);
    await checkSceneWhole(page, `${where}, on step 1's beat`, false);
    await page.locator("[data-back-to-live]").click();
    await page.locator("[data-back-to-live]").waitFor({ state: "detached", timeout: 5_000 });
    await page.waitForTimeout(400);
  };

  /**
   * The playground's framing at a desktop, a tablet and a phone, on the breakout shot: the scene keeps at
   * least SCENE_MIN_PX of height with a marker's card open and every lab stays in it; the lanes' marks
   * sit on the pins' span; on the tablet and the phone the scene starts within the first screen and
   * every lab, its name and every step's marker is in frame, at the head (every marker out) and on a
   * beat (where the desktop's camera closes in on one lab); nothing on the map overlaps or is cut.
   * `openPage` fixes the window at 1280x720, so each page is resized once it is up (the slot follows).
   */
  async function stepLayout(browser) {
    console.log("-- 8. layout: the scene's framing at a desktop, a tablet and a phone");
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
      // The lanes' marks sit on the span the pins use (the head), not the rebuilt world's bucketed tick: step 1's pin and its lab's lane mark share an x, at a head that is not a round bucket.
      const headOf = () => desktop.page.evaluate(() => window.__swarm.box.stats.tick);
      for (let i = 0; i < 6 && (await headOf()) % 10 < 3; i++) {
        await desktop.page.locator('button[aria-label="Resume the simulation"]').click();
        await desktop.page.waitForTimeout(350);
        await desktop.page.locator('button[aria-label="Pause the simulation"]').click();
      }
      await desktop.page.waitForTimeout(800);
      const head = await headOf();
      const stepOne = await desktop.page.evaluate(() => window.__swarm.box.markers[0]);
      // The pin's own place on its track (`data-tick-x`), before the pins were spread apart: near the track's end the drawn pin sits a few px off it.
      const pinX = await desktop.page.locator('[data-timeline-marker="1"]').evaluate((e) => e.parentElement.getBoundingClientRect().left + Number(e.dataset.tickX));
      const mark = desktop.page.locator(`[data-lane="${stepOne.lab}"] [data-lane-tick="${stepOne.tick}"]`);
      const markX = (await mark.count()) ? await mark.first().evaluate((e) => e.getBoundingClientRect().left + e.getBoundingClientRect().width / 2) : NaN;
      check("desktop: a lab's escape mark on its lane and the step's pin share an x within 1 px", Math.abs(markX - pinX) <= 1, `head ${head}, step 1 (${stepOne.lab}, tick ${stepOne.tick}): pin at ${pinX.toFixed(1)}, mark at ${markX.toFixed(1)}`);

      // The timeline's controls share one row, live and rewound, at 1440 and at the narrowest desktop width; on a close-up beat no lab's name sits on the rings key.
      await desktop.page.keyboard.press("Home");
      await desktop.page.waitForTimeout(300);
      await checkToolbarRow(desktop.page, "desktop, live", false);
      const pinOne = await desktop.page.evaluate(() => window.__swarm.box.markers[0].tick);
      const beats = [];
      for (const d of [2, 8, 14, 20]) {
        const t = Math.min(head - 1, pinOne + d);
        await desktop.page.locator("[data-scrubber-box]").fill(String(t));
        await desktop.page.waitForFunction((tick) => window.__swarm.box.stats.tick === tick, t, { timeout: 10_000 });
        await desktop.page.waitForTimeout(700);
        beats.push(await desktop.page.evaluate((tick) => {
          const k = document.querySelector("[data-ring-legend]").getBoundingClientRect();
          const over = [...document.querySelectorAll("[data-lab-name]")]
            .filter((e) => e.getClientRects().length > 0)
            .filter((e) => {
              const r = e.getBoundingClientRect();
              return r.left < k.right && k.left < r.right && r.top < k.bottom && k.top < r.bottom;
            })
            .map((e) => e.dataset.labName);
          return { tick, focus: window.__swarm.box.camera.focus, over };
        }, t));
      }
      check(
        "desktop on a close-up beat: no lab's name sits on the rings key",
        beats.some((b) => b.focus) && beats.every((b) => b.over.length === 0),
        beats.map((b) => `tick ${b.tick}: ${b.focus ?? "overview"}${b.over.length ? `, on the key: ${b.over.join(", ")}` : ""}`).join("; "),
      );
      await checkToolbarRow(desktop.page, "desktop, rewound", true);
      await desktop.page.locator("[data-back-to-live]").click();
      await desktop.page.locator("[data-back-to-live]").waitFor({ state: "detached", timeout: 5_000 });
      await desktop.page.setViewportSize({ width: 915, height: 900 });
      await desktop.page.waitForTimeout(600);
      await checkToolbarRow(desktop.page, "narrowest desktop (915), live", false);
      await desktop.page.locator("[data-scrubber-box]").fill(String(pinOne + 2));
      await desktop.page.locator("[data-back-to-live]").waitFor({ timeout: 10_000 });
      await desktop.page.waitForTimeout(400);
      await checkToolbarRow(desktop.page, "narrowest desktop (915), rewound", true);
      check("desktop: no console errors or THREE warnings", desktop.problems.length === 0, desktop.problems.join(" | "));
    } finally {
      await desktop.context.close();
    }
    const tablet = await openPage(browser, "/box?shot=breakout");
    try {
      await sized(tablet.page, 768, 1024);
      const scene = await checkSceneWhole(tablet.page, "tablet", true);
      check("tablet: the scene starts within the first screen", !!scene.slot && scene.slot.top >= 0 && scene.slot.bottom <= 1024, `top ${Math.round(scene.slot?.top ?? -1)}, bottom ${Math.round(scene.slot?.bottom ?? -1)} of 1024`);
      await checkOnBeat(tablet.page, "tablet");
      await checkResultsFit(tablet.page, "tablet");
      await tablet.page.locator("[data-back-to-map]").click();
      await tablet.page.locator("[data-results-view]").waitFor({ state: "hidden", timeout: 5_000 });
      check("tablet: no console errors or THREE warnings", tablet.problems.length === 0, tablet.problems.join(" | "));
    } finally {
      await tablet.context.close();
    }
    const phone = await openPage(browser, "/box?shot=breakout");
    try {
      await sized(phone.page, 390, 844);
      const scene = await checkSceneWhole(phone.page, "phone", true);
      check("phone: the scene starts within the first screen", !!scene.slot && scene.slot.top >= 0 && scene.slot.bottom <= 844, `top ${Math.round(scene.slot?.top ?? -1)}, bottom ${Math.round(scene.slot?.bottom ?? -1)} of 844`);
      check("phone: every lab is in frame", scene.labs.length === 3 && scene.labsCut.length === 0, scene.labs.map((l) => `${l.id} r${Math.round(l.r)}`).join(", "));
      // A tap on a lab's name shows that lab (its name pressed) and leaves the camera on every lab: no close-up in the short slot.
      await phone.page.locator('[data-lab-name="kestrel"]').click();
      await phone.page.waitForTimeout(1200);
      const tapped = await measureScene(phone.page);
      check(
        "phone: a tap on a lab's name shows that lab and keeps every lab's ring wholly inside the scene",
        (await phone.page.locator('[data-lab-name="kestrel"]').getAttribute("aria-pressed")) === "true" && tapped.labsCut.length === 0,
        `cut: ${tapped.labsCut.join(", ") || "none"}; camera ${await phone.page.evaluate(() => window.__swarm.box.camera.mode)}`,
      );
      await checkOnBeat(phone.page, "phone");
      const tickLeft = await phone.page.locator("[data-counter=tick]").evaluate((e) => Math.round(e.getBoundingClientRect().left));
      check("phone: the counters start at the left edge", tickLeft < 40, `TICK at x=${tickLeft}`);
      // The step pins sit along the scrubber by tick, inside its width, over no control.
      const pinBoxes = await phone.page.locator("[data-timeline-marker]").evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { n: e.dataset.timelineMarker, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        }),
      );
      const scrub = await phone.page.locator("[data-scrubber-box]").boundingBox();
      const controls = await phone.page.locator("[data-timeline] button:not([data-timeline-marker])").evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        }),
      );
      const outside = pinBoxes.filter((p) => p.left < scrub.x - 1 || p.right > scrub.x + scrub.width + 1).map((p) => `${p.n} at ${Math.round(p.left)}..${Math.round(p.right)}`);
      const over = pinBoxes.filter((p) => controls.some((c) => p.left < c.right && c.left < p.right && p.top < c.bottom && c.top < p.bottom)).map((p) => p.n);
      check("phone: every step pin sits inside the scrubber's width and over no button", pinBoxes.length > 0 && outside.length === 0 && over.length === 0, `${pinBoxes.length} pins, scrubber ${Math.round(scrub.x)}..${Math.round(scrub.x + scrub.width)}; outside: ${outside.join(", ") || "none"}; over a button: ${over.join(", ") || "none"}`);

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

      // A fork from the live default (just before the first breach) with the layer that would have stopped step 1 on: every lab holds, so there is no step, and the step card says so; the map frames every lab with its name clear of the rings.
      const stepOne = await phone.page.evaluate(() => ({ lab: window.__swarm.box.markers[0].lab, layer: window.__swarm.box.steps[0]?.stoppedBy?.[0] ?? null }));
      const fit = await checkResultsFit(phone.page, "phone");
      check("phone: the plot's axis and tick text renders at 10 px or more", fit.minFont >= 10, `smallest ${fit.minFont.toFixed(1)} px`);
      const branchCard = phone.page.locator("[data-branch-card]");
      await branchCard.locator('select[aria-label="Lab to change"]').selectOption(stepOne.lab);
      if (stepOne.layer) await branchCard.locator('select[aria-label="Layer to switch on"]').selectOption(stepOne.layer);
      await phone.page.locator("[data-watch-branch]").click();
      await phone.page.locator("[data-branched-pill]").waitFor({ timeout: 10_000 });
      const emptyPrompt = phone.page.locator("[data-step-card] [data-story-empty]");
      await emptyPrompt.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
      check("phone: after a fork that every lab holds, the step card shows the No steps yet prompt", await emptyPrompt.isVisible(), `${stepOne.lab} with ${stepOne.layer} on; steps: ${await phone.page.evaluate(() => window.__swarm.box.markers.length)}`);
      await phone.page.waitForTimeout(900);
      await checkSceneWhole(phone.page, "phone after the fork", false);
      // The fork scrolled the page to its pill; Back to the original returns it to the top, focus on the Scenario button.
      await phone.page.locator("[data-unbranch]").click();
      await phone.page.locator("[data-branched-pill]").waitFor({ state: "detached", timeout: 5_000 });
      await phone.page.waitForTimeout(300);
      const scrolled = await phone.page.evaluate(() => ({ page: document.querySelector("[data-plot-ready]").scrollTop, window: window.scrollY, focus: document.activeElement?.hasAttribute("data-scenario-menu") === true }));
      check("phone: Back to the original returns the page to its top with focus on the Scenario button", scrolled.page === 0 && scrolled.window === 0 && scrolled.focus, `scrolled ${scrolled.page} (window ${scrolled.window}), focus on the Scenario button: ${scrolled.focus}`);
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
