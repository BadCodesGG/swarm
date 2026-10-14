/**
 * End-to-end smoke test on the production build.
 *
 *   npm run build && npm run test:smoke [-- --port=3132] [--allow-software] [--only=site]
 *
 * Boots `next start` (it refuses to run without a build: dev mode hides prerender problems) and
 * drives it in Playwright Chromium. Prints a line per assertion, exits 1 on the first failure.
 * Every step fails on any console error, page error or `THREE.` warning.
 *
 * --allow-software is for CI runners, which have no GPU: WebGPU may fall back to SwiftShader or be
 * absent, so assertions that need a real WebGPU adapter are skipped.
 *
 * Steps (later slices append to STEPS):
 *   1. landing: `/` is 200, loads no WebGPURenderer, has its two doors to /inside and /box and a link to
 *      /about, and has no sideways scroll at 390 px.
 *   6. about: `/about` is 200, says Act 2 is a simulation and uploads stay in the browser, cites each
 *      source by title and link, has no sideways scroll at 390 px, and its og:image is a 1200x630 JPEG.
 *   7. site: both acts' first-visit tours (shown once, skippable, storage may throw), the ? sheet, the Inside to
 *      Box hand-off, the WebGL 2 badge and the new landing, About and Box copy (see smoke-site.mjs).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { boxSteps } from "./smoke-box.mjs";
import { stepHud } from "./smoke-hud.mjs";
import { stepImport } from "./smoke-import.mjs";
import { stepSite } from "./smoke-site.mjs";
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
// Software rendering is slow, so CI keeps the canvas small, but no smaller than the desktop HUD: it
// needs 640 px of height (`min-h-[640px]`), or its timeline sits below the fold where no click reaches
// it, and room for the side panels and the card in one row, or the card wraps under the timeline.
const VIEWPORT = SOFTWARE ? { width: 960, height: 720 } : { width: 1280, height: 720 };
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

/**
 * Opens a route in a fresh context. `scripts()` waits past idle and returns the body of every script
 * the visit loaded, lazy chunks and prefetches included, not only the ones the HTML names.
 */
async function openPage(browser, route, contextOptions = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, ...contextOptions });
  const page = await context.newPage();
  const problems = watch(page);
  const bodies = [];
  page.on("response", (r) => {
    if (r.request().resourceType() === "script") bodies.push(r.text().catch(() => ""));
  });
  const response = await page.goto(`${BASE}${route}`, { waitUntil: "load" });
  const scripts = async () => {
    await page.waitForTimeout(1500);
    return Promise.all(bodies);
  };
  return { context, page, problems, response, scripts };
}

/** The route's HTML, fetched directly. */
async function routeHtml(route) {
  const res = await fetch(`${BASE}${route}`);
  return { res, html: await res.text() };
}

async function stepLanding(browser) {
  console.log("-- 1. landing");
  const { res, html } = await routeHtml("/");
  check("GET / is 200", res.status === 200, String(res.status));

  const { context, page, problems, response, scripts } = await openPage(browser, "/");
  try {
    check("/ loads with status 200 in the browser", response?.status() === 200, String(response?.status()));
    const loaded = await scripts();
    check("/ carries no WebGPURenderer in its HTML or any script the visit loaded", ![html, ...loaded].some((t) => t.includes("WebGPURenderer")), `${loaded.length} scripts`);
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
    check("/ links to /inside", hrefs.includes("/inside"));
    check("/ links to /box", hrefs.includes("/box"));
    check("/ links to /about", hrefs.includes("/about"));
    const doors = await page.$$eval('nav[aria-label="Acts"] a', (as) => as.map((a) => a.getAttribute("href")));
    check("/ has the two doors, Inside then The Box", doors.join(",") === "/inside,/box", doors.join(","));
    check("/ says sound is off by default", (await page.textContent("body")).includes("Sound off by default"));
    check("/ logged no console errors or THREE warnings", problems.length === 0, problems.join(" | "));
  } finally {
    await context.close();
  }
  await checkPhone(browser, "/");
}

/** At a 390 px phone width the route renders, nothing scrolls sideways, and it logs no problems. */
async function checkPhone(browser, route) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    const problems = watch(page);
    const response = await page.goto(`${BASE}${route}`, { waitUntil: "load" });
    check(`${route} at 390 px is 200`, response?.status() === 200, String(response?.status()));
    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    check(`${route} at 390 px has no sideways scroll`, scroll <= client, `scrollWidth ${scroll}, clientWidth ${client}`);
    check(`${route} at 390 px logged no console errors`, problems.length === 0, problems.join(" | "));
  } finally {
    await context.close();
  }
}

/** Width and height from a JPEG's first start-of-frame marker, or null when it is not a JPEG. */
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    // SOF0 to SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/** Sources the about page must cite, each by title and link. */
const CITATIONS = [
  ["AI Control: Improving Safety Despite Intentional Subversion", "https://arxiv.org/abs/2312.06942"],
  ["Ctrl-Z: Controlling AI Agents via Resampling", "https://arxiv.org/abs/2504.10374"],
  ["SHADE-Arena: Evaluating Sabotage and Monitoring in LLM Agents", "https://arxiv.org/abs/2506.15740"],
  ["Making Claude Code more secure and autonomous with sandboxing", "https://www.anthropic.com/engineering/claude-code-sandboxing"],
];

async function stepAbout(browser) {
  console.log("-- 6. about");
  const { res, html } = await routeHtml("/about");
  check("GET /about is 200", res.status === 200, String(res.status));

  const { context, page, problems, response, scripts } = await openPage(browser, "/about");
  try {
    check("/about loads with status 200 in the browser", response?.status() === 200, String(response?.status()));
    const loaded = await scripts();
    check("/about carries no WebGPURenderer in its HTML or any script the visit loaded", ![html, ...loaded].some((t) => t.includes("WebGPURenderer")), `${loaded.length} scripts`);
    const text = await page.textContent("main");
    check("/about says Act 2 is a simulation", /The Box is a simulation/.test(text));
    check("/about says uploads are parsed in the browser and never sent", /parsed in a Web Worker on your device/.test(text) && /never uploaded/.test(text));
    const links = await page.$$eval("a[href]", (as) => as.map((a) => ({ href: a.getAttribute("href"), text: a.textContent?.trim() ?? "" })));
    for (const [title, href] of CITATIONS) {
      check(`/about cites "${title}"`, links.some((l) => l.href === href && l.text === title), href);
    }
    const og = await page.$$eval('meta[property^="og:image"]', (ms) => Object.fromEntries(ms.map((m) => [m.getAttribute("property"), m.getAttribute("content")])));
    check("/about og:image is 1200x630", og["og:image:width"] === "1200" && og["og:image:height"] === "630", JSON.stringify(og));
    const image = await fetch(new URL(new URL(og["og:image"]).pathname, BASE));
    const buf = Buffer.from(await image.arrayBuffer());
    const size = jpegSize(buf);
    check("/about og:image is a JPEG", image.status === 200 && image.headers.get("content-type") === "image/jpeg" && size !== null, `${image.status} ${image.headers.get("content-type")}`);
    check("og.jpg is 1200x630 and under 300 KB", size?.width === 1200 && size?.height === 630 && buf.length < 300 * 1024, `${size?.width}x${size?.height}, ${buf.length} bytes`);
    check("/about logged no console errors", problems.length === 0, problems.join(" | "));
  } finally {
    await context.close();
  }
  await checkPhone(browser, "/about");
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
      // Paused, so the scene is a pure function of the playhead. The camera frames one cluster, so most
      // live agents sit off screen: look for a moment with one in the open, clear of every panel.
      const findTarget = () =>
        page.evaluate(() => {
          const { screenOf, agents, selected } = window.__swarm.inside;
          // screenOf is canvas px; the mouse and elementFromPoint take viewport px.
          const rect = document.querySelector("canvas").getBoundingClientRect();
          for (let id = 1; id < agents; id++) {
            const p = screenOf(id);
            if (!p) continue;
            const x = rect.left + p.x;
            const y = rect.top + p.y;
            if (id !== selected && document.elementFromPoint(x, y) instanceof HTMLCanvasElement) return { id, x, y };
          }
          return null;
        });
      let target = null;
      for (const at of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.35, 0.55, 0.65, 0.45]) {
        await page.mouse.click(box.x + box.width * at, box.y + box.height / 2);
        await page.waitForTimeout(500);
        target = await findTarget();
        if (target) break;
      }
      check("medium: found a moment with a live subagent in the open", target !== null);
      check("medium: an agent is on screen to click", target !== null);
      // The camera still eases while paused, and on a slow software renderer an agent can drift off the
      // point between measuring it and the click: measure again right before each try.
      let picked = false;
      for (let attempt = 0; attempt < 5 && !picked; attempt++) {
        if (attempt > 0) target = (await findTarget()) ?? target;
        await page.mouse.click(target.x, target.y);
        picked = await waitInside(page, (id) => window.__swarm.inside.selected === id, target.id, 4000).then(() => true, () => false);
      }
      check("medium: clicking an agent selects it", picked, `agent ${target.id}`);
      const card = page.locator("[data-detail-card]");
      await card.waitFor({ state: "visible" });
      const title = await card.locator("h2").textContent();
      check("medium: the card names the agent", title.trim().length > 0, title);
      check("medium: the card has a brief", (await card.locator("[data-brief]").textContent()).trim().length > 0);
      check("medium: the card has Follow and Jump to its start", (await card.getByRole("button", { name: "Follow" }).count()) === 1 && (await card.getByRole("button", { name: "Jump to its start" }).count()) === 1);
      await card.getByRole("button", { name: "Follow" }).click();
      await waitInside(page, (id) => window.__swarm.inside.following === id, target.id);
      check("medium: Follow makes the camera follow", true);
      const spawnT = await page.evaluate((id) => window.__swarm.inside.spawnTOf(id), target.id);
      check("medium: the playhead is past the agent's start before the jump", (await inside(page)).t > spawnT, `spawn at ${spawnT}`);
      await card.getByRole("button", { name: "Jump to its start" }).click();
      await waitInside(page, (s) => Math.abs(window.__swarm.inside.t - s) < 1e-6, spawnT);
      check("medium: Jump to its start moves the playhead to the agent's spawn", true, `t = ${spawnT}`);
      await waitInside(page, (id) => window.__swarm.inside.selected === id, target.id);
      await card.getByRole("button", { name: "Close details" }).click();
      await waitInside(page, () => window.__swarm.inside.selected === -1);
      check("medium: closing the card clears the selection", (await card.count()) === 0);

      // The keyboard reaches the same card: the "A next agent" hint cycles from the orchestrator through
      // the live agents, Follow stays in the card, and Escape closes it and gives focus back.
      const next = page.locator("[data-next-agent]");
      await next.focus();
      await page.keyboard.press("Enter");
      await waitInside(page, () => window.__swarm.inside.selected === 0);
      await card.waitFor({ state: "visible" });
      check("keyboard: the first step selects the orchestrator and opens the card", true);
      await page.keyboard.press("Enter");
      await waitInside(page, () => window.__swarm.inside.selected > 0);
      check("keyboard: the next step selects a live subagent", (await card.getByRole("button", { name: "Follow" }).count()) === 1);
      await page.keyboard.press("a");
      const afterA = await inside(page);
      check("keyboard: A steps to another agent", afterA.selected >= 0, `agent ${afterA.selected}`);
      await page.keyboard.press("Escape");
      await waitInside(page, () => window.__swarm.inside.selected === -1);
      await page.waitForFunction(() => document.activeElement?.hasAttribute("data-next-agent"));
      check("keyboard: Escape closes the card and returns focus", (await card.count()) === 0);

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

/**
 * The phone's bottom sheet is a modal dialog: focus moves in, the window shortcuts and Tab stay off
 * the controls under it, and Escape closes it and gives focus back to the agent bar.
 */
async function stepInsidePhone(browser) {
  console.log("-- 2b. inside on a phone");
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  const { context, page, problems } = await openPage(browser, "/inside?source=medium&seed=1", phone);
  try {
    await waitInside(page, () => window.__swarm?.inside?.frame > 5, null, 90_000);
    await page.locator("button[aria-keyshortcuts=A]").first().focus();
    await page.keyboard.press("Enter");
    await waitInside(page, () => window.__swarm.inside.selected === 0);
    const bar = page.locator('button[aria-expanded][aria-label^="Selected agent"]');
    await bar.waitFor({ state: "visible" });
    // With the agent bar added the column still fits an 844 px phone; on a shorter one it scrolls to the scrubber.
    // The WebGL 2 badge adds a row of its own, and only that row may run over.
    const column = () => page.evaluate(() => {
      const s = document.querySelector("[data-under-sheet]");
      const bar = document.querySelector("[data-scrubber]").getBoundingClientRect();
      const badge = document.querySelector("[data-under-sheet] [data-webgl-badge]");
      const row = badge ? badge.getBoundingClientRect().height + parseFloat(getComputedStyle(s.firstElementChild).rowGap) : 0;
      return { content: s.scrollHeight, height: s.clientHeight, top: s.scrollTop, scrubber: bar.bottom, view: innerHeight, row };
    });
    const tall = await column();
    check("phone: with an agent selected the column fits 844 px", tall.content <= tall.height + tall.row, `content ${tall.content} of ${tall.height}, badge row ${Math.round(tall.row)}`);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector("[data-under-sheet]").scrollTo(0, 1e6));
    await page.waitForTimeout(200);
    const short = await column();
    check("phone: at 667 px the column scrolls the scrubber into view", short.top > 0 && short.scrubber <= short.view, `scrolled ${short.top}, scrubber bottom ${Math.round(short.scrubber)} of ${short.view}`);
    await page.evaluate(() => document.querySelector("[data-under-sheet]").scrollTo(0, 0));
    await page.setViewportSize(phone.viewport);
    await page.waitForTimeout(300);
    await bar.click();
    const dialog = page.getByRole("dialog", { name: "Selected agent details" });
    await dialog.waitFor({ state: "visible" });
    await page.waitForFunction(() => document.activeElement?.closest("[role=dialog]") != null);
    check("phone: opening the sheet moves focus into it", true);
    const before = await inside(page);
    await page.keyboard.press("Space");
    await page.keyboard.press("a");
    await page.keyboard.press("3");
    await page.waitForTimeout(200);
    const after = await inside(page);
    const same = after.playing === before.playing && after.selected === before.selected && after.rate === before.rate;
    check("phone: the window shortcuts are off while the sheet is open", same, JSON.stringify({ before: [before.playing, before.selected, before.rate], after: [after.playing, after.selected, after.rate] }));
    let under = 0;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.activeElement?.closest("[data-under-sheet]") != null)) under++;
    }
    check("phone: Tab never reaches the controls under the sheet", under === 0, `${under} of 12 presses`);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-expanded") === "false");
    check("phone: Escape closes the sheet and gives focus back to the agent bar", (await bar.getAttribute("aria-expanded")) === "false");
    check("phone: logged no console errors or THREE warnings", problems.length === 0, problems.join(" | "));
  } finally {
    await context.close();
  }
}

/** [name, step]; `--only=site` (comma-separated names) runs just those, for working on one step. */
const STEPS = [
  ["landing", stepLanding],
  ["inside", stepInside],
  ["phone", stepInsidePhone],
  ["hud", (browser) => stepHud(browser, { openPage, check, inside, waitInside, blur })],
  ...boxSteps({ check, openPage, software: SOFTWARE }).map((step, i) => [`box${i + 1}`, step]),
  ["import", (browser) => stepImport(browser, { BASE, openPage, check, inside, waitInside })],
  ["about", stepAbout],
  ["site", (browser) => stepSite(browser, { BASE, SOFTWARE, VIEWPORT, openPage, check, inside, waitInside, watch })],
];
const ONLY = value("only", "").split(",").filter(Boolean);

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
    for (const [name, step] of STEPS) if (ONLY.length === 0 || ONLY.includes(name)) await step(browser);
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
