/**
 * End-to-end smoke test on the production build.
 *
 *   npm run build && npm run test:smoke [-- --port=3132] [--allow-software]
 *
 * Boots `next start` (it refuses to run without a build: dev mode hides prerender problems) and
 * drives it in Playwright Chromium. Prints a line per assertion, exits 1 on the first failure.
 * Every step fails on any console error, page error or `THREE.` warning.
 *
 * --allow-software is for CI runners, which have no GPU: WebGPU may fall back to SwiftShader or be
 * absent, so assertions that need a real WebGPU adapter are skipped.
 *
 * Steps (later slices append to STEPS):
 *   1. landing: `/` is 200, loads no WebGPURenderer, and links to /inside and /box.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT, startDevServer, stopDevServer, waitForServer } from "./lib/dev-server.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(value("port", 3132));
const BASE = `http://localhost:${PORT}`;
const SOFTWARE = flag("allow-software");

const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer", "--use-angle=d3d11", "--ignore-gpu-blocklist"];
// A GPU-less runner gets no WebGPU flags: the page then takes whatever fallback the browser really offers.
const SOFTWARE_ARGS = ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-gpu"];
const BROWSER_ARGS = SOFTWARE ? SOFTWARE_ARGS : GPU_ARGS;
const VIEWPORT = SOFTWARE ? { width: 640, height: 360 } : { width: 1280, height: 720 };
// With no WebGPU adapter at all, three says so once as it falls back; that is the expected path here.
const EXPECTED_WARNINGS = SOFTWARE ? ["THREE.WebGPURenderer: WebGPU is not available, running under WebGL2 backend."] : [];

function fail(message) {
  console.error(`FAIL  ${message}`);
  throw new Error(message);
}

function check(label, ok, detail = "") {
  if (!ok) fail(`${label}${detail ? ` (${detail})` : ""}`);
  console.log(`PASS  ${label}${detail ? ` (${detail})` : ""}`);
}

/** Console problems: any error, any pageerror, any THREE.* warning. */
function watch(page) {
  const problems = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error") problems.push(text);
    else if (text.includes("THREE.") && !EXPECTED_WARNINGS.includes(text)) problems.push(`warning: ${text}`);
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

async function openPage(browser, route) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = watch(page);
  const response = await page.goto(`${BASE}${route}`, { waitUntil: "load" });
  return { context, page, problems, response };
}

/** Fetches the route's HTML and every same-origin script it references. */
async function routeSources(route) {
  const res = await fetch(`${BASE}${route}`);
  const html = await res.text();
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  const scripts = await Promise.all(srcs.map((s) => fetch(new URL(s, BASE)).then((r) => r.text())));
  return { res, html, scripts };
}

async function stepLanding(browser) {
  console.log("-- 1. landing");
  const { res, html, scripts } = await routeSources("/");
  check("GET / is 200", res.status === 200, String(res.status));
  check("/ carries no WebGPURenderer", ![html, ...scripts].some((t) => t.includes("WebGPURenderer")), `${scripts.length} scripts`);

  const { context, page, problems, response } = await openPage(browser, "/");
  try {
    check("/ loads with status 200 in the browser", response?.status() === 200, String(response?.status()));
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
    check("/ links to /inside", hrefs.includes("/inside"));
    check("/ links to /box", hrefs.includes("/box"));
    check("/ logged no console errors or THREE warnings", problems.length === 0, problems.join(" | "));
  } finally {
    await context.close();
  }
}

/** Agent and event counts a sample of each size must land in (see `generate.test.ts`). */
const BANDS = {
  small: { agents: [3, 8], events: [150, 400] },
  medium: { agents: [10, 25], events: [1000, 3000] },
  large: { agents: [40, 120], events: [8000, 20000] },
};

/** The inside debug entry as plain data (JSON drops its functions). */
const inside = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__swarm.inside)));
const waitInside = (page, fn, arg, timeout = 30_000) => page.waitForFunction(fn, arg, { timeout });
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
/** The number shown under a counter label, e.g. `TOOL CALLS`. */
const counter = (page, label) =>
  page.evaluate((l) => {
    for (const dt of document.querySelectorAll("dl[aria-label=Counters] dt")) {
      if (dt.textContent === l) return Number(dt.nextElementSibling.textContent.replace(/[^0-9]/g, ""));
    }
    return null;
  }, label);

async function stepInside(browser) {
  console.log("-- 2. inside");
  for (const size of ["small", "medium", "large"]) {
    const { context, page, problems } = await openPage(browser, `/inside?source=${size}&seed=1`);
    try {
      await waitInside(page, () => window.__swarm?.inside?.frame > 5, null, 90_000);
      const first = await inside(page);
      const band = BANDS[size];
      check(`${size}: agent count in band`, first.agents >= band.agents[0] && first.agents <= band.agents[1], `${first.agents} agents`);
      check(`${size}: event count in band`, first.events >= band.events[0] && first.events <= band.events[1], `${first.events} events`);
      check(`${size}: label says ${size}`, first.label.startsWith(`Sample ${size}`), first.label);

      const tag = page.locator("[data-sample-tag]");
      await tag.waitFor({ state: "visible" });
      check(`${size}: sample tag is visible`, (await tag.textContent()).includes("Sample session: generated to look like a real one"));
      check(`${size}: source button is pressed`, (await page.locator(`button[aria-pressed=true]:text-is("${size[0].toUpperCase()}${size.slice(1)}")`).count()) === 1);

      // Frames and playback time advance.
      await page.waitForTimeout(700);
      const later = await inside(page);
      check(`${size}: frames advance`, later.frame > first.frame, `${first.frame} to ${later.frame}`);
      check(`${size}: playback advances at 1x`, later.t > first.t, `${first.t.toFixed(2)} to ${later.t.toFixed(2)}`);

      if (size !== "medium") {
        check(`${size}: logged no console errors or THREE warnings`, problems.length === 0, problems.join(" | "));
        continue;
      }

      // Rate 200 advances much faster, and the counters follow the playhead.
      await page.getByRole("button", { name: "200x" }).click();
      await blur(page);
      const before = await inside(page);
      await page.waitForTimeout(600);
      const fast = await inside(page);
      check("medium: rate 200 is set", fast.rate === 200, String(fast.rate));
      check("medium: rate 200 advances", fast.t - before.t > 20, `${(fast.t - before.t).toFixed(1)} trace seconds in 0.6 s`);

      // Keyboard: Space pauses, Right / Left scrub, 1 / 2 / 3 set the speed.
      await page.keyboard.press("Space");
      await waitInside(page, () => window.__swarm.inside.playing === false);
      check("medium: Space pauses", true);
      const paused = await inside(page);
      await page.keyboard.press("ArrowRight");
      await waitInside(page, (t) => window.__swarm.inside.t > t, paused.t);
      const right = await inside(page);
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowLeft");
      await waitInside(page, (t) => window.__swarm.inside.t < t, right.t);
      check("medium: Right and Left scrub", true);
      await page.keyboard.press("1");
      await waitInside(page, () => window.__swarm.inside.rate === 1);
      await page.keyboard.press("2");
      await waitInside(page, () => window.__swarm.inside.rate === 20);
      await page.keyboard.press("3");
      await waitInside(page, () => window.__swarm.inside.rate === 200);
      check("medium: 1, 2 and 3 set the speed", true);

      // Seek back by clicking the scrubber: the counters read countersAt at the new time.
      await page.keyboard.press("3");
      await page.keyboard.press("Space");
      await page.waitForTimeout(1200);
      await page.keyboard.press("Space");
      await waitInside(page, () => window.__swarm.inside.playing === false);
      const callsAhead = await counter(page, "TOOL CALLS");
      const tAhead = (await inside(page)).t;
      const box = await page.locator("[data-scrubber]").boundingBox();
      await page.mouse.click(box.x + box.width * 0.02, box.y + box.height / 2);
      await waitInside(page, (t) => window.__swarm.inside.t < t, tAhead);
      await page.waitForTimeout(300);
      const back = await inside(page);
      const callsBack = await counter(page, "TOOL CALLS");
      check("medium: seeking back lowers the playhead and the tool-call counter", callsBack < callsAhead, `${callsAhead} to ${callsBack}`);
      check("medium: the counter reads countersAt at the new time", callsBack === back.counters.toolCalls, `${callsBack} vs ${back.counters.toolCalls}`);

      // Clicking an agent selects it and fills the card.
      // Paused, so the scene is a pure function of the playhead: find a moment with several agents out.
      let crowded = false;
      for (const at of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
        await page.mouse.click(box.x + box.width * at, box.y + box.height / 2);
        await page.waitForTimeout(250);
        if ((await inside(page)).agentsAlive >= 3) {
          crowded = true;
          break;
        }
      }
      check("medium: found a moment with several live subagents", crowded);
      const target = await page.evaluate(() => {
        const { screenOf, agents, selected } = window.__swarm.inside;
        const pts = [];
        for (let id = 1; id < agents; id++) {
          const p = screenOf(id);
          if (p) pts.push({ id, ...p });
        }
        const clear = pts.filter((p) => {
          const el = document.elementFromPoint(p.x, p.y);
          return el instanceof HTMLCanvasElement && p.id !== selected;
        });
        return clear[0] ?? null;
      });
      check("medium: an agent is on screen to click", target !== null);
      await page.mouse.click(target.x, target.y);
      await waitInside(page, (id) => window.__swarm.inside.selected === id, target.id);
      check("medium: clicking an agent selects it", true, `agent ${target.id}`);
      const card = page.locator("[data-detail-card]");
      await card.waitFor({ state: "visible" });
      const title = await card.locator("h2").textContent();
      check("medium: the card names the agent", title.trim().length > 0, title);
      check("medium: the card has a brief", (await card.locator("[data-brief]").textContent()).trim().length > 0);
      check("medium: the card has Follow and Jump to its start", (await card.getByRole("button", { name: "Follow" }).count()) === 1 && (await card.getByRole("button", { name: "Jump to its start" }).count()) === 1);
      await card.getByRole("button", { name: "Follow" }).click();
      await waitInside(page, (id) => window.__swarm.inside.following === id, target.id);
      check("medium: Follow makes the camera follow", true);
      await card.getByRole("button", { name: "Jump to its start" }).click();
      await waitInside(page, (id) => window.__swarm.inside.selected === id, target.id);
      await card.getByRole("button", { name: "Close details" }).click();
      await waitInside(page, () => window.__swarm.inside.selected === -1);
      check("medium: closing the card clears the selection", (await card.count()) === 0);

      // The switcher swaps the trace in place and rewrites ?source=.
      const frame = (await inside(page)).frame;
      await page.getByRole("button", { name: "Large" }).click();
      await waitInside(page, () => window.__swarm.inside.label.startsWith("Sample large"));
      const swapped = await inside(page);
      check("medium: switching to Large swaps the trace", swapped.agents >= BANDS.large.agents[0], `${swapped.agents} agents`);
      check("medium: switching keeps the renderer running", swapped.frame > frame);
      check("medium: switching rewrites ?source=", new URL(page.url()).searchParams.get("source") === "large", page.url());
      check("medium: the sample tag stays", (await tag.count()) === 1);
      check("medium: logged no console errors or THREE warnings", problems.length === 0, problems.join(" | "));
    } finally {
      await context.close();
    }
  }
}

const STEPS = [stepLanding, stepInside];

if (!existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
  console.error("FAIL  no production build: run `npm run build` first (the smoke test serves `next start`)");
  process.exit(1);
}

let exitCode = 1;
const server = startDevServer(PORT, "start");
try {
  await waitForServer(BASE);
  console.log(`serving the production build on ${BASE}`);
  const browser = await chromium.launch({ headless: true, channel: "chromium", args: BROWSER_ARGS });
  try {
    for (const step of STEPS) await step(browser);
  } finally {
    await browser.close();
  }
  console.log("SMOKE OK");
  exitCode = 0;
} catch (err) {
  console.error(`smoke failed: ${err.message}`);
} finally {
  stopDevServer(server);
}
process.exit(exitCode);
