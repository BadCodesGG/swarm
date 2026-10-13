/**
 * Smoke step 3: importing a session through the real file inputs. Wired into `scripts/smoke.mjs` as
 *
 *   import { stepImport } from "./smoke-import.mjs";
 *   const STEPS = [stepLanding, stepInside, (b) => stepImport(b, { BASE, openPage, check, inside, waitInside }), ...];
 *
 * Folder import relies on Playwright's `setInputFiles` with a directory path on a `webkitdirectory`
 * input, which keeps `subagents/` in `webkitRelativePath` (probed in headless Chromium: the fixture's
 * 26 subagent files arrive as `<dir>/session/subagents/agent-*.jsonl`).
 *
 * Asserts: the fixture folder plays as source `upload` with 16 agents (the orchestrator included), the
 * `<img src=x onerror=alert(1)>` prompt is literal text and never an element or a dialog, an import
 * makes no request beyond same-origin static assets and the route, a reload with nothing in memory falls
 * back to the medium sample with a notice, and a non-session file shows the not-a-session error.
 */

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "trace", "__fixtures__");
const FIXTURE_AGENTS = 16;
const HOSTILE = "<img src=x onerror=alert(1)>";

/** Records everything the page requests and every dialog it tries to open. */
function record(page) {
  const log = { requests: [], dialogs: [] };
  page.on("request", (r) => log.requests.push({ url: r.url(), method: r.method(), body: r.postData() }));
  page.on("dialog", (d) => {
    log.dialogs.push(d.message());
    void d.dismiss();
  });
  return log;
}

/**
 * A request an import may make: a body-less GET to this site (its chunks, fonts, favicon, and the router's
 * link prefetches). Anything cross-origin or carrying a body would be the session leaving the tab.
 */
function allowed(req, base) {
  return new URL(req.url).origin === new URL(base).origin && req.method === "GET" && req.body === null;
}

const arrived = (page, h) => h.waitInside(page, () => window.__swarm?.inside?.frame > 5 && window.__swarm.inside.traceSource === "upload", null, 90_000);

export async function stepImport(browser, h) {
  const { check } = h;
  console.log("-- 3. import");
  const scratch = mkdtempSync(path.join(os.tmpdir(), "swarm-import-"));
  try {
    // A folder with two sessions: the chooser, and the hostile prompt shown as text.
    const two = path.join(scratch, "two");
    mkdirSync(path.join(two, "session", "subagents"), { recursive: true });
    copyFileSync(path.join(FIXTURES, "session.jsonl"), path.join(two, "session.jsonl"));
    // The fixture's hostile prompt is not its first human line, so a second session opens with it.
    const hostileLine = readFileSync(path.join(FIXTURES, "session.jsonl"), "utf8").split(/\r?\n/).find((l) => l.includes("onerror=alert(1)"));
    writeFileSync(path.join(two, "other.jsonl"), `${hostileLine}\n`);
    for (const name of ["agent-a0000000000000002.jsonl", "agent-a0000000000000002.meta.json"]) {
      copyFileSync(path.join(FIXTURES, "session", "subagents", name), path.join(two, "session", "subagents", name));
    }
    const notSession = path.join(scratch, "notes.txt");
    writeFileSync(notSession, "this is not a Claude Code session\n");

    // --- the fixture folder plays ---
    {
      const { context, page, problems } = await h.openPage(browser, "/inside/load");
      const log = record(page);
      try {
        await page.getByRole("heading", { name: "Watch your own swarm." }).waitFor();
        const folderInput = page.locator("[data-input=folder]");
        check("load: the folder input takes a directory", (await folderInput.getAttribute("webkitdirectory")) !== null);
        check("load: the file input takes .jsonl", (await page.locator("[data-input=file]").getAttribute("accept")) === ".jsonl");
        check("load: says nothing is uploaded", (await page.getByText("Parsed in your browser. Nothing is uploaded or stored.").count()) === 1);

        log.requests.length = 0;
        await folderInput.setInputFiles(FIXTURES);
        await page.locator("[data-state=ready]").waitFor({ timeout: 60_000 });
        const report = await page.locator("[data-state=ready] [data-report]").textContent();
        check("load: the parse report counts what was skipped", /skipped/.test(report ?? "") && /unknown/.test(report ?? ""), report ?? "");
        // The fixture keeps one spawn whose transcript is absent on purpose.
        check("load: a spawn without its file shows the missing-subagents notice and a folder input", (await page.locator("[data-notice=child-missing] [data-input=missing-folder]").count()) === 1);

        await page.getByRole("button", { name: "Play this session" }).click();
        await page.waitForURL(/\/inside\?source=upload/);
        await arrived(page, h);
        const first = await h.inside(page);
        check("import: source is upload", first.traceSource === "upload" && first.source === "upload", `${first.traceSource}/${first.source}`);
        check("import: the agent count matches the fixture", first.agents === FIXTURE_AGENTS, `${first.agents} agents`);
        check("import: playback runs", (await h.inside(page)).playing === true);
        check("import: no sample tag", (await page.locator("[data-sample-tag]").count()) === 0);
        check("import: the switcher shows Your session active", (await page.locator('button[aria-pressed=true]:text-is("Your session")').count()) === 1);
        check("import: no sample button is pressed", (await page.locator('[aria-label="Session source"] button[aria-pressed=true]:not(:text-is("Your session"))').count()) === 0);
        check("import: no hostile element or dialog", (await page.locator('img[src="x"]').count()) === 0 && log.dialogs.length === 0, log.dialogs.join(" | "));

        const stray = log.requests.filter((r) => !allowed(r, h.BASE));
        check("import: no request beyond this site's own assets and routes", stray.length === 0, stray.map((r) => `${r.method} ${r.url}`).join(" | "));
        const stored = await page.evaluate(() => ({
          keys: Object.keys(localStorage).filter((k) => !k.startsWith("swarm-")),
          session: sessionStorage.length,
          search: location.search,
        }));
        check("import: nothing is stored or put in the URL", stored.keys.length === 0 && stored.session === 0 && stored.search === "?source=upload", JSON.stringify(stored));

        // Reload: nothing in memory, so a sample plays and says so.
        await page.reload({ waitUntil: "load" });
        await h.waitInside(page, () => window.__swarm?.inside?.frame > 5, null, 90_000);
        const after = await h.inside(page);
        check("reload: falls back to a sample", after.traceSource === "sample" && after.label.startsWith("Sample medium") && after.uploadMissing === true, `${after.traceSource} ${after.label}`);
        await page.locator("[data-upload-missing]").waitFor({ state: "visible" });
        check("reload: says the session is not kept", true);
        check("import: logged no console errors or THREE warnings", problems.length === 0, problems.join(" | "));
      } finally {
        await context.close();
      }
    }

    // --- several sessions: the chooser shows the hostile prompt as text ---
    {
      const { context, page, problems } = await h.openPage(browser, "/inside/load");
      const log = record(page);
      try {
        await page.getByRole("heading", { name: "Watch your own swarm." }).waitFor();
        await page.locator("[data-input=folder]").setInputFiles(two);
        await page.locator("[data-state=choose]").waitFor({ timeout: 60_000 });
        const rows = await page.locator("[data-first-prompt]").allTextContents();
        check("choose: lists both sessions", rows.length === 2, `${rows.length} rows`);
        check("choose: the hostile prompt is literal text", rows.some((t) => t.includes(HOSTILE)), JSON.stringify(rows));
        check("choose: it made no element and opened no dialog", (await page.locator('img[src="x"]').count()) === 0 && log.dialogs.length === 0);
        check("choose: the first session is selected", (await page.locator("input[type=radio]:checked").count()) === 1);
        // The hostile file has no conversation; choose the real session (the one with a subagent).
        await page.locator("label", { hasText: "1 agent" }).locator("input[type=radio]").check();
        await page.getByRole("button", { name: "Play this session" }).click();
        // The chosen session has a malformed line, so it stops at the ready view first.
        await page.waitForFunction(() => location.pathname === "/inside" || document.querySelector("[data-state=ready]"), null, { timeout: 60_000 });
        if (new URL(page.url()).pathname !== "/inside") await page.getByRole("button", { name: "Play this session" }).click();
        await page.waitForURL(/\/inside\?source=upload/, { timeout: 60_000 });
        await arrived(page, h);
        const chosen = await h.inside(page);
        check("choose: the chosen session plays as an upload", chosen.traceSource === "upload", `${chosen.agents} agents`);
        check("choose: no hostile element in the HUD", (await page.locator('img[src="x"]').count()) === 0 && log.dialogs.length === 0);
        check("choose: logged no console errors or THREE warnings", problems.length === 0, problems.join(" | "));
      } finally {
        await context.close();
      }
    }

    // --- not a session ---
    {
      const { context, page, problems } = await h.openPage(browser, "/inside/load");
      try {
        await page.getByRole("heading", { name: "Watch your own swarm." }).waitFor();
        await page.locator("[data-input=file]").setInputFiles(notSession);
        const err = page.locator("[data-notice=no-session-file]");
        await err.waitFor({ timeout: 30_000 });
        check("error: a non-session file shows the not-a-session error", (await err.textContent()).includes("That is not a session file"));
        // Within the page itself: Next adds its own route announcer outside it.
        const live = page.locator("main").locator("[role=status], [role=alert], [aria-live]");
        check("error: the page has exactly one live region", (await live.count()) === 1, String(await live.count()));
        check("error: the live region announces it", (await live.first().textContent()).includes("That is not a session file"));
        const [zone, notice] = [await page.locator("[data-dropzone]").boundingBox(), await err.boundingBox()];
        check("error: it shows beside or under the drop zone", notice.y < zone.y + zone.height + 40, `zone ends ${zone.y + zone.height}, notice at ${notice.y}`);
        check("error: the page stays on the import screen", new URL(page.url()).pathname === "/inside/load");
        check("error: logged no console errors", problems.length === 0, problems.join(" | "));
      } finally {
        await context.close();
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
