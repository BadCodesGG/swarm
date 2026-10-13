/**
 * Shared capture loop for the scripts that save a frame of a live act into `public/` (og.mjs,
 * stills.mjs). Launch strategies are tried in order, as in shot.mjs, since WebGPU in automated
 * Chromium depends on headless mode and GPU flags; a strategy that falls back to WebGL2 is rejected.
 * Any console error, page error or `THREE.` warning fails the capture.
 */

import { chromium } from "playwright";

const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer", "--use-angle=d3d11", "--ignore-gpu-blocklist"];

export const STRATEGIES = [
  { label: "headless shell + GPU flags", launch: { headless: true, args: GPU_ARGS } },
  { label: "new headless (channel chromium) + GPU flags", launch: { headless: true, channel: "chromium", args: GPU_ARGS } },
  { label: "headed + GPU flags", launch: { headless: false, args: GPU_ARGS } },
  { label: "headless + SwiftShader WebGPU adapter", launch: { headless: true, args: [...GPU_ARGS, "--use-webgpu-adapter=swiftshader"] } },
];

/**
 * Opens `url` with `context` options, waits for `ready(page)`, then runs `shoot(page)`. Returns the
 * first strategy's result whose page drew with WebGPU and logged nothing it should not have.
 * `act` is the `window.__swarm` entry that reports `isWebGPU`.
 */
export async function capture({ url, context: contextOptions, act, ready, shoot }) {
  for (const strategy of STRATEGIES) {
    console.log(`Trying: ${strategy.label}`);
    let browser;
    try {
      browser = await chromium.launch(strategy.launch);
      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      const problems = [];
      page.on("console", (msg) => {
        const text = msg.text();
        if (msg.type() === "error") problems.push(text);
        else if (text.includes("THREE.")) problems.push(`THREE warning: ${text}`);
      });
      page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
      await page.goto(url, { waitUntil: "load" });
      await ready(page);
      const isWebGPU = await page.evaluate((name) => window.__swarm?.[name]?.isWebGPU === true, act);
      if (!isWebGPU) {
        console.log("  rejected: fell back to WebGL2");
        continue;
      }
      const result = await shoot(page);
      if (problems.length) throw new Error(`console errors or warnings:\n  ${problems.join("\n  ")}`);
      console.log(`  worked: ${strategy.label}`);
      return result;
    } catch (err) {
      if (err.message.startsWith("console errors")) throw err;
      console.log(`  failed: ${err.message.split("\n")[0]}`);
    } finally {
      await browser?.close();
    }
  }
  throw new Error("No launch strategy produced a WebGPU frame");
}

/** Saves a JPEG under `maxBytes`, stepping the quality down until it fits. Returns { bytes, quality }. */
export async function jpegUnder(shot, maxBytes, qualities = [86, 80, 74, 68, 62]) {
  for (const quality of qualities) {
    const buf = await shot({ type: "jpeg", quality });
    if (buf.length <= maxBytes) return { buf, quality };
  }
  throw new Error(`no JPEG quality in [${qualities.join(", ")}] fits under ${maxBytes} bytes`);
}
