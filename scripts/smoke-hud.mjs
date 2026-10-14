/**
 * Smoke step 2c: the Act 1 HUD panels. Wired into `scripts/smoke.mjs` as
 *
 *   (browser) => stepHud(browser, { openPage, check, inside, waitInside, blur, BASE, VIEWPORT })
 *
 * Asserts, on a medium sample: the stage strip says INFERRED and a click seeks; the scrubber stays on
 * screen with the instrument bank collapsed to one row of numbers at a small viewport, and a toggle
 * opens it; the lanes canvas is painted; the roster opens, lists every agent and selects and follows
 * on a click; a station panel opens from the tool mix, lists calls and closes on Escape; the agent's
 * card tells what it was told and what came back; the address bar carries the moment and a new page
 * opened on that URL lands on it; the recap card shows at the end and can be dismissed. On the large
 * sample the orchestrator's card marks the compaction. (An upload never writes to the URL: step 3.)
 */

const timeOf = (page) => page.evaluate(() => window.__swarm.inside.t);

export async function stepHud(browser, h) {
  const { check, inside, waitInside, blur } = h;
  console.log("-- 2c. inside HUD panels");
  const { context, page, problems } = await h.openPage(browser, "/inside?source=medium&seed=1", { permissions: ["clipboard-read", "clipboard-write"] });
  try {
    await waitInside(page, () => window.__swarm?.inside?.frame > 5, null, 90_000);
    await blur(page);
    await page.keyboard.press("Space");
    await waitInside(page, () => window.__swarm.inside.playing === false);

    // --- the scrubber stays on screen, with the bank collapsed to a row of numbers ---
    const view = page.viewportSize();
    const bar = await page.locator("[data-scrubber]").boundingBox();
    check("hud: the scrubber is on screen", bar !== null && bar.y + bar.height <= view.height + 1, `bottom ${bar && Math.round(bar.y + bar.height)} of ${view.height}`);
    const small = view.height < 820 || view.width < 1100;
    if (small) {
      check("hud: the bank starts collapsed to one row of numbers", (await page.locator("[data-bank]").count()) === 0 && (await page.locator("[data-bank-summary]").isVisible()));
      await page.locator("[data-bank-toggle]").click();
      await page.locator("[data-bank]").waitFor({ state: "visible" });
      check("hud: the toggle opens the six panels", (await page.locator("[data-bank] > section").count()) === 6);
      await page.locator("[data-bank-toggle]").click();
      await page.locator("[data-bank]").waitFor({ state: "detached" });
    }

    // --- the lanes canvas holds something ---
    const painted = await page.evaluate(() => {
      const c = document.querySelector("[data-agent-lanes]");
      if (!(c instanceof HTMLCanvasElement) || c.width === 0) return -1;
      const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
      return n;
    });
    check("hud: the agent lanes are drawn", painted > 0, `${painted} painted pixels`);

    // --- the stage strip ---
    const strip = page.locator("[data-stages]");
    check("hud: the stage strip says inferred", (await strip.textContent()).includes("INFERRED"));
    const stages = page.locator("[data-stage]");
    const count = await stages.count();
    // The samples are shell-heavy all the way through, so the inference may find one stage; real runs find more.
    check("hud: the strip has at least one stage", count >= 1, `${count} stages`);
    const mid = await page.locator("[data-scrubber]").boundingBox();
    await page.mouse.click(mid.x + mid.width * 0.6, mid.y + mid.height / 2);
    await page.waitForTimeout(300);
    const before = await timeOf(page);
    const target = stages.nth(count - 1);
    const start = Number((await target.getAttribute("aria-label")).match(/from (\d+) seconds/)[1]);
    await target.click();
    await waitInside(page, (s) => Math.abs(window.__swarm.inside.t - s) < 1.5, start);
    check("hud: clicking a stage seeks to it", true, `t ${before.toFixed(1)} to ${(await timeOf(page)).toFixed(1)} for a stage at ${start}`);
    const id = await target.getAttribute("data-stage");
    await page.waitForFunction((i) => document.querySelector(`[data-stage="${i}"]`)?.getAttribute("aria-current") === "step", id, { timeout: 4000 }).catch(() => {});
    check("hud: that stage is lit", (await target.getAttribute("aria-current")) === "step");

    // --- a mid-run moment: the agents' roster ---
    await page.mouse.click(mid.x + mid.width * 0.55, mid.y + mid.height / 2);
    await page.waitForTimeout(300);
    await page.locator("[data-roster-toggle]").click();
    const roster = page.locator("[data-roster]");
    await roster.waitFor({ state: "visible" });
    const agents = (await inside(page)).agents;
    const rows = await roster.locator("[data-roster-row]").count();
    check("hud: the roster lists every agent", rows === agents, `${rows} rows, ${agents} agents`);
    check("hud: the roster shows model, tokens and active time", /tok/.test(await roster.textContent()) && /active/.test(await roster.textContent()));
    await roster.locator("[data-roster-row]").nth(1).focus();
    await page.keyboard.press("ArrowDown");
    check("hud: arrow keys move through the roster", await page.evaluate(() => document.activeElement?.getAttribute("data-roster-row") === "2"));
    await page.keyboard.press("Enter");
    await waitInside(page, () => window.__swarm.inside.selected === 2 && window.__swarm.inside.following === 2);
    check("hud: a roster row selects and follows that agent", true);
    const card = page.locator("[data-detail-card]");
    await card.waitFor({ state: "visible" });

    // --- the agent's-eye card ---
    check("hud: the card says what it was told and that a subagent starts blank", (await card.textContent()).includes("EVERYTHING IT WAS TOLD") && (await card.locator("[data-eye=blank]").textContent()).includes("starts blank"));
    check("hud: the card says what came back", (await card.locator("[data-eye=report]").textContent()).includes("ONLY THIS CAME BACK"));
    check("hud: the card shows the waiting-on-you share", /Waiting on you: \S+ of its time/.test(await card.locator("[data-eye=waiting]").textContent()));

    // --- the moment in the address bar ---
    await page.waitForFunction(() => new URL(location.href).searchParams.get("select") === "2", null, { timeout: 5000 });
    const url = new URL(page.url());
    const t = Number(url.searchParams.get("t"));
    check("hud: the URL carries the sample, seed, time, selection and follow", url.searchParams.get("source") === "medium" && url.searchParams.get("seed") === "1" && t > 0 && url.searchParams.get("follow") === "2", url.search);
    const copy = page.locator("[data-copy-moment]");
    check("hud: a sample offers Copy link to this moment", (await copy.count()) === 1);
    await copy.click();
    await page.waitForFunction(() => document.querySelector("[data-copy-moment]")?.textContent?.includes("Link copied"), null, { timeout: 5000 });
    const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    check("hud: the copied link is this moment", copied === null || (copied.includes("source=medium") && copied.includes("select=2")), String(copied));
    // A second page on that URL lands on the moment.
    const second = await h.openPage(browser, `/inside${url.search}`);
    try {
      await waitInside(second.page, () => window.__swarm?.inside?.frame > 5, null, 90_000);
      const landed = await inside(second.page);
      check("hud: opening the link lands on the moment", landed.t >= t - 0.01 && landed.t < t + 30 && landed.selected === 2, `t ${landed.t.toFixed(1)} for ${t}, selected ${landed.selected}`);
      await waitInside(second.page, () => window.__swarm.inside.following === 2);
      check("hud: and follows the same agent", true);
      check("hud: the link page logged no console errors", second.problems.length === 0, second.problems.join(" | "));
    } finally {
      await second.context.close();
    }

    // --- a station panel from the tool mix (the bank needs room) ---
    await page.keyboard.press("Escape");
    await waitInside(page, () => window.__swarm.inside.selected === -1);
    await page.setViewportSize({ width: 1440, height: 900 });
    // A visitor's own toggle outranks the viewport: after one, open it by hand.
    if ((await page.locator("[data-bank]").count()) === 0) await page.locator("[data-bank-toggle]").click();
    await page.locator("[data-bank]").waitFor({ state: "visible" });
    const row = page.locator("[data-tool-row]").first();
    await row.waitFor({ state: "visible" });
    const key = await row.getAttribute("data-tool-row");
    await row.click();
    await waitInside(page, (k) => window.__swarm.inside.station === k, key);
    const panel = page.locator("[data-station-panel]");
    await panel.waitFor({ state: "visible" });
    const calls = await panel.locator("[data-call]").count();
    check("hud: a station panel lists its calls", calls > 0, `${key}: ${calls} calls`);
    const first = await panel.locator("[data-call]").first().textContent();
    check("hud: a call shows its time, agent, tool, duration and size", /\d+:\d\d/.test(first) && first.trim().length > 12, first);
    check("hud: the station panel says there are no arguments", (await panel.textContent()).includes("no arguments"));
    await page.keyboard.press("Escape");
    await waitInside(page, () => window.__swarm.inside.station === null);
    check("hud: Escape closes the station panel", (await panel.count()) === 0);

    // --- the recap at the end ---
    await page.locator("[data-scrubber]").focus();
    await page.keyboard.press("End");
    await page.locator("[data-recap]").waitFor({ state: "visible", timeout: 5000 });
    const recap = await page.locator("[data-recap]").textContent();
    check("hud: the recap shows at the end of the run", /spawned/.test(recap) && /peak at once/.test(recap) && /TOKENS BY MODEL/.test(recap) && /LONGEST WAIT/.test(recap) && /failed calls/.test(recap) && /thinking/.test(recap), recap.slice(0, 90));
    await page.getByRole("button", { name: "Dismiss recap" }).click();
    await page.locator("[data-recap]").waitFor({ state: "detached" });
    check("hud: the recap can be dismissed", true);
    check("hud: logged no console errors or THREE warnings", problems.length === 0, problems.join(" | "));
  } finally {
    await context.close();
  }

  // --- the orchestrator marks its compactions (the large sample has one) ---
  const big = await h.openPage(browser, "/inside?source=large&seed=1");
  try {
    await waitInside(big.page, () => window.__swarm?.inside?.frame > 5, null, 90_000);
    await big.page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await big.page.locator("[data-next-agent]").focus();
    await big.page.keyboard.press("Enter");
    await waitInside(big.page, () => window.__swarm.inside.selected === 0);
    const card = big.page.locator("[data-detail-card]");
    await card.waitFor({ state: "visible" });
    // --- Follow and Jump are pinned to the card's bottom edge: on screen with no scrolling, at this 1280x720 viewport too ---
    const view = big.page.viewportSize();
    const cardBox = await card.boundingBox();
    const follow = await card.getByRole("button", { name: "Follow" }).boundingBox();
    check(
      "hud: the orchestrator card's Follow and Jump row is on screen without scrolling",
      cardBox !== null && follow !== null && follow.y >= cardBox.y && follow.y + follow.height <= cardBox.y + cardBox.height + 1 && follow.y + follow.height <= view.height + 1,
      `follow bottom ${follow && Math.round(follow.y + follow.height)}, card bottom ${cardBox && Math.round(cardBox.y + cardBox.height)}, viewport ${view.height}`,
    );
    // --- the NOW line and the card's badge read the same lane: waiting on you in both or in neither ---
    await big.page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await big.page.keyboard.press("Space");
    await waitInside(big.page, () => window.__swarm.inside.playing === false);
    await big.page.waitForTimeout(600);
    const now = await big.page.locator("[data-narration]").textContent();
    const state = await card.locator("[data-state]").getAttribute("data-state");
    check("hud: the NOW line and the orchestrator's badge agree on waiting on you", /waiting for the next prompt/.test(now) === (state === "waiting-on-you"), `now "${now}", badge ${state}`);
    const marks = card.locator("[data-eye=compactions]");
    check("hud: the orchestrator's card marks the compaction", (await marks.count()) === 1 && /Earlier detail was summarised here/.test(await marks.textContent()) && /tokens/.test(await marks.textContent()), (await marks.count()) ? await marks.textContent() : "none");
    check("hud: the large sample logged no console errors", big.problems.length === 0, big.problems.join(" | "));
  } finally {
    await big.context.close();
  }
}
