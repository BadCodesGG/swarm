/**
 * Layout sweep of Act 2, The Box, against a running production build:
 *
 *   node scripts/sweep-box.mjs [--base=http://localhost:3140]
 *
 * It starts and stops nothing but its own Chromium. At each width in WIDTHS it opens `/box?shot=breakout`
 * live (every step marker out), rewound (the scrubber past the first breach), and after a fork (Branch
 * from here, Watch the branch), and `/box?view=results` once "Run 100 trials" has plotted points; at
 * 390, 915 and 1440 it also opens a genuinely live `/box` and waits for its breaches. Every state is
 * measured against the same invariants:
 *
 *   1. no horizontal page overflow
 *   2. the timeline toolbar: one row on a desktop (>= 915), no control over another below it
 *   3. the top bar: on a desktop (>= 915) at most two rows and no row holds only icon buttons; on a phone
 *      (<= 914) the four rows the PhoneWatch board approved, in order (wordmark with the icon buttons;
 *      the caveat; scenario and modes; the counters), and no row runs past the bar's edge
 *   4. every lab ring, lab label and step marker wholly inside the scene, no label over another
 *      (`measureScene`; the rings check is skipped on a desktop close-up beat)
 *   5. the trials plot: no two texts overlap, none clipped by its svg or its card
 *   6. button text: "Branch from here" / "Branch", no button whose visible text runs words together, and
 *      where a button's label is split across child elements the words still read with a gap on screen
 *      (a flex button drops the space between its text and a child span: "Branchfrom here")
 *   7. no console errors, THREE warnings or page errors
 *
 * Prints `PASS ...` or `FAIL <width> <route> <state>: <invariant> (<detail>)` per invariant, collects every
 * failure, then a summary; exits 1 if any failed.
 */

import { chromium } from "playwright";
import { measureScene } from "./lib/scene-labels.mjs";

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "http://localhost:3140").replace(/\/$/, "");
const WIDTHS = [390, 480, 600, 768, 915, 1024, 1100, 1200, 1280, 1366, 1440];
const LIVE_WIDTHS = [390, 915, 1440];
const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer", "--use-angle=d3d11", "--ignore-gpu-blocklist"];
const READY_MS = 60_000;
const LIVE_BREACH_MS = 150_000;
const TRIALS_MS = 120_000;

const heightFor = (w) => (w >= 915 ? 900 : w <= 480 ? 844 : 1024);

let passes = 0;
const failures = [];
let ctx = { width: 0, route: "", state: "" };
const record = (name, ok, detail = "") => {
  const line = `${ctx.width} ${ctx.route} ${ctx.state}: ${name}${detail ? ` (${detail})` : ""}`;
  if (ok) {
    passes++;
    console.log(`PASS ${line}`);
  } else {
    failures.push(line);
    console.log(`FAIL ${line}`);
  }
};

const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();

// ---------- invariant probes (all run in the page) ----------

/** 1 */
async function checkOverflow(page) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: window.innerWidth }));
  record("1 no horizontal page overflow", Math.max(o.sw, o.bw) <= o.iw, `scrollWidth ${o.sw}, body ${o.bw}, innerWidth ${o.iw}`);
}

/** 2 */
async function checkToolbar(page, width) {
  const bar = await page.evaluate(() => {
    const el = document.querySelector("[data-timeline-bar]");
    if (!el || el.getClientRects().length === 0) return null;
    return [...el.children]
      .filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().width > 0)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { text: norm(e.textContent || e.getAttribute("aria-label") || "").slice(0, 18), left: r.left, right: r.right, top: r.top, bottom: r.bottom, cy: r.top + r.height / 2 };
      });
    function norm(s) {
      return s.replace(/\s+/g, " ").trim();
    }
  });
  if (!bar) return; // no timeline bar in this view
  if (width >= 915) {
    const spread = Math.max(...bar.map((e) => e.cy)) - Math.min(...bar.map((e) => e.cy));
    const topSpread = Math.max(...bar.map((e) => e.top)) - Math.min(...bar.map((e) => e.top));
    record("2 timeline toolbar controls share one row", spread <= 2, `centres within ${spread.toFixed(1)} px, tops within ${topSpread.toFixed(1)} px; ${bar.map((e) => `${e.text} @${Math.round(e.cy)}`).join(", ")}`);
  } else {
    const clash = [];
    bar.forEach((a, i) => {
      for (const b of bar.slice(i + 1)) if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) clash.push(`"${a.text}" / "${b.text}"`);
    });
    record("2 no timeline toolbar control overlaps another", clash.length === 0, clash.join(", "));
  }
}

/** 3 */
async function checkTopBar(page, width) {
  const res = await page.evaluate(() => {
    const header = [...document.querySelectorAll("[data-box-header]")].find((h) => h.getClientRects().length > 0);
    if (!header) return null;
    const hr = header.getBoundingClientRect();
    const visible = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== "hidden";
    };
    const INTERACTIVE = "a, button, select, input, label, summary";
    const items = [];
    const seen = new Set();
    for (const e of header.querySelectorAll("*")) {
      if (e.closest("svg") && e.tagName.toLowerCase() !== "svg") continue;
      if (!visible(e)) continue;
      const inInteractive = e.parentElement?.closest(INTERACTIVE) && header.contains(e.parentElement.closest(INTERACTIVE));
      if (inInteractive) continue;
      const interactive = e.matches(INTERACTIVE);
      const leaf = e.children.length === 0 && (e.textContent ?? "").trim().length > 0;
      if (!interactive && !leaf) continue;
      // A counter is its label and value together, one item.
      const group = e.closest("div") && e.closest("div").querySelector(":scope > [data-counter]") ? e.closest("div") : null;
      if (group) {
        if (seen.has(group)) continue;
        seen.add(group);
        const gr = group.getBoundingClientRect();
        const gt = (group.innerText ?? "").replace(/\s+/g, " ").trim();
        items.push({ name: gt.slice(0, 18), button: false, iconOnly: false, cy: gr.top + gr.height / 2, h: gr.height, left: gr.left, right: gr.right });
        continue;
      }
      // An input inside a visible label is the label's.
      const r = e.getBoundingClientRect();
      const text = (e.innerText ?? e.textContent ?? "").replace(/\s+/g, " ").trim();
      const isButton = e.matches("button, a, [role=button], summary, select, input, label");
      items.push({
        name: (text || e.getAttribute("aria-label") || e.getAttribute("title") || e.tagName.toLowerCase()).slice(0, 18),
        button: isButton,
        iconOnly: isButton && !/[\p{L}\p{N}]/u.test(text),
        cy: r.top + r.height / 2,
        h: r.height,
        left: r.left,
        right: r.right,
      });
    }
    items.sort((a, b) => a.cy - b.cy);
    const rows = [];
    for (const it of items) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(it.cy - row.cy) <= Math.max(8, Math.min(row.h, it.h) / 2)) {
        row.items.push(it);
        row.cy = row.items.reduce((s, x) => s + x.cy, 0) / row.items.length;
        row.h = Math.max(row.h, it.h);
      } else rows.push({ cy: it.cy, h: it.h, items: [it] });
    }
    return rows.map((r) => ({
      names: r.items.map((i) => (i.iconOnly ? `[icon ${i.name}]` : i.name)),
      iconOnly: r.items.every((i) => i.button && i.iconOnly),
      icons: r.items.filter((i) => i.iconOnly).length,
      // How far the row runs past the bar's own box (its padding included), in px.
      over: Math.max(0, ...r.items.map((i) => Math.max(hr.left - i.left, i.right - hr.right))),
    }));
  });
  if (!res) return;
  const desc = res.map((r, i) => `row${i + 1}: ${r.names.join(" | ")}`).join(" ; ");
  if (width >= 915) {
    record("3 top bar is at most two rows", res.length <= 2, `${res.length} rows; ${desc}`);
    record("3 no top bar row holds only icon buttons", !res.some((r) => r.iconOnly), res.filter((r) => r.iconOnly).map((r) => r.names.join(" | ")).join(" ; ") || desc);
    return;
  }
  // The phone's four rows, as the PhoneWatch board approved them.
  const has = (row, re) => row && row.names.some((n) => re.test(n));
  const order =
    res.length === 4 && has(res[0], /SWARM/) && res[0].icons >= 1 && has(res[1], /Abstract agents/) && has(res[2], /^Watch$/) && !has(res[2], /caught/i) && has(res[3], /caught/i);
  record("3 phone top bar is four rows: wordmark and icons, caveat, scenario and modes, counters", order, `${res.length} rows; ${desc}`);
  const over = res.filter((r) => r.over > 0.5);
  record("3 no phone top bar row runs past the bar's edge", over.length === 0, over.map((r) => `${r.names.join(" | ")} by ${r.over.toFixed(1)} px`).join(" ; ") || desc);
}

/** 4 */
async function checkScene(page, width) {
  const scene = await measureScene(page);
  if (!scene.slot) return;
  const focus = await page.evaluate(() => window.__swarm?.box?.camera?.focus ?? null);
  record("4 no scene label or step marker overlaps another", scene.clashes.length === 0, scene.clashes.join(", "));
  record("4 every scene label and step marker is inside the scene", scene.cut.length === 0, scene.cut.join(", "));
  if (width >= 915 && focus) record("4 every lab ring inside the scene", true, `skipped: desktop close-up on ${focus}`);
  else record("4 every lab ring inside the scene", scene.labsCut.length === 0, scene.labsCut.join(", ") || `${scene.labs.length} labs`);
}

/** 5 */
async function checkPlot(page) {
  const res = await page.evaluate(() => {
    const svg = [...document.querySelectorAll("svg[data-plot-points]")].find((s) => s.getClientRects().length > 0);
    if (!svg) return null;
    const card = svg.closest("section") ?? svg.parentElement;
    const sr = svg.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const texts = [...svg.querySelectorAll("text")]
      .filter((t) => (t.textContent ?? "").trim().length > 0)
      .map((t) => {
        const r = t.getBoundingClientRect();
        return { text: (t.textContent ?? "").trim(), left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      });
    // Glyph boxes are generous: shrink each by 0.5 px so text that merely touches is not an overlap.
    const S = 0.5;
    const clash = [];
    texts.forEach((a, i) => {
      for (const b of texts.slice(i + 1)) if (a.left + S < b.right - S && b.left + S < a.right - S && a.top + S < b.bottom - S && b.top + S < a.bottom - S) clash.push(`"${a.text}" / "${b.text}"`);
    });
    const T = 0.5;
    const clipped = texts
      .filter((t) => t.left < sr.left - T || t.right > sr.right + T || t.top < sr.top - T || t.bottom > sr.bottom + T || t.left < cr.left - T || t.right > cr.right + T || t.top < cr.top - T || t.bottom > cr.bottom + T)
      .map((t) => `"${t.text}"`);
    return { n: texts.length, points: Number(svg.getAttribute("data-plot-points")), clash, clipped };
  });
  if (!res) {
    record("5 the trials plot is on the page", false, "no visible svg[data-plot-points]");
    return;
  }
  record("5 no two plot texts overlap", res.clash.length === 0, res.clash.join(", ") || `${res.n} texts, ${res.points} points`);
  record("5 no plot text clipped by its svg or card", res.clipped.length === 0, res.clipped.join(", ") || `${res.n} texts`);
}

/** 6 */
async function checkButtons(page) {
  const res = await page.evaluate(() => {
    const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
    const visible = (e) => {
      const r = e.getBoundingClientRect();
      return e.getClientRects().length > 0 && r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
    };
    const buttons = [...document.querySelectorAll("button, [role=button], a[role=button]")].filter(visible);
    const branch = [...document.querySelectorAll("[data-branch-from-here]")].filter(visible).map((e) => e.innerText);
    const bad = [];
    for (const b of buttons) {
      const inner = b.innerText ?? "";
      const text = b.textContent ?? "";
      const a = norm(inner);
      const t = norm(text);
      const label = (a || t || b.getAttribute("aria-label") || b.tagName).slice(0, 40);
      const camel = /[a-z][A-Z]/.test(a);
      // The same characters but different spacing: a word run together on screen (or split) that the markup separates (or joins).
      const sameChars = a.replace(/\s/g, "") === t.replace(/\s/g, "");
      // Fewer word breaks on screen than the markup has: a word run together. (A break the markup lacks, as in a stacked label, is fine.)
      const spacingDiffers = sameChars && a.split(" ").length < t.split(" ").length;
      const known = /Branchfrom/i.test(a);
      if (known || spacingDiffers || camel) bad.push(`"${label}" innerText ${JSON.stringify(inner)} vs textContent ${JSON.stringify(text)}`);
    }
    // As drawn: where a label's words come from different child elements (text, then a span), the markup's space
    // between them has to show as a gap on the same line. innerText cannot tell: a flex button turns the span into
    // a flex item, drops its leading space and reports a line break that is not drawn.
    const gaps = [];
    const onScreen = (node) => {
      const r = node.parentElement?.getBoundingClientRect();
      return r && r.width > 2 && r.height > 2;
    };
    for (const b of buttons) {
      const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      const runs = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\S/.test(n.nodeValue) && onScreen(n)) runs.push(n);
      for (let i = 1; i < runs.length; i++) {
        const prev = runs[i - 1];
        const next = runs[i];
        if (prev.parentElement === next.parentElement) continue;
        const spaced = /\s$/.test(prev.nodeValue) || /^\s/.test(next.nodeValue);
        if (!spaced) continue;
        const last = prev.nodeValue.trimEnd().length;
        const first = next.nodeValue.length - next.nodeValue.trimStart().length;
        const ra = document.createRange();
        ra.setStart(prev, last - 1);
        ra.setEnd(prev, last);
        const rb = document.createRange();
        rb.setStart(next, first);
        rb.setEnd(next, first + 1);
        const a = ra.getBoundingClientRect();
        const c = rb.getBoundingClientRect();
        const sameLine = a.top < c.bottom && c.top < a.bottom;
        const gap = c.left - a.right;
        const words = `${prev.nodeValue.trim().split(/\s+/).pop()} ${next.nodeValue.trim().split(/\s+/)[0]}`;
        const label = norm(b.innerText).slice(0, 40);
        const branch = b.hasAttribute("data-branch-from-here");
        gaps.push({ label, words, sameLine, gap, branch, ok: branch ? sameLine && gap >= 2 : !sameLine || gap >= 2 });
      }
    }
    return { branch, bad, n: buttons.length, gaps };
  });
  for (const b of res.branch) {
    const n = norm(b);
    record("6 [data-branch-from-here] reads Branch from here or Branch", n === "Branch from here" || n === "Branch", `innerText ${JSON.stringify(b)}`);
  }
  record("6 no visible button runs words together", res.bad.length === 0, res.bad.join(" ; ") || `${res.n} buttons`);
  const badGaps = res.gaps.filter((g) => !g.ok);
  const describe = (g) => `"${g.label}": "${g.words}" ${g.sameLine ? `${g.gap.toFixed(1)} px apart` : "on different lines"}`;
  record("6 split button labels keep a gap of 2 px or more between their words on one line", badGaps.length === 0, badGaps.map(describe).join(" ; ") || res.gaps.map(describe).join(" ; ") || "no split labels");
}

async function runInvariants(page, width, { map = true, results = false } = {}) {
  await checkOverflow(page);
  await checkTopBar(page, width);
  if (map) {
    await checkToolbar(page, width);
    await checkScene(page, width);
  }
  if (results) await checkPlot(page);
  await checkButtons(page);
}

// ---------- page plumbing ----------

async function open(browser, route, width) {
  const context = await browser.newContext({ viewport: { width, height: heightFor(width) }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
    else if (m.text().includes("THREE.")) problems.push(`warning: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  const response = await page.goto(`${BASE}${route}`, { waitUntil: "load" });
  return { context, page, problems, response };
}

const allMarkersOut = (page, timeout) =>
  page.waitForFunction(
    () => {
      const m = window.__swarm?.box?.markers ?? [];
      const out = [...document.querySelectorAll("[data-step-marker]")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0).length;
      return m.length > 0 && m.every((x) => x.title) && out === m.length;
    },
    null,
    { timeout },
  );

/** Runs `fn`, recording a setup failure (and carrying on) if it throws. */
async function step(label, fn) {
  try {
    await fn();
    return true;
  } catch (err) {
    record(`setup: ${label}`, false, norm(String(err.message).split("\n")[0]).slice(0, 160));
    return false;
  }
}

async function flushProblems(problems) {
  record("7 no console errors, THREE warnings or page errors", problems.length === 0, problems.slice(0, 3).join(" | ").slice(0, 300));
  problems.length = 0;
}

// ---------- the states of one width ----------

async function mapStates(browser, width) {
  ctx = { width, route: "/box?shot=breakout", state: "live" };
  const { context, page, problems } = await open(browser, "/box?shot=breakout", width);
  try {
    await step("shot settles with every step marker out", async () => {
      await page.waitForFunction(() => window.__swarm?.box?.settled === true, null, { timeout: READY_MS });
      await allMarkersOut(page, 30_000);
    });
    await page.waitForTimeout(700);
    await runInvariants(page, width);

    // Rewound: the scrubber, past the first breach (the pins all share a tick, so the scrubber it is).
    ctx.state = "rewound";
    const rewound = await step("scrub past the first breach so REWOUND and Back to live show", async () => {
      const pinOne = await page.evaluate(() => window.__swarm.box.markers[0].tick);
      const head = Number(await page.locator("[data-scrubber-box]").first().getAttribute("max"));
      const target = Math.min(head - 1, pinOne + 30);
      await page.locator("[data-scrubber-box]").first().fill(String(target));
      await page.locator("[data-back-to-live]").first().waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForFunction((t) => window.__swarm.box.stats.tick === t, target, { timeout: 10_000 });
      await page.waitForTimeout(800);
    });
    if (rewound) {
      const rewoundTag = await page.evaluate(() => /REWOUND/i.test(document.body.innerText));
      record("state: REWOUND and Back to live are showing", rewoundTag && (await page.locator("[data-back-to-live]:visible").count()) > 0, rewoundTag ? "" : "no REWOUND text");
      await runInvariants(page, width);
    }

    // Fork: Branch from here, Watch the branch.
    ctx.state = "fork";
    const forked = await step("Branch from here, Watch the branch", async () => {
      await page.locator("[data-branch-from-here]:visible").first().click({ timeout: 5_000 });
      await page.locator("[data-results-view]").waitFor({ state: "visible", timeout: 10_000 });
      await page.locator("[data-watch-branch]:visible").first().click({ timeout: 10_000 });
      await page.locator("[data-branched-pill]").waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForTimeout(1200);
    });
    if (forked) await runInvariants(page, width);
    await flushProblems(problems);
  } finally {
    await context.close();
  }
}

async function resultsState(browser, width) {
  ctx = { width, route: "/box?view=results", state: "after Run 100 trials" };
  const { context, page, problems } = await open(browser, "/box?view=results", width);
  try {
    await step("results view opens", async () => {
      await page.waitForFunction(() => window.__swarm?.box?.frame > 5 || window.__swarm?.box?.settled === true || document.querySelector("[data-results-view]"), null, { timeout: READY_MS });
      await page.locator("[data-results-view]").waitFor({ state: "visible", timeout: 15_000 });
    });
    await step("Run 100 trials finishes with plotted points", async () => {
      const points = () => page.evaluate(() => Number([...document.querySelectorAll("svg[data-plot-points]")].find((s) => s.getClientRects().length > 0)?.getAttribute("data-plot-points") ?? 0));
      const before = await points();
      const run = page.locator("[data-run-trials]:visible, [data-run-more]:visible").first();
      await run.click({ timeout: 10_000 });
      await page.waitForFunction(
        (n) => Number([...document.querySelectorAll("svg[data-plot-points]")].find((s) => s.getClientRects().length > 0)?.getAttribute("data-plot-points") ?? 0) > n,
        before,
        { timeout: TRIALS_MS },
      );
      // Not finished while the button still says it is running.
      await page.waitForFunction(() => ![...document.querySelectorAll("button")].some((b) => /Running 100 trials/.test(b.textContent ?? "")), null, { timeout: TRIALS_MS });
      await page.waitForTimeout(600);
    });
    await runInvariants(page, width, { map: false, results: true });
    await flushProblems(problems);
  } finally {
    await context.close();
  }
}

async function genuineLive(browser, width) {
  ctx = { width, route: "/box", state: "genuinely live" };
  const { context, page, problems } = await open(browser, "/box", width);
  try {
    await step("the live run reaches its breaches (every step marker out)", async () => {
      await page.waitForFunction(() => (window.__swarm?.box?.frame ?? 0) > 10, null, { timeout: READY_MS });
      await allMarkersOut(page, LIVE_BREACH_MS);
    });
    await page.waitForTimeout(700);
    await runInvariants(page, width);
    await flushProblems(problems);
  } finally {
    await context.close();
  }
}

// ---------- main ----------

const started = Date.now();
const browser = await chromium.launch({ headless: true, channel: "chromium", args: GPU_ARGS });
try {
  for (const width of WIDTHS) {
    for (const run of [mapStates, resultsState, ...(LIVE_WIDTHS.includes(width) ? [genuineLive] : [])]) {
      try {
        await run(browser, width);
      } catch (err) {
        record(`setup: ${run.name} crashed`, false, norm(String(err.message).split("\n")[0]).slice(0, 160));
      }
    }
  }
} finally {
  await browser.close();
}
const secs = ((Date.now() - started) / 1000).toFixed(0);
console.log(`\n${failures.length === 0 ? "ALL PASS" : "FAILURES"}: ${passes} PASS, ${failures.length} FAIL in ${secs} s`);
if (failures.length > 0) {
  console.log("\nFAIL list:");
  for (const f of failures) console.log(`FAIL ${f}`);
}
process.exit(failures.length === 0 ? 0 : 1);
