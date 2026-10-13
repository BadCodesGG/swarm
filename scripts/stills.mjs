/**
 * Makes the reduced-motion stills, `public/stills/inside.jpg` and `public/stills/box.jpg`, from the
 * production build. `experience.tsx` shows them in its `still` and `unsupported` states.
 *
 *   npm run build && node scripts/stills.mjs [--only=inside|box] [--port=3130]
 *
 * Inside: the hero frame without the HUD (`/inside?shot=hero&source=medium&hud=0`, the frame
 * shot.mjs takes) at 1440x900, filling the screen behind the still's caption.
 *
 * The Box: the escape (`/box?shot=escape`, as shot-box.mjs) cropped to the scene slot alone. Under
 * reduced motion the Box keeps its live HUD and draws this image into the slot with the 760x560
 * design frame fitted as the live camera fits it, so the crop is taken at a width where the slot
 * has exactly that aspect (below 1158 px) and with the slot's DOM labels hidden: the live HUD
 * draws its own over the still.
 *
 * Fails on any console error or `THREE.` warning, or when no launch strategy draws with WebGPU.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { capture, jpegUnder } from "./lib/capture.mjs";
import { ROOT, startDevServer, stopDevServer, waitForServer } from "./lib/dev-server.mjs";

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PORT = Number(value("port", 3130));
const BASE = `http://localhost:${PORT}`;
const ONLY = value("only", null);
const DIR = path.join(ROOT, "public", "stills");
const MAX_BYTES = 400 * 1024;

const settle = (act) => async (page) => {
  await page.waitForFunction((name) => window.__swarm?.[name]?.settled === true, act, { timeout: 120_000 });
  // The loader fades over 1.2 s once the engine is up.
  await page.waitForTimeout(1600);
};

const STILLS = [
  {
    name: "inside",
    act: "inside",
    url: `${BASE}/inside?shot=hero&source=medium&hud=0`,
    context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    ready: settle("inside"),
    shoot: (page) => jpegUnder((opts) => page.screenshot(opts), MAX_BYTES),
  },
  {
    name: "box",
    act: "box",
    url: `${BASE}/box?shot=escape`,
    // Below the 1158 px breakpoint the slot keeps the design's 760:560; DPR 2 keeps it sharp on retina.
    context: { viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 2 },
    ready: settle("box"),
    async shoot(page) {
      await page.addStyleTag({ content: "[data-scene-slot] > * { visibility: hidden !important; }" });
      const slot = await page.locator("[data-scene-slot]").boundingBox();
      if (!slot) throw new Error("no [data-scene-slot] on the page");
      const aspect = slot.width / slot.height;
      if (Math.abs(aspect - 760 / 560) > 0.01) throw new Error(`scene slot is ${slot.width}x${slot.height}, not 760:560`);
      return jpegUnder((opts) => page.screenshot({ ...opts, clip: slot }), MAX_BYTES);
    },
  },
].filter((s) => !ONLY || s.name === ONLY);

const server = startDevServer(PORT, "start");
let exitCode = 1;
try {
  await waitForServer(BASE);
  await mkdir(DIR, { recursive: true });
  for (const still of STILLS) {
    console.log(`-- ${still.name}: ${still.url}`);
    const { buf, quality } = await capture(still);
    const out = path.join(DIR, `${still.name}.jpg`);
    await writeFile(out, buf);
    console.log(`  saved ${path.relative(ROOT, out)}: ${(buf.length / 1024).toFixed(0)} KB at quality ${quality}`);
  }
  exitCode = 0;
} catch (err) {
  console.error(err.message);
} finally {
  stopDevServer(server);
}
process.exit(exitCode);
