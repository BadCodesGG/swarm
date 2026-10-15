/**
 * Layout sweep of Act 2, The Box, against a running production build:
 *
 *   node scripts/sweep-box.mjs [--base=http://localhost:3140] [--only=dense|states]
 *
 * It starts and stops nothing but its own Chromium, launched with classic scrollbars (Playwright hides them by
 * default, and a scrollbar is 15 to 17 px the layout has to fit in). Two kinds of pass:
 *
 * - The states, at each width in WIDTHS: `/box?shot=breakout` live (every step marker out), rewound (the scrubber
 *   past the first breach), and after a fork (Branch from here, Watch the branch), and `/box?view=results` once
 *   "Run 100 trials" has plotted points; at 390, 915 and 1440 also a genuinely live `/box`, waited for its breaches.
 * - The dense scan: one loaded `/box?shot=breakout` page per state (live, rewound, Defend mode), resized from 320 to
 *   1520 in 8 px steps plus the layout's exact edges, at the states' heights and again at 650 px so the HUD root
 *   scrolls, with the cheap invariants (1, 2, 3, 8) checked at every step after the layout settles. A band between
 *   two of the states' widths cannot pass unseen.
 *
 * Every state is measured against the same invariants:
 *
 *   1. no horizontal overflow: the HUD root (the element that scrolls, not the document) is no wider than its client
 *      box, and the top bar, the grid and each column end inside it
 *   2. the timeline toolbar: one row on a desktop (>= 915), no control over another on a phone (<= 914, where the
 *      compact timeline's two rows carry the attribute)
 *   3. the top bar: on a desktop (>= 915) at most two rows, no row holds only icon buttons, and no control over
 *      another; on a phone (<= 914) the four rows the PhoneWatch board approved, in order (wordmark with the icon
 *      buttons; the caveat; scenario and modes; the counters), and no row runs past the bar's edge; and Tab through
 *      it never moves focus to an earlier row, or leftwards within a row
 *   4. every lab ring, lab label and step marker wholly inside the scene, no label over another
 *      (`measureScene`; the rings check is skipped on a desktop close-up beat)
 *   5. the trials plot: no two texts overlap, none clipped by its svg or the "100 trials per setup" card, and no
 *      leader line crosses a text other than the name it leads to
 *   6. button text: "Branch from here" / "Branch", no button whose visible text runs words together, and
 *      where a button's label is split across child elements the words still read with a gap on screen
 *      (a flex button drops the space between its text and a child span: "Branchfrom here")
 *   7. no console errors, THREE warnings or page errors
 *   8. one line each: the toolbar's buttons and labels, the top bar's counters, the Defend card's big readouts
 *
 * A probe whose element is missing is a FAIL naming it, never a silent skip. Prints `PASS ...` or
 * `FAIL <width> <route> <state>: <invariant> (<detail>)` per invariant (the dense scan prints its passes as one
 * line per pass), collects every failure, then a summary; exits 1 if any failed.
 */

import { chromium } from "playwright";
import { measureScene } from "./lib/scene-labels.mjs";

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "http://localhost:3140").replace(/\/$/, "");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice("--only=".length) : "";
const WIDTHS = [320, 360, 390, 480, 600, 768, 915, 1024, 1100, 1200, 1280, 1366, 1399, 1431, 1440];
const LIVE_WIDTHS = [390, 915, 1440];
/** The dense scan's widths: every 8 px, plus the edges of the layout's own breakpoints and the one-row top bar. */
const DENSE_WIDTHS = [...new Set([...Array.from({ length: (1520 - 320) / 8 + 1 }, (_, i) => 320 + i * 8), 914, 915, 1099, 1100, 1119, 1120, 1399, 1400, 1431, 1432, 1440])].sort((a, b) => a - b);
const SHORT_HEIGHT = 650;
const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer", "--use-angle=d3d11", "--ignore-gpu-blocklist"];
const READY_MS = 60_000;
const LIVE_BREACH_MS = 150_000;
const TRIALS_MS = 120_000;

const heightFor = (w) => (w >= 915 ? 900 : w <= 480 ? 844 : 1024);

let passes = 0;
const failures = [];
let ctx = { width: 0, route: "", state: "" };
/** While set, a pass is counted but not printed (the dense scan prints one line per pass instead). */
let quiet = false;
const record = (name, ok, detail = "") => {
  const line = `${ctx.width} ${ctx.route} ${ctx.state}: ${name}${detail ? ` (${detail})` : ""}`;
  if (ok) {
    passes++;
    if (!quiet) console.log(`PASS ${line}`);
  } else {
    failures.push(line);
    console.log(`FAIL ${line}`);
  }
};

const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();

// ---------- invariant probes (all run in the page) ----------

/** 1 */
async function checkOverflow(page) {
  const o = await page.evaluate(() => {
    const root = document.querySelector("[data-plot-ready]");
    if (!root) return null;
    const rr = root.getBoundingClientRect();
    const right = rr.left + root.clientLeft + root.clientWidth;
    const T = 0.5;
    const over = [];
    const edge = (name, el) => {
      if (!el || el.getClientRects().length === 0) return;
      const r = el.getBoundingClientRect();
      if (r.right > right + T) over.push(`${name} ends ${(r.right - right).toFixed(1)} px past the root`);
      if (r.left < rr.left - T) over.push(`${name} starts ${(rr.left - r.left).toFixed(1)} px before the root`);
    };
    const header = [...document.querySelectorAll("[data-box-header]")].find((h) => h.getClientRects().length > 0);
    edge("top bar", header);
    const grid = header?.nextElementSibling;
    edge("grid", grid);
    if (grid) {
      [...grid.children].forEach((c, i) => edge(`column ${i + 1}`, c));
      // The columns' minimums have to fit the grid's content box: tracks that run into its right padding are the
      // first sign of a floor the root (less its scrollbar) cannot hold.
      const gr = grid.getBoundingClientRect();
      const inner = gr.right - parseFloat(getComputedStyle(grid).paddingRight);
      const last = Math.max(...[...grid.children].filter((c) => c.getClientRects().length > 0).map((c) => c.getBoundingClientRect().right));
      if (last > inner + T) over.push(`the columns run ${(last - inner).toFixed(1)} px into the grid's right padding`);
    }
    const results = document.querySelector("[data-results-view]");
    if (results && results.getClientRects().length > 0) edge("results", results);
    return { sw: root.scrollWidth, cw: root.clientWidth, bar: root.offsetWidth - root.clientWidth, scrolls: root.scrollHeight > root.clientHeight, over };
  });
  if (!o) {
    record("1 no horizontal overflow", false, "no HUD root [data-plot-ready]");
    return null;
  }
  record("1 no horizontal overflow of the HUD root", o.sw <= o.cw, `scrollWidth ${o.sw}, clientWidth ${o.cw}, scrollbar ${o.bar} px`);
  record("1 the top bar, grid and columns end inside the root's client box", o.over.length === 0, o.over.join("; ") || `scrollbar ${o.bar} px`);
  return o;
}

/** 2 */
async function checkToolbar(page, width) {
  const bars = await page.evaluate(() => {
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll("[data-timeline-bar]")]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) =>
        [...el.children]
          .filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().width > 0)
          .map((e) => {
            const r = e.getBoundingClientRect();
            return { text: norm(e.textContent || e.getAttribute("aria-label") || "").slice(0, 18), left: r.left, right: r.right, top: r.top, bottom: r.bottom, cy: r.top + r.height / 2 };
          }),
      );
  });
  if (!bars.length) {
    record("2 the timeline toolbar is on the page", false, "no visible [data-timeline-bar]");
    return;
  }
  if (width >= 915) {
    const bar = bars[0];
    const spread = Math.max(...bar.map((e) => e.cy)) - Math.min(...bar.map((e) => e.cy));
    const topSpread = Math.max(...bar.map((e) => e.top)) - Math.min(...bar.map((e) => e.top));
    record("2 timeline toolbar controls share one row", spread <= 2, `centres within ${spread.toFixed(1)} px, tops within ${topSpread.toFixed(1)} px; ${bar.map((e) => `${e.text} @${Math.round(e.cy)}`).join(", ")}`);
  } else {
    const clash = [];
    for (const bar of bars) {
      bar.forEach((a, i) => {
        for (const b of bar.slice(i + 1)) if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) clash.push(`"${a.text}" / "${b.text}"`);
      });
    }
    record("2 no timeline toolbar control overlaps another", clash.length === 0, clash.join(", ") || `${bars.length} rows, ${bars.reduce((n, b) => n + b.length, 0)} controls`);
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
        items.push({ name: gt.slice(0, 18), button: false, iconOnly: false, cy: gr.top + gr.height / 2, h: gr.height, left: gr.left, right: gr.right, top: gr.top, bottom: gr.bottom });
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
        top: r.top,
        bottom: r.bottom,
      });
    }
    // No control over another (a wrapped row landing on the one above, say).
    const controls = items.filter((i) => i.button);
    const clash = [];
    controls.forEach((a, i) => {
      for (const b of controls.slice(i + 1)) if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) clash.push(`"${a.name}" / "${b.name}"`);
    });
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
    // The distance between two rows' nearest edges: one gap, not a gap either side of an empty line.
    const gaps = rows.slice(1).map((r, i) => Math.min(...r.items.map((b) => b.top)) - Math.max(...rows[i].items.map((a) => a.bottom)));
    return {
      clash,
      gaps,
      rows: rows.map((r) => ({
        names: r.items.map((i) => (i.iconOnly ? `[icon ${i.name}]` : i.name)),
        iconOnly: r.items.every((i) => i.button && i.iconOnly),
        icons: r.items.filter((i) => i.iconOnly).length,
        // How far the row runs past the bar's own box (its padding included), in px.
        over: Math.max(0, ...r.items.map((i) => Math.max(hr.left - i.left, i.right - hr.right))),
      })),
    };
  });
  if (!res) {
    record("3 the top bar is on the page", false, "no visible [data-box-header]");
    return;
  }
  const { rows, clash, gaps } = res;
  const desc = rows.map((r, i) => `row${i + 1}: ${r.names.join(" | ")}`).join(" ; ");
  record("3 no top bar control overlaps another", clash.length === 0, clash.join(", ") || `${rows.length} rows`);
  if (width >= 915) {
    record("3 top bar is at most two rows", rows.length <= 2, `${rows.length} rows; ${desc}`);
    record("3 no top bar row holds only icon buttons", !rows.some((r) => r.iconOnly), rows.filter((r) => r.iconOnly).map((r) => r.names.join(" | ")).join(" ; ") || desc);
    // Two rows sit one gap (10 px) apart, allowing for a taller control's half-height above and below its row's centre.
    record("3 the top bar's two rows read one gap apart, not two", gaps.every((g) => g <= 16), `${gaps.map((g) => g.toFixed(1)).join(", ") || "one row"} px between rows`);
    return;
  }
  // The phone's four rows, as the PhoneWatch board approved them; under 360 px the scenario and the modes may take a row each.
  const has = (row, re) => row && row.names.some((n) => re.test(n));
  const head = rows.length >= 4 && has(rows[0], /THE BOX/) && rows[0].icons >= 1 && has(rows[1], /Abstract agents/) && has(rows[2], /SCENARIO/) && !has(rows[2], /caught/i);
  const order = head && (rows.length === 4 ? has(rows[2], /^Watch$/) && has(rows[3], /caught/i) : width < 360 && rows.length === 5 && has(rows[3], /^Watch$/) && !has(rows[3], /caught/i) && has(rows[4], /caught/i));
  record("3 phone top bar is four rows: wordmark and icons, caveat, scenario and modes, counters", order, `${rows.length} rows; ${desc}`);
  const over = rows.filter((r) => r.over > 0.5);
  record("3 no phone top bar row runs past the bar's edge", over.length === 0, over.map((r) => `${r.names.join(" | ")} by ${r.over.toFixed(1)} px`).join(" ; ") || desc);
}

/** 3, focus: Tab through the top bar and watch where focus lands, row by row. */
async function checkFocusOrder(page) {
  const first = await page.evaluate(() => {
    const header = [...document.querySelectorAll("[data-box-header]")].find((h) => h.getClientRects().length > 0);
    if (!header) return null;
    const focusable = [...header.querySelectorAll("a[href], button:not([disabled]), select, input, summary, [tabindex]:not([tabindex='-1'])")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== "hidden";
    });
    if (!focusable.length) return null;
    focusable[0].focus({ preventScroll: true });
    return focusable.length;
  });
  if (first === null) {
    record("3 the top bar has focusable controls", false, "no visible [data-box-header] with a focusable control");
    return;
  }
  const where = () =>
    page.evaluate(() => {
      const header = [...document.querySelectorAll("[data-box-header]")].find((h) => h.getClientRects().length > 0);
      const a = document.activeElement;
      if (!a || !header?.contains(a)) return null;
      const r = a.getBoundingClientRect();
      const text = (a.innerText ?? a.textContent ?? "").replace(/\s+/g, " ").trim();
      return { name: (text || a.getAttribute("aria-label") || a.getAttribute("title") || a.tagName.toLowerCase()).slice(0, 18), left: r.left, cy: r.top + r.height / 2, h: r.height };
    });
  const path = [];
  let at = await where();
  for (let i = 0; at && i < first + 4; i++) {
    path.push(at);
    await page.keyboard.press("Tab");
    at = await where();
  }
  const back = [];
  for (let i = 1; i < path.length; i++) {
    const p = path[i - 1];
    const n = path[i];
    const sameRow = Math.abs(n.cy - p.cy) <= Math.max(8, Math.min(p.h, n.h) / 2);
    if (sameRow ? n.left < p.left - 1 : n.cy < p.cy) back.push(`"${p.name}" (${Math.round(p.left)}, ${Math.round(p.cy)}) then "${n.name}" (${Math.round(n.left)}, ${Math.round(n.cy)})`);
  }
  record("3 Tab through the top bar never goes back to an earlier row or leftwards in one", path.length >= 2 && back.length === 0, back.join(" ; ") || path.map((p) => `${p.name} @${Math.round(p.left)},${Math.round(p.cy)}`).join(" > "));
  // Focus leaves the top bar so the next probe's page is as it was.
  await page.evaluate(() => document.activeElement?.blur());
}

/** 4 */
async function checkScene(page, width) {
  const scene = await measureScene(page);
  if (!scene.slot) {
    record("4 the scene is on the page", false, "no [data-scene-slot]");
    return;
  }
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
    const card = svg.closest('section[aria-label="100 trials per setup"]');
    if (!card) return { noCard: true };
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
    // Leader lines, as drawn: each from its dot to its name, in page px through the svg's own transform.
    const ctm = svg.getScreenCTM();
    const toPage = (x, y) => {
      const p = new DOMPoint(x, y).matrixTransform(ctm);
      return { x: p.x, y: p.y };
    };
    const num = (el, attr) => Number(el.getAttribute(attr));
    const leaders = [...svg.querySelectorAll("line[data-plot-leader]")].map((l) => [toPage(num(l, "x1"), num(l, "y1")), toPage(num(l, "x2"), num(l, "y2"))]);
    // Liang-Barsky, the box shrunk by S px: a leader that ends at its own name's edge touches that box, so the name a leader ends at is its own.
    const hits = (b, [a, c]) => {
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      let t0 = 0;
      let t1 = 1;
      for (const [p, q] of [
        [-dx, a.x - (b.left + S)],
        [dx, b.right - S - a.x],
        [-dy, a.y - (b.top + S)],
        [dy, b.bottom - S - a.y],
      ]) {
        if (p === 0) {
          if (q < 0) return false;
          continue;
        }
        const r = q / p;
        if (p < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
        if (t0 > t1) return false;
      }
      return true;
    };
    const near = (b, p) => p.x >= b.left - 4 && p.x <= b.right + 4 && p.y >= b.top - 4 && p.y <= b.bottom + 4;
    const crossed = [];
    leaders.forEach((seg, i) => {
      // The name the leader ends at is its own; every other text is off limits.
      const own = texts.filter((t) => near(t, seg[1]));
      for (const t of texts) if (!own.includes(t) && hits(t, seg)) crossed.push(`leader ${i + 1} (to ${own.map((o) => `"${o.text}"`).join("/") || "?"}) crosses "${t.text}"`);
    });
    return { n: texts.length, points: Number(svg.getAttribute("data-plot-points")), clash, clipped, leaders: leaders.length, crossed };
  });
  if (!res) {
    record("5 the trials plot is on the page", false, "no visible svg[data-plot-points]");
    return;
  }
  if (res.noCard) {
    record("5 the trials plot sits in the 100 trials per setup card", false, 'no section[aria-label="100 trials per setup"] round the plot');
    return;
  }
  record("5 no two plot texts overlap", res.clash.length === 0, res.clash.join(", ") || `${res.n} texts, ${res.points} points`);
  record("5 no plot text clipped by its svg or the 100 trials per setup card", res.clipped.length === 0, res.clipped.join(", ") || `${res.n} texts`);
  record("5 no leader line crosses another text", res.crossed.length === 0, res.crossed.join("; ") || `${res.leaders} leaders`);
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

/** 8: text that must sit on one line does. */
async function checkOneLine(page) {
  const res = await page.evaluate(() => {
    const lines = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      // Visually hidden text (sr-only) is a 1 px box; a line is a run of rects sharing a top.
      const tops = [];
      for (const r of range.getClientRects()) {
        if (r.width <= 1 || r.height <= 1) continue;
        if (!tops.some((t) => Math.abs(t - r.top) <= 2)) tops.push(r.top);
      }
      return tops.length;
    };
    const visible = (e) => e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden";
    const probes = [
      ["Defend readout", "[data-readout]"],
      ["toolbar control", "[data-timeline-bar] > button, [data-timeline-bar] > span"],
      ["counter", "[data-counter], dt:has(+ [data-counter])"],
    ];
    const wrapped = [];
    let n = 0;
    for (const [kind, sel] of probes) {
      for (const el of [...document.querySelectorAll(sel)].filter(visible)) {
        if (!(el.textContent ?? "").trim()) continue;
        n++;
        const count = lines(el);
        if (count > 1) wrapped.push(`${kind} "${(el.innerText ?? el.textContent).replace(/\s+/g, " ").trim().slice(0, 24)}" on ${count} lines`);
      }
    }
    return { n, wrapped };
  });
  record("8 the Defend readouts, toolbar controls and counters each sit on one line", res.wrapped.length === 0, res.wrapped.join("; ") || `${res.n} texts`);
}

/**
 * Waits until nothing scrolls: the HUD root and the window hold still for six frames running (a phone's step card
 * scrolls itself into view smoothly, and the map's text follows the scene a frame behind). Up to five seconds.
 */
const scrollStill = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const root = document.querySelector("[data-plot-ready]");
        const at = () => `${root?.scrollTop ?? 0},${window.scrollY}`;
        let last = at();
        let still = 0;
        const end = performance.now() + 5000;
        const tick = () => {
          const now = at();
          still = now === last ? still + 1 : 0;
          last = now;
          if (still >= 6 || performance.now() > end) resolve(still >= 6);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );

async function runInvariants(page, width, { map = true, results = false, topBar = true } = {}) {
  record("setup: the page stops scrolling before it is measured", await scrollStill(page), "still scrolling after 5 s");
  // One more frame, so the map's text has followed the last scroll.
  await settle(page);
  await checkOverflow(page);
  if (topBar) {
    await checkTopBar(page, width);
    await checkFocusOrder(page);
    await checkOneLine(page);
  }
  if (map) {
    await checkToolbar(page, width);
    await checkScene(page, width);
  }
  if (results) await checkPlot(page);
  await checkButtons(page);
}

// ---------- page plumbing ----------

async function open(browser, route, width, height = heightFor(width)) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
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

/** The page's layout after a resize: a few frames, so measured sizes (the timeline's track, the top bar's rows) have landed. */
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(0)))))));

const waitSettled = async (page) => {
  await page.waitForFunction(() => window.__swarm?.box?.settled === true, null, { timeout: READY_MS });
  await allMarkersOut(page, 30_000);
};

const scrubPastFirstBreach = async (page) => {
  const pinOne = await page.evaluate(() => window.__swarm.box.markers[0].tick);
  const head = Number(await page.locator("[data-scrubber-box]").first().getAttribute("max"));
  const target = Math.min(head - 1, pinOne + 30);
  await page.locator("[data-scrubber-box]").first().fill(String(target));
  await page.locator("[data-back-to-live]").first().waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction((t) => window.__swarm.box.stats.tick === t, target, { timeout: 10_000 });
  await page.waitForTimeout(800);
};

// ---------- the states of one width ----------

async function mapStates(browser, width) {
  ctx = { width, route: "/box?shot=breakout", state: "live" };
  const { context, page, problems } = await open(browser, "/box?shot=breakout", width);
  try {
    await step("shot settles with every step marker out", () => waitSettled(page));
    await page.waitForTimeout(700);
    await runInvariants(page, width);

    // Rewound: the scrubber, past the first breach (the pins all share a tick, so the scrubber it is).
    ctx.state = "rewound";
    const rewound = await step("scrub past the first breach so REWOUND and Back to live show", () => scrubPastFirstBreach(page));
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

/** The Results view with every preset plotted (the shot runs them all), then "Run 100 more" pooled into the current setup. */
const RESULTS_ROUTE = "/box?shot=breakout&view=results";

async function resultsState(browser, width) {
  ctx = { width, route: RESULTS_ROUTE, state: "after Run 100 more" };
  const { context, page, problems } = await open(browser, RESULTS_ROUTE, width);
  try {
    await step("results view opens with every preset plotted", async () => {
      await page.locator("[data-results-view]").waitFor({ state: "visible", timeout: READY_MS });
      await page.locator('[data-plot-ready="true"]').waitFor({ timeout: TRIALS_MS });
      const points = await page.evaluate(() => Number([...document.querySelectorAll("svg[data-plot-points]")].find((s) => s.getClientRects().length > 0)?.getAttribute("data-plot-points") ?? 0));
      if (points < 3) throw new Error(`only ${points} points plotted`);
    });
    await step("Run 100 more finishes", async () => {
      await page.locator("[data-run-more]:visible").first().click({ timeout: 10_000 });
      await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Running 100 trials/.test(b.textContent ?? "")), null, { timeout: 10_000 }).catch(() => {});
      // Not finished while the button still says it is running.
      await page.waitForFunction(() => ![...document.querySelectorAll("button")].some((b) => /Running 100 trials/.test(b.textContent ?? "")), null, { timeout: TRIALS_MS });
      await page.waitForTimeout(600);
    });
    // The Results view has its own header; the Box top bar is off the page here on purpose.
    await runInvariants(page, width, { map: false, results: true, topBar: false });
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

// ---------- the dense scan ----------

const DENSE_STATES = {
  live: async () => {},
  rewound: scrubPastFirstBreach,
  defend: async (page) => {
    await page.locator('[data-mode="defend"]:visible').first().click({ timeout: 5_000 });
    await page.locator("[data-defender-score]:visible").first().waitFor({ timeout: 10_000 });
    await page.waitForTimeout(400);
  },
};

/** The cheap invariants at every width, on one page per state, at the states' heights and again at SHORT_HEIGHT. */
async function denseScan(browser, stateName) {
  const start = DENSE_WIDTHS[DENSE_WIDTHS.length - 1];
  ctx = { width: start, route: "/box?shot=breakout", state: `dense ${stateName}` };
  const { context, page, problems } = await open(browser, "/box?shot=breakout", start);
  try {
    const ready = await step("shot settles with every step marker out", () => waitSettled(page));
    if (ready) await step(`the ${stateName} state is reached`, () => DENSE_STATES[stateName](page));
    for (const short of [false, true]) {
      const label = `dense ${stateName}${short ? ` h${SHORT_HEIGHT}` : ""}`;
      const before = passes;
      const failedBefore = failures.length;
      let sawScrollbar = null;
      quiet = true;
      for (const width of DENSE_WIDTHS) {
        ctx = { width, route: "/box?shot=breakout", state: label };
        await page.setViewportSize({ width, height: short ? SHORT_HEIGHT : heightFor(width) });
        await settle(page);
        const o = await checkOverflow(page);
        // Invariant 1 means something only when the scrollbar it allows for is real: the first scrolling step proves it.
        if (o && o.scrolls && sawScrollbar === null) sawScrollbar = { width, bar: o.bar };
        await checkTopBar(page, width);
        await checkToolbar(page, width);
        await checkOneLine(page);
        if (stateName === "defend" && width >= 915) {
          const readouts = await page.locator("[data-labs-kept]:visible [data-readout], [data-work-kept]:visible [data-readout]").count();
          record("8 the Defend card and its readouts are on the desktop page", readouts === 2, `${readouts} visible [data-readout] in [data-labs-kept] and [data-work-kept]`);
        }
      }
      quiet = false;
      ctx = { width: `${DENSE_WIDTHS[0]}-${start}`, route: "/box?shot=breakout", state: label };
      if (short) record("1 a classic scrollbar takes width on a scrolling root", sawScrollbar !== null && sawScrollbar.bar > 0, sawScrollbar ? `${sawScrollbar.bar} px at ${sawScrollbar.width}` : "the root never scrolled");
      console.log(`PASS ${ctx.width} ${ctx.route} ${label}: ${passes - before} checks at ${DENSE_WIDTHS.length} widths, ${failures.length - failedBefore} failed`);
    }
    // Tab order, once per state at a few widths (it moves focus, so it is not run at every step).
    for (const width of [320, 390, 914, 915, 1100, 1200, 1398, 1416, 1440, 1520]) {
      ctx = { width, route: "/box?shot=breakout", state: `dense ${stateName}` };
      await page.setViewportSize({ width, height: heightFor(width) });
      await settle(page);
      await checkFocusOrder(page);
    }
    await flushProblems(problems);
  } finally {
    await context.close();
  }
}

// ---------- main ----------

const started = Date.now();
// Playwright hides scrollbars by default; the layout has to fit beside a classic one.
const browser = await chromium.launch({ headless: true, channel: "chromium", args: GPU_ARGS, ignoreDefaultArgs: ["--hide-scrollbars"] });
try {
  if (ONLY !== "states") {
    for (const stateName of Object.keys(DENSE_STATES)) {
      try {
        await denseScan(browser, stateName);
      } catch (err) {
        record(`setup: dense ${stateName} crashed`, false, norm(String(err.message).split("\n")[0]).slice(0, 160));
      }
    }
  }
  if (ONLY !== "dense") {
    for (const width of WIDTHS) {
      for (const run of [mapStates, resultsState, ...(LIVE_WIDTHS.includes(width) ? [genuineLive] : [])]) {
        try {
          await run(browser, width);
        } catch (err) {
          record(`setup: ${run.name} crashed`, false, norm(String(err.message).split("\n")[0]).slice(0, 160));
        }
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
