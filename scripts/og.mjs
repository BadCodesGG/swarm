/**
 * Renders the share image, `public/og.jpg` (1200x630 JPEG, under 300 KB), from the production build.
 *
 *   npm run build && node scripts/og.mjs [--act=inside|box] [--port=3129]
 *
 * Starts `next start`, opens the Act 1 hero frame (`/inside?shot=hero&source=medium&hud=0`, the
 * default) or the Act 2 escape (`/box?shot=escape`) in Playwright Chromium at 1200x630, DPR 1, waits
 * for the fixed-clock frame to settle and the loader to fade, lays the title over it, and writes
 * the JPEG at the highest quality that fits the budget. Fails on any console error or `THREE.`
 * warning, or when no launch strategy draws with WebGPU (see scripts/lib/capture.mjs).
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { capture, jpegUnder } from "./lib/capture.mjs";
import { ROOT, startDevServer, stopDevServer, waitForServer } from "./lib/dev-server.mjs";

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PORT = Number(value("port", 3129));
const BASE = `http://localhost:${PORT}`;
const ACT = value("act", "inside") === "box" ? "box" : "inside";
const OUT = path.join(ROOT, "public", "og.jpg");
const MAX_BYTES = 300 * 1024;
const SIZE = { width: 1200, height: 630 };

const url = ACT === "inside" ? `${BASE}/inside?shot=hero&source=medium&hud=0` : `${BASE}/box?shot=escape`;

/** The title block, drawn in the page with its own fonts; text only, no markup from outside. */
function overlayTitle() {
  const wrap = document.createElement("div");
  Object.assign(wrap.style, {
    position: "fixed",
    inset: "0",
    zIndex: "50",
    pointerEvents: "none",
    background: "linear-gradient(90deg, rgba(7,9,16,0.96) 0%, rgba(7,9,16,0.9) 40%, rgba(7,9,16,0) 64%)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    gap: "18px",
    padding: "0 64px 64px",
    boxSizing: "border-box",
    fontFamily: "var(--font-sans)",
    color: "#f6f8fc",
  });
  const eyebrow = document.createElement("p");
  eyebrow.textContent = "AN EXPERIMENT IN TWO ACTS";
  Object.assign(eyebrow.style, { margin: "0", fontFamily: "var(--font-mono)", fontSize: "18px", fontWeight: "500", letterSpacing: "0.18em", color: "#ffb54d" });
  const title = document.createElement("h1");
  title.textContent = "Swarm";
  Object.assign(title.style, { margin: "0", fontSize: "132px", lineHeight: "0.86", fontWeight: "900", letterSpacing: "-0.055em" });
  const line = document.createElement("p");
  line.textContent = "Inside an AI agent swarm, then what happens when one tries to leave the box.";
  Object.assign(line.style, { margin: "0", maxWidth: "30ch", fontSize: "26px", lineHeight: "1.35", color: "#c3cad6" });
  wrap.append(eyebrow, title, line);
  document.body.append(wrap);
}

const server = startDevServer(PORT, "start");
let exitCode = 1;
try {
  await waitForServer(BASE);
  const { buf, quality } = await capture({
    url,
    act: ACT,
    context: { viewport: SIZE, deviceScaleFactor: 1 },
    async ready(page) {
      await page.waitForFunction((act) => window.__swarm?.[act]?.settled === true, ACT, { timeout: 120_000 });
      if (ACT === "box") await page.waitForSelector('[data-plot-ready="true"]', { timeout: 120_000 });
      // The loader fades over 1.2 s once the engine is up.
      await page.waitForTimeout(1600);
    },
    async shoot(page) {
      if (ACT === "box") {
        // The Box's HUD is the page; the card shows the scene alone, so the controls go.
        await page.addStyleTag({ content: "[data-plot-ready] { visibility: hidden !important; } [data-scene-slot] { visibility: visible !important; }" });
      }
      await page.evaluate(overlayTitle);
      await page.evaluate(() => document.fonts.ready);
      return jpegUnder((opts) => page.screenshot(opts), MAX_BYTES);
    },
  });
  await writeFile(OUT, buf);
  console.log(`  ${url}`);
  console.log(`  saved ${path.relative(ROOT, OUT)}: ${SIZE.width}x${SIZE.height}, ${(buf.length / 1024).toFixed(0)} KB at quality ${quality}`);
  exitCode = 0;
} catch (err) {
  console.error(err.message);
} finally {
  stopDevServer(server);
}
process.exit(exitCode);
