/**
 * Zoomed crops of a screenshot, for checking grain by eye: a square of `--size` CSS px around
 * `--x,--y` blown up `--zoom` times with no smoothing (every pixel a visible block).
 *
 *   node scripts/crop.mjs --in=.shots/nebula-11.png --x=720 --y=405 [--size=160] [--zoom=4] [--out=.shots/crops/nebula-11-focus.png]
 */

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT } from "./lib/dev-server.mjs";

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const input = path.resolve(ROOT, value("in", ""));
const x = Number(value("x", 720));
const y = Number(value("y", 450));
const size = Number(value("size", 160));
const zoom = Number(value("zoom", 4));
const out = path.resolve(ROOT, value("out", path.join(".shots", "crops", `${path.basename(input, ".png")}-${x}x${y}.png`)));
if (!input.endsWith(".png")) {
  console.error("--in=<png> is required");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: size * zoom, height: size * zoom }, deviceScaleFactor: 1 });
  const left = Math.round(x - size / 2);
  const top = Math.round(y - size / 2);
  // Inlined: a page set from a string cannot load a file:// image.
  const src = `data:image/png;base64,${(await readFile(input)).toString("base64")}`;
  await page.setContent(
    `<body style="margin:0;background:#000;overflow:hidden"><img src="${src}" ` +
      `style="position:absolute;left:${-left * zoom}px;top:${-top * zoom}px;transform-origin:0 0;transform:scale(${zoom});image-rendering:pixelated"></body>`,
  );
  await page.waitForFunction(() => document.images[0]?.complete);
  await mkdir(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(`saved ${path.relative(ROOT, out)} (${size}x${size} px around ${x},${y} at ${zoom}x)`);
} finally {
  await browser.close();
}
