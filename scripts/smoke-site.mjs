/**
 * Smoke step 7: the site-wide furniture. Wired into `scripts/smoke.mjs` as
 *
 *   (browser) => stepSite(browser, { BASE, SOFTWARE, VIEWPORT, openPage, check, inside, waitInside, watch })
 *
 * Asserts, on both acts: the first-visit tour is skipped by scripted browsers unless `?tour=1` asks
 * for it, shows once (the `swarm-tour-<act>` flag), steps with the keyboard, is skipped by Escape or
 * its button, keeps the page's own shortcuts quiet while open, and leaves a working page when storage
 * throws; the "?" sheet opens from its key and its button and lists the real shortcuts; the
 * Inside-to-Box hand-off carries a sample's agent count and models to /box (clamped and allowlisted
 * there) and the WebGL 2 badge follows the engine's own `isWebGPU`. The upload side of the hand-off
 * (no link, nothing in the URL) lives in `smoke-import.mjs`. Landing, About and the Box's metadata
 * copy are asserted at the end.
 */

const SAMPLE = "/inside?source=medium&seed=1";

/** Waits for an act's HUD tools (they mount once the engine is up). */
const toolsReady = (page) => page.locator("[data-act-tools] [data-help-open]").waitFor({ timeout: 90_000 });

const tourFlag = (page, act) => page.evaluate((a) => localStorage.getItem(`swarm-tour-${a}`), act);

export async function stepSite(browser, h) {
  const { check, openPage } = h;
  console.log("-- 7. site: tours, shortcuts, hand-off, fallback badge, copy");

  // --- the Inside tour: scripted browsers skip it, ?tour=1 shows it once ---
  {
    const { context, page, problems } = await openPage(browser, SAMPLE);
    try {
      await toolsReady(page);
      check("tour: a scripted browser is not met by the Inside tour", (await page.locator("[data-dialog=tour-inside]").count()) === 0);
      check("tour: the Inside ? button is in the page", (await page.locator("[data-help-open]").count()) === 1);
      check("tour: nothing is stored for a tour not shown", (await tourFlag(page, "inside")) === null);
      check("tour: logged no console errors or THREE warnings", problems.length === 0, problems.join(" | "));
    } finally {
      await context.close();
    }
  }
  {
    const { context, page, problems } = await openPage(browser, `${SAMPLE}&tour=1`);
    try {
      const dialog = page.locator("[data-dialog=tour-inside]");
      await dialog.waitFor({ state: "visible", timeout: 90_000 });
      check("tour: ?tour=1 shows the Inside tour as a modal dialog", (await dialog.evaluate((d) => d.open && d.matches(":modal"))) === true);
      check("tour: the dialog is named by its step title", (await dialog.getAttribute("aria-labelledby")) !== null && (await page.locator("[data-tour-title]").textContent()).length > 0);
      check("tour: step 1 of 3", /STEP 1 OF 3/.test(await page.locator("[data-tour-progress]").textContent()));
      check("tour: focus starts on Next", await page.evaluate(() => document.activeElement?.hasAttribute("data-tour-next")));

      // The page's own shortcuts stay quiet under the dialog.
      const before = await h.inside(page);
      await page.keyboard.press("3");
      await page.keyboard.press("a");
      await page.waitForTimeout(250);
      const during = await h.inside(page);
      check("tour: the window shortcuts are off while the tour is open", during.rate === before.rate && during.selected === before.selected, `${before.rate}/${before.selected} to ${during.rate}/${during.selected}`);

      // Tab stays in the dialog.
      let outside = 0;
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Tab");
        if (!(await page.evaluate(() => document.activeElement?.closest("dialog") != null))) outside++;
      }
      check("tour: Tab never leaves the dialog", outside === 0, `${outside} of 8 presses`);

      // Back to Next, then step with the keyboard.
      await page.locator("[data-tour-next]").focus();
      await page.keyboard.press("Enter");
      check("tour: Enter on Next goes to step 2", /STEP 2 OF 3/.test(await page.locator("[data-tour-progress]").textContent()));
      await page.locator("[data-tour-back]").click();
      check("tour: Back returns to step 1", /STEP 1 OF 3/.test(await page.locator("[data-tour-progress]").textContent()));

      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      check("tour: Escape skips the Inside tour", true);
      check("tour: skipping remembers it under swarm-tour-inside", (await tourFlag(page, "inside")) === "1");
      const after = await h.inside(page);
      check("tour: the replay is still running after the skip", after.playing === true || after.frame > before.frame, `frame ${before.frame} to ${after.frame}`);
      check("tour: logged no console errors or THREE warnings", problems.length === 0, problems.join(" | "));

      // Shown once: the same address, reloaded, opens no tour.
      await page.reload({ waitUntil: "load" });
      await toolsReady(page);
      await page.waitForTimeout(400);
      check("tour: a second visit does not show the Inside tour again", (await page.locator("[data-dialog=tour-inside]").count()) === 0);
    } finally {
      await context.close();
    }
  }
  {
    // The Skip button, and a storage that throws on every read and write.
    const { context, page, problems } = await openPage(browser, `${SAMPLE}&tour=1`);
    try {
      await page.locator("[data-dialog=tour-inside]").waitFor({ state: "visible", timeout: 90_000 });
      await page.locator("[data-tour-skip]").click();
      await page.locator("[data-dialog=tour-inside]").waitFor({ state: "detached" });
      check("tour: the Skip tour button closes it and remembers it", (await tourFlag(page, "inside")) === "1");
      check("tour: focus is not left on a removed control", await page.evaluate(() => document.activeElement !== null));
      check("tour: Skip logged no console errors", problems.length === 0, problems.join(" | "));
    } finally {
      await context.close();
    }
  }
  {
    const context = await browser.newContext({ viewport: h.VIEWPORT, deviceScaleFactor: 1 });
    await context.addInitScript(() => {
      const boom = () => {
        throw new DOMException("blocked", "SecurityError");
      };
      Storage.prototype.getItem = boom;
      Storage.prototype.setItem = boom;
      Storage.prototype.removeItem = boom;
    });
    const page = await context.newPage();
    const problems = h.watch(page);
    try {
      await page.goto(`${h.BASE}${SAMPLE}&tour=1`, { waitUntil: "load" });
      const dialog = page.locator("[data-dialog=tour-inside]");
      await dialog.waitFor({ state: "visible", timeout: 90_000 });
      check("storage throws: the Inside page still starts and shows its tour", true);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      await page.keyboard.press("?");
      await page.locator("[data-dialog=help-inside]").waitFor({ state: "visible" });
      check("storage throws: skipping and the ? sheet still work", true);
      await page.keyboard.press("Escape");
      await h.waitInside(page, () => window.__swarm?.inside?.frame > 5, null, 60_000);
      check("storage throws: the replay runs and logged no console errors", problems.length === 0, problems.join(" | "));
    } finally {
      await context.close();
    }
  }

  // --- the Box tour ---
  {
    const { context, page, problems } = await openPage(browser, "/box");
    try {
      await toolsReady(page);
      check("tour: a scripted browser is not met by the Box tour", (await page.locator("[data-dialog=tour-box]").count()) === 0);
      check("tour: logged no console errors or THREE warnings", problems.length === 0, problems.join(" | "));
    } finally {
      await context.close();
    }
  }
  {
    const { context, page, problems } = await openPage(browser, "/box?tour=1");
    try {
      const dialog = page.locator("[data-dialog=tour-box]");
      await dialog.waitFor({ state: "visible", timeout: 90_000 });
      check("tour: ?tour=1 shows the Box tour as a modal dialog", (await dialog.evaluate((d) => d.open && d.matches(":modal"))) === true);
      check("tour: the Box tour says it is a simulation", /simulation/i.test(await dialog.textContent()));
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      check("tour: Enter steps the Box tour to its last step", /STEP 3 OF 3/.test(await page.locator("[data-tour-progress]").textContent()));
      check("tour: the last step's button says it is the end", (await page.locator("[data-tour-next]").textContent()) === "Start exploring");
      await page.keyboard.press("Enter");
      await dialog.waitFor({ state: "detached" });
      check("tour: finishing remembers it under swarm-tour-box", (await tourFlag(page, "box")) === "1");
      check("tour: finishing the Inside tour did not mark the Box's", (await page.evaluate(() => localStorage.getItem("swarm-tour-inside"))) === null);
      await page.reload({ waitUntil: "load" });
      await toolsReady(page);
      await page.waitForTimeout(400);
      check("tour: a second visit does not show the Box tour again", (await page.locator("[data-dialog=tour-box]").count()) === 0);
      check("tour: Box logged no console errors or THREE warnings", problems.length === 0, problems.join(" | "));
    } finally {
      await context.close();
    }
  }
  {
    const { context, page } = await openPage(browser, "/box?tour=1");
    try {
      await page.locator("[data-dialog=tour-box]").waitFor({ state: "visible", timeout: 90_000 });
      await page.keyboard.press("Escape");
      await page.locator("[data-dialog=tour-box]").waitFor({ state: "detached" });
      check("tour: Escape skips the Box tour and remembers it", (await tourFlag(page, "box")) === "1");
    } finally {
      await context.close();
    }
  }

  // --- the ? sheet ---
  for (const [act, route, expected] of [
    ["inside", SAMPLE, ["Space", "Play or pause the replay", "Playback speed: 1x, 20x, 200x", "Select the next agent", "Hand the camera back to the director"]],
    ["box", "/box", ["Open that numbered breakout step's card", "Close the open card", "Hand the camera back to the director"]],
  ]) {
    const { context, page, problems } = await openPage(browser, route);
    try {
      await toolsReady(page);
      const sheet = page.locator(`[data-dialog=help-${act}]`);
      await page.keyboard.press("?");
      await sheet.waitFor({ state: "visible" });
      check(`help: ? opens the ${act} shortcut sheet as a modal dialog`, (await sheet.evaluate((d) => d.matches(":modal"))) === true);
      const text = await sheet.locator("[data-shortcuts]").textContent();
      check(`help: the ${act} sheet lists its real shortcuts`, expected.every((s) => text.includes(s)), text.slice(0, 120));
      if (act === "inside") {
        const before = await h.inside(page);
        // Not Space: on the focused Close button it is that button's own key.
        await page.keyboard.press("2");
        await page.keyboard.press("a");
        await page.waitForTimeout(250);
        const during = await h.inside(page);
        check("help: the window shortcuts are off while the sheet is open", during.rate === before.rate && during.selected === before.selected, `${before.rate}/${before.selected} to ${during.rate}/${during.selected}`);
      } else {
        // The sheet sits over the map: neither a wheel nor a drag on it may reach the camera behind.
        const box = await sheet.boundingBox();
        const at = { x: box.x + box.width / 2, y: box.y + 24 };
        await page.mouse.move(at.x, at.y);
        await page.keyboard.down("Control");
        await page.mouse.wheel(0, -400);
        await page.keyboard.up("Control");
        await page.mouse.down();
        await page.mouse.move(at.x + 60, at.y + 40);
        await page.mouse.up();
        await page.waitForTimeout(250);
        const mode = await page.evaluate(() => window.__swarm.box.camera.mode);
        check("help: a wheel or a drag on the box sheet leaves the camera with the director", mode === "director", mode);
      }
      await page.keyboard.press("?");
      await sheet.waitFor({ state: "detached" });
      check(`help: ? again closes the ${act} sheet`, true);
      const button = page.locator("[data-help-open]");
      await button.click();
      await sheet.waitFor({ state: "visible" });
      check(`help: the visible ? button opens the ${act} sheet`, true);
      await page.keyboard.press("Escape");
      await sheet.waitFor({ state: "detached" });
      check(`help: Escape closes the ${act} sheet and gives focus back to the button`, await page.evaluate(() => document.activeElement?.hasAttribute("data-help-open")));
      check(`help: the ${act} ? button names itself`, (await button.getAttribute("aria-label")) === "Keyboard shortcuts" && (await button.getAttribute("aria-keyshortcuts")) === "?");
      check(`help: ${act} logged no console errors or THREE warnings`, problems.length === 0, problems.join(" | "));
    } finally {
      await context.close();
    }
  }
  {
    // The sheet can replay the tour.
    const { context, page } = await openPage(browser, SAMPLE);
    try {
      await toolsReady(page);
      await page.keyboard.press("?");
      await page.locator("[data-help-tour]").click();
      await page.locator("[data-dialog=tour-inside]").waitFor({ state: "visible" });
      check("help: Replay the tour opens the tour from the sheet", (await page.locator("[data-dialog=help-inside]").count()) === 0);
    } finally {
      await context.close();
    }
  }

  // --- the hand-off, from a sample ---
  {
    const { context, page, problems } = await openPage(browser, SAMPLE);
    try {
      await h.waitInside(page, () => window.__swarm?.inside?.frame > 5, null, 90_000);
      const link = page.locator("[data-handoff]");
      await link.waitFor({ state: "visible" });
      const info = await h.inside(page);
      const href = await link.getAttribute("href");
      const q = new URL(href, h.BASE).searchParams;
      check("hand-off: a sample offers a link into /box", href.startsWith("/box?"), href);
      check("hand-off: it carries from=inside and the agent count", q.get("from") === "inside" && q.get("agents") === String(info.agents), href);
      const models = (q.get("models") ?? "").split(",");
      check("hand-off: it carries model names from the allowlist only", models.length > 0 && models.every((m) => ["opus", "fable", "sonnet", "haiku"].includes(m)), href);
      check("hand-off: and nothing else", [...q.keys()].sort().join(",") === "agents,from,models", [...q.keys()].join(","));
      await link.click();
      await page.waitForURL(/\/box\?from=inside/);
      const note = page.locator("[data-handoff-note]");
      await note.waitFor({ state: "visible", timeout: 90_000 });
      check("hand-off: /box says its cast came from Act 1", (await note.textContent()).includes(`${info.agents} AGENTS`), await note.textContent());
      await h.waitInside(page, () => window.__swarm?.box?.labs?.length > 0, null, 60_000);
      const box = await page.evaluate(() => JSON.parse(JSON.stringify(window.__swarm.box.labs)));
      const per = Math.min(80, Math.max(8, info.agents));
      check("hand-off: the Box runs three labs sized from the session", box.length === 3 && box.every((l) => l.agents === per), `${box.map((l) => l.agents)} expected ${per}`);
      check("hand-off: logged no console errors or THREE warnings", problems.length === 0, problems.join(" | "));
    } finally {
      await context.close();
    }
  }
  {
    // /box reads the parameters as untrusted: clamp the count, allowlist the models, drop the rest.
    const { context, page, problems } = await openPage(browser, "/box?from=inside&agents=99999999&models=%3Cscript%3Ealert(1)%3C%2Fscript%3E,opus,GPT-9");
    try {
      const note = page.locator("[data-handoff-note]");
      await note.waitFor({ state: "visible", timeout: 90_000 });
      check("hand-off: a huge count is clamped and unknown models dropped", (await note.textContent()).includes("500 AGENTS / 1 MODEL"), await note.textContent());
      await h.waitInside(page, () => window.__swarm?.box?.labs?.length > 0, null, 60_000);
      const agents = await page.evaluate(() => window.__swarm.box.labs.map((l) => l.agents));
      check("hand-off: the labs stay inside the lab limits", agents.length === 3 && agents.every((n) => n === 80), String(agents));
      check("hand-off: hostile parameters logged no console errors", problems.length === 0, problems.join(" | "));
    } finally {
      await context.close();
    }
  }
  {
    const { context, page, problems } = await openPage(browser, "/box?from=inside&agents=abc&models=zzz");
    try {
      await toolsReady(page);
      await h.waitInside(page, () => window.__swarm?.box?.labs?.length > 0, null, 60_000);
      check("hand-off: an unreadable one is no hand-off and the Box opens as usual", (await page.locator("[data-handoff-note]").count()) === 0 && (await page.evaluate(() => window.__swarm.box.labs.length)) === 3);
      check("hand-off: unreadable parameters logged no console errors", problems.length === 0, problems.join(" | "));
    } finally {
      await context.close();
    }
  }

  // --- the WebGL 2 badge follows the engine's own isWebGPU ---
  for (const [act, route] of [
    ["inside", SAMPLE],
    ["box", "/box"],
  ]) {
    const { context, page, problems } = await openPage(browser, route);
    try {
      await toolsReady(page);
      const isWebGPU = await page.evaluate((a) => window.__swarm[a].isWebGPU, act);
      const badges = await page.locator("[data-webgl-badge]").count();
      check(`badge: ${act} shows the WebGL 2 badge exactly when the engine runs without WebGPU`, badges === (isWebGPU ? 0 : 1), `isWebGPU ${isWebGPU}, ${badges} badge(s)`);
      if (h.SOFTWARE) check(`badge: ${act} shows it under --allow-software`, badges === 1);
      check(`badge: ${act} logged no unexpected console errors or THREE warnings`, problems.length === 0, problems.join(" | "));
    } finally {
      await context.close();
    }
  }
  for (const [act, route] of [
    ["inside", `${SAMPLE}&webgl=1`],
    ["box", "/box?webgl=1"],
  ]) {
    const { context, page } = await openPage(browser, route);
    try {
      await toolsReady(page);
      const badge = page.locator("[data-webgl-badge]");
      await badge.first().waitFor({ state: "visible" });
      check(`badge: ?webgl=1 forces the ${act} fallback and its badge`, /WEBGL 2 MODE/.test(await badge.first().textContent()));
      if (act === "box") check("badge: the Box badge says the crowd runs on the CPU", /CPU CROWD/.test(await badge.first().textContent()));
      await page.keyboard.press("?");
      await page.locator(`[data-dialog=help-${act}]`).waitFor({ state: "visible" });
      check(`badge: the ${act} sheet explains the fallback`, (await page.locator("[data-fallback-note]").count()) === 1);
    } finally {
      await context.close();
    }
  }

  // --- the copy on the landing, the About page and the Box's metadata ---
  {
    const landing = await (await fetch(`${h.BASE}/`)).text();
    check("copy: / names the Box as a labelled simulation of three fictional labs", landing.includes("A labelled simulation of three fictional labs"));
    check("copy: / says Inside keeps your session in your browser", landing.includes("Your session never leaves your browser."));
    check("copy: / points at the tour and the ? key", landing.includes("Each act opens with a short tour. Press ? inside either one for its keys."));
    const about = await (await fetch(`${h.BASE}/about`)).text();
    for (const phrase of ["Three fictional labs share one map.", "You can play it three ways.", "From Act 1 to Act 2.", "Each act opens with a short tour the first time you visit"]) {
      check(`copy: /about says "${phrase}"`, about.includes(phrase));
    }
    check("copy: /about keeps Act 2 labelled a simulation", about.includes("The Box is a simulation."));
    const box = await (await fetch(`${h.BASE}/box`)).text();
    check("copy: /box's description names the three fictional labs", /<meta name="description" content="[^"]*three fictional labs/.test(box));
    check("copy: /box's title is Act 2", /<title>Act 2, The Box/.test(box));
    const dash = String.fromCharCode(0x2014);
    check("copy: no em dash on the landing, About or Box pages", ![landing, about, box].some((t) => t.includes(dash) || t.includes("&mdash;")));
  }
  {
    const { context, page, problems } = await openPage(browser, "/");
    try {
      const art = await page.$$eval('nav[aria-label="Acts"] a svg', (s) => s.length);
      check("copy: both landing doors carry their art", art >= 2, String(art));
      check("copy: / logged no console errors", problems.length === 0, problems.join(" | "));
    } finally {
      await context.close();
    }
  }
}
