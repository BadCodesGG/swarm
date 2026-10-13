/**
 * Screenshots of the import screen from the production build, into `.shots/import-<state>.png`:
 * empty drop zone (desktop and phone), the not-a-session error, and the several-sessions chooser.
 *
 *   npm run build && node scripts/shot-import.mjs [--port=3128]
 */

import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT, startDevServer, stopDevServer, waitForServer } from "./lib/dev-server.mjs";

const arg = process.argv.slice(2).find((a) => a.startsWith("--port="));
const PORT = Number(arg ? arg.slice(7) : 3128);
const BASE = `http://localhost:${PORT}`;
const SHOTS = path.join(ROOT, ".shots");
const FIXTURES = path.join(ROOT, "src", "lib", "trace", "__fixtures__");

mkdirSync(SHOTS, { recursive: true });
const scratch = mkdtempSync(path.join(os.tmpdir(), "swarm-shot-import-"));
const two = path.join(scratch, "two");
mkdirSync(path.join(two, "session", "subagents"), { recursive: true });
copyFileSync(path.join(FIXTURES, "session.jsonl"), path.join(two, "session.jsonl"));
copyFileSync(path.join(FIXTURES, "session.jsonl"), path.join(two, "other.jsonl"));
const notes = path.join(scratch, "notes.txt");
writeFileSync(notes, "not a session\n");

const server = startDevServer(PORT, "start");
try {
  await waitForServer(BASE);
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  const open = async (viewport, dsf = 1) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: dsf });
    const page = await context.newPage();
    await page.goto(`${BASE}/inside/load`, { waitUntil: "load" });
    await page.getByRole("heading", { name: "Watch your own swarm." }).waitFor();
    return { context, page };
  };
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `import-${name}.png`), fullPage: true });

  let s = await open({ width: 1440, height: 900 });
  await shot(s.page, "empty");
  await s.page.locator("[data-input=file]").setInputFiles(notes);
  await s.page.locator("[data-notice=no-session-file]").waitFor();
  await shot(s.page, "error");
  await s.context.close();

  s = await open({ width: 1440, height: 900 });
  await s.page.locator("[data-input=folder]").setInputFiles(two);
  await s.page.locator("[data-state=choose]").waitFor();
  await shot(s.page, "choose");
  await s.context.close();

  s = await open({ width: 1440, height: 900 });
  await s.page.locator("[data-input=folder]").setInputFiles(FIXTURES);
  await s.page.locator("[data-state=ready]").waitFor();
  await shot(s.page, "ready");
  await s.context.close();

  s = await open({ width: 390, height: 844 }, 2);
  await shot(s.page, "phone");
  await s.context.close();
  await browser.close();
  console.log("wrote .shots/import-{empty,error,choose,ready,phone}.png");
} finally {
  stopDevServer(server);
  rmSync(scratch, { recursive: true, force: true });
}
