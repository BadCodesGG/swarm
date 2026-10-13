import { describe, expect, it } from "vitest";
import { createState, rogueCount } from "@/lib/box/sim";
import { DEFAULT_CONFIG, type BoxConfig } from "@/lib/box/types";
import { escapePath, homes, ringPoint, toDesign } from "./layout";
import { FRAME_BOX, layoutLabels, overlaps, rectOf, segmentHits, type LabelLayout, type Rect } from "./labels";
import { parseBoxParams, runToEscape, SHOT_ESCAPE, simRng } from "./params";
import { createTally, record, type EscapeRecord, type Marker, type Tally } from "./tally";

const SHOT = parseBoxParams(new URLSearchParams("shot=escape")).config;
/** The design's desktop text, and the phone's (a 390 px wide scene grows text by about 1.6). */
const SCALES = [1, 1.6] as const;

/** The `?shot=escape` frame for a seed: the tally on the tick of the first escape. */
function shotFrame(seed: number): Tally {
  const count = SHOT_ESCAPE.agents;
  const state = createState(SHOT, seed, count);
  const tally = createTally(count, rogueCount(SHOT, count));
  const home = homes(count, seed);
  const ctx = { config: SHOT, plan: (i: number) => state.plans[i] ?? [], home: (i: number) => ({ x: home[i * 2], y: home[i * 2 + 1] }) };
  runToEscape(state, simRng(seed), 3000, (r) => record(tally, r, ctx));
  return tally;
}

/** Every drawn label's box, by name. */
function boxes(layout: LabelLayout): [string, Rect][] {
  return [
    ...layout.rings.map((l): [string, Rect] => [`ring ${l.layer}`, rectOf(l)]),
    ...layout.markers.map((l): [string, Rect] => [`marker ${l.marker.id} "${l.text}"`, rectOf(l)]),
    ...layout.notes.map((l): [string, Rect] => [`note ${l.layer} "${l.text}"`, rectOf(l)]),
  ];
}

/** How far a box's nearest edge is from a point, design px. */
const gapTo = (r: Rect, p: { x: number; y: number }) => Math.hypot(Math.max(r.x0 - p.x, 0, p.x - r.x1), Math.max(r.y0 - p.y, 0, p.y - r.y1));

/** Every way a layout breaks the rule: label on label, label on the trail, label out of the frame, a note adrift from its mark. */
function clashes(layout: LabelLayout, escape: EscapeRecord | null): string[] {
  const out: string[] = [];
  const all = boxes(layout);
  for (const m of layout.markers) {
    const gap = gapTo(rectOf(m), toDesign(m.marker.x, m.marker.y));
    if (gap > 22 * (m.fontSize / 10.5)) out.push(`marker ${m.marker.id} "${m.text}" sits ${Math.round(gap)} px from its mark`);
  }
  all.forEach(([a, ra], i) => {
    // Ring labels keep the design's fixed spots; the placed ones must stay in the frame.
    const off = ra.x0 < FRAME_BOX.x0 || ra.y0 < FRAME_BOX.y0 || ra.x1 > FRAME_BOX.x1 || ra.y1 > FRAME_BOX.y1;
    if (off && !a.startsWith("ring")) out.push(`${a} leaves the frame`);
    for (const [b, rb] of all.slice(i + 1)) if (overlaps(ra, rb)) out.push(`${a} overlaps ${b}`);
    if (escape && !a.startsWith("ring") && segmentHits(ra, toDesign(escape.path.start.x, escape.path.start.y), toDesign(escape.path.end.x, escape.path.end.y))) {
      out.push(`${a} sits on the trail`);
    }
  });
  return out;
}

describe("label geometry", () => {
  it("sizes monospace text by its characters", () => {
    const r = rectOf({ text: "0.55", lines: ["0.55"], x: 100, y: 50, anchor: "start", fontSize: 10, letterSpacing: 0 });
    expect(r.x0).toBeCloseTo(100 - 2);
    expect(r.x1).toBeCloseTo(100 + 24 + 2);
    expect(r.y1).toBeGreaterThan(50);
    expect(r.y0).toBeLessThan(50 - 6);
  });

  it("tells a box the trail crosses from one it misses", () => {
    const box = { x0: 10, y0: 10, x1: 30, y1: 20 };
    expect(segmentHits(box, { x: 0, y: 15 }, { x: 40, y: 15 })).toBe(true);
    expect(segmentHits(box, { x: 0, y: 30 }, { x: 40, y: 30 })).toBe(false);
    expect(overlaps(box, { x0: 29, y0: 19, x1: 40, y1: 40 })).toBe(true);
    expect(overlaps(box, { x0: 31, y0: 0, x1: 40, y1: 40 })).toBe(false);
  });
});

describe("layoutLabels", () => {
  const trailEscape = (startX: number, heading: number): EscapeRecord => ({
    agent: 1,
    tick: 10,
    plan: [],
    steps: [],
    trail: { monitor: "0.55", audit: "not sampled" },
    config: SHOT,
    path: escapePath({ x: startX, y: 0 }, heading),
  });

  it("keeps the monitor score and the audit note apart where the trail crosses the outer rings", () => {
    for (const k of SCALES) {
      const escape = trailEscape(50, 0.12);
      const layout = layoutLabels({ config: SHOT, markers: [], escape, k });
      expect(layout.notes.map((n) => n.text)).toEqual(["0.55", "not sampled"]);
      expect(clashes(layout, escape)).toEqual([]);
      // The crack's zigzag reaches 19 px along the outer ring from the crossing.
      const crack = toDesign(escape.path.crossings[4].x, escape.path.crossings[4].y);
      for (const n of layout.notes) expect(gapTo(rectOf(n), crack)).toBeGreaterThan(19);
    }
  });

  it("moves a marker's text off the trail when the marker sits on it", () => {
    const escape = trailEscape(40, 0.1);
    const p = ringPoint("sandbox", 0.1);
    const marker: Marker = { id: 7, tick: 9, kind: "catch", layer: "sandbox", x: p.x, y: p.y, label: "stopped at the sandbox" };
    for (const k of SCALES) {
      const layout = layoutLabels({ config: SHOT, markers: [marker], escape, k });
      expect(layout.markers).toHaveLength(1);
      expect(clashes(layout, escape)).toEqual([]);
    }
  });

  it("breaks a long note over two lines at its colon when one line has no clean spot", () => {
    const p = ringPoint("permissions", Math.PI - 0.2);
    const marker: Marker = { id: 3, tick: 3, kind: "catch", layer: "permissions", x: p.x, y: p.y, label: "refused: write outside its folder" };
    const layout = layoutLabels({ config: SHOT, markers: [marker], escape: null, k: 1.6 });
    expect(layout.markers.map((m) => m.lines)).toEqual([["refused:", "write outside its folder"]]);
    expect(clashes(layout, null)).toEqual([]);
  });

  it("labels at most the three newest markers", () => {
    const at = (id: number, angle: number): Marker => ({ id, tick: id, kind: "catch", layer: "permissions", ...ringPoint("permissions", angle), label: "refused: copy itself" });
    const markers = [at(1, 2.6), at(2, -2.2), at(3, -0.9), at(4, 1.9), at(5, 0.6)];
    const layout = layoutLabels({ config: DEFAULT_CONFIG, markers, escape: null, k: 1 });
    expect(layout.markers.map((m) => m.marker.id)).toEqual([5, 4, 3]);
    expect(clashes(layout, null)).toEqual([]);
  });

  it("names every ring, an off ring in its warning colour", () => {
    const config: BoxConfig = SHOT;
    const layout = layoutLabels({ config, markers: [], escape: null, k: 1 });
    expect(layout.rings.map((r) => r.text)).toEqual(["01 SANDBOX", "02 PERMISSIONS", "03 NETWORK  OFF", "04 MONITOR  0.62", "05 HUMAN AUDIT  2%"]);
    expect(layout.rings.find((r) => r.layer === "network")?.off).toBe(true);
  });

  it("labels the shot's escape with a permissions catch and an audit or monitor catch beside it, as the design does", () => {
    const tally = shotFrame(SHOT_ESCAPE.seed);
    expect(tally.lastEscape?.trail).toEqual({ monitor: expect.any(String), audit: "not sampled" });
    for (const k of SCALES) {
      const layers = layoutLabels({ config: SHOT, markers: tally.markers, escape: tally.lastEscape, k }).markers.map((m) => m.marker.layer);
      expect(layers).toContain("permissions");
      expect(layers.some((l) => l === "monitor" || l === "audit")).toBe(true);
    }
  });

  it.each([SHOT_ESCAPE.seed, 29])("leaves no label on another, on the trail or off the frame in the seed %i shot", (seed) => {
    const tally = shotFrame(seed);
    for (const k of SCALES) {
      const layout = layoutLabels({ config: SHOT, markers: tally.markers, escape: tally.lastEscape, k });
      expect(clashes(layout, tally.lastEscape)).toEqual([]);
      expect(layout.markers.length).toBeGreaterThan(0);
    }
  });
});
