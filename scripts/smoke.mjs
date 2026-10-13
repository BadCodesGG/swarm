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

const STEPS = [stepLanding];

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
