import { describe, expect, it } from "vitest";
import { createState, rogueCount } from "@/lib/box/sim";
import { DEFAULT_CONFIG, type BoxConfig } from "@/lib/box/types";
import { escapePath, homes, ringPoint, toDesign, type Point } from "./layout";
import { FRAME_BOX, layoutLabels, layoutWorldLabels, MARKER_BUTTON, overlaps, rectOf, segmentHits, touchesDisc, type LabelLayout, type Rect } from "./labels";
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

describe("layoutWorldLabels", () => {
  const bounds: Rect = { x0: 0, y0: 0, x1: 900, y1: 700 };
  // The breakout's three labs as the overview lays them on a 900x700 slot.
  const labs = [
    { id: "meridian", name: "MERIDIAN", status: "HELD", x: 260, y: 230, r: 95 },
    { id: "kestrel", name: "KESTREL", status: "BREACHED", x: 590, y: 270, r: 95 },
    { id: "halcyon", name: "HALCYON", status: "BREACHED", x: 420, y: 520, r: 95 },
  ];
  const links = [{ index: 0, name: "Shared cache", x: 520, y: 400 }];
  const markers = [
    { n: 1, x: 690, y: 215 },
    { n: 2, x: 462, y: 434 },
  ];
  const input = { bounds, labs, links, markers, outside: { x: 790, y: 150 }, k: 1 };

  const boxesOf = (l: ReturnType<typeof layoutWorldLabels>) => [...l.labs, ...l.links, ...(l.outside ? [l.outside] : [])].map(rectOf);

  it("keeps the OUTSIDE label inside the slot when four markers crowd the end of the trail by its edge", () => {
    const crowd = [
      { n: 1, x: 835, y: 120 },
      { n: 2, x: 858, y: 150 },
      { n: 3, x: 868, y: 108 },
      { n: 4, x: 884, y: 140 },
    ];
    const l = layoutWorldLabels({ ...input, markers: crowd, outside: { x: 876, y: 128 } });
    const r = rectOf(l.outside!);
    expect(r.x0).toBeGreaterThanOrEqual(bounds.x0);
    expect(r.x1).toBeLessThanOrEqual(bounds.x1);
    expect(r.y0).toBeGreaterThanOrEqual(bounds.y0);
  });

  it("names every lab beside its ring and keeps all the boxes apart", () => {
    const l = layoutWorldLabels(input);
    expect(l.labs.map((t) => t.id)).toEqual(["meridian", "kestrel", "halcyon"]);
    for (const t of l.labs) expect(t.lines).toEqual([labs.find((x) => x.id === t.id)!.name, labs.find((x) => x.id === t.id)!.status]);
    const boxes = boxesOf(l);
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
  });

  it("slides a lab's name farther from its ring when the markers crowd every spot beside it (a 320 phone after a fork)", () => {
    const small = {
      bounds: { x0: 18, y0: 104.2, x1: 287, y1: 301.3 },
      labs: [
        { id: "meridian", name: "MERIDIAN", status: "HELD", x: 113, y: 166, r: 24 },
        { id: "kestrel", name: "KESTREL", status: "BREACHED", x: 192, y: 166, r: 24 },
        { id: "halcyon", name: "HALCYON", status: "BREACHED", x: 153, y: 214, r: 24 },
      ],
      links: [],
      markers: [
        { n: 1, x: 193, y: 141.3 },
        { n: 2, x: 233.7, y: 195.3 },
        { n: 3, x: 226.8, y: 118.2 },
        { n: 4, x: 240.2, y: 155.9 },
      ],
      outside: null,
      k: 1.25,
      sparse: true,
    };
    const l = layoutWorldLabels(small);
    const boxes = boxesOf(l);
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
    for (const r of boxes) {
      for (const m of small.markers) expect(touchesDisc(r, m, MARKER_BUTTON * small.k + 2)).toBe(false);
      expect(r.y1).toBeLessThanOrEqual(small.bounds.y1);
    }
    // A name may meet its own ring where the slot's edge pulls it back (MERIDIAN, at the top); never another's.
    for (const t of l.labs) for (const lab of small.labs) if (lab.id !== t.id) expect(touchesDisc(rectOf(t), lab, lab.r + 3)).toBe(false);
  });

  it("keeps every box inside the slot and off the rings, the marker buttons and the trails", () => {
    const trail: [Point, Point] = [{ x: 640, y: 250 }, { x: 800, y: 150 }];
    const l = layoutWorldLabels({ ...input, segments: [trail] });
    for (const r of boxesOf(l)) {
      expect(r.x0).toBeGreaterThanOrEqual(0);
      expect(r.x1).toBeLessThanOrEqual(900);
      expect(r.y1).toBeLessThanOrEqual(700);
      for (const lab of labs) expect(touchesDisc(r, lab, lab.r)).toBe(false);
      for (const m of markers) expect(touchesDisc(r, m, MARKER_BUTTON)).toBe(false);
      expect(segmentHits(r, trail[0], trail[1])).toBe(false);
    }
  });

  it("keeps lab names off the conduits, and a link's own name on its own", () => {
    // A conduit running straight under where Halcyon's name would go, and another link's through where the first link's name would.
    const under = { link: 7, points: [{ x: 300, y: 625 }, { x: 540, y: 625 }] };
    const own = { link: 0, points: [{ x: 440, y: 396 }, { x: 600, y: 396 }] };
    const l = layoutWorldLabels({ ...input, conduits: [under, own] });
    const halcyon = rectOf(l.labs.find((t) => t.id === "halcyon")!);
    expect(segmentHits(halcyon, under.points[0], under.points[1])).toBe(false);
    const name = rectOf(l.links[0]);
    expect(segmentHits(name, under.points[0], under.points[1])).toBe(false);
    expect(Math.abs(l.links[0].y - 400)).toBeLessThan(40);
  });

  it("keeps a lab's name off a box it is told to avoid, such as the rings key in the slot's corner", () => {
    // The key along the slot's foot, right where Halcyon's name would go under its ring.
    const key: Rect = { x0: 14, y0: 640, x1: 600, y1: 672 };
    const without = rectOf(layoutWorldLabels(input).labs.find((t) => t.id === "halcyon")!);
    expect(overlaps(without, key)).toBe(true);
    const l = layoutWorldLabels({ ...input, avoid: [key] });
    for (const r of boxesOf(l)) expect(overlaps(r, key)).toBe(false);
  });

  it("brings a name back inside the slot when every spot round its ring would leave it", () => {
    // A phone's slot with a ring that nearly fills it: under, over and beside it all run off an edge.
    const tiny: Rect = { x0: 0, y0: 0, x1: 200, y1: 120 };
    const l = layoutWorldLabels({ bounds: tiny, labs: [{ id: "a", name: "MERIDIAN", status: "HELD", x: 100, y: 60, r: 50 }], links: [], markers: [], outside: { x: 198, y: 60 }, k: 1 });
    for (const r of [rectOf(l.labs[0]), rectOf(l.outside!)]) {
      expect(r.x0).toBeGreaterThanOrEqual(tiny.x0);
      expect(r.y0).toBeGreaterThanOrEqual(tiny.y0);
      expect(r.x1).toBeLessThanOrEqual(tiny.x1);
      expect(r.y1).toBeLessThanOrEqual(tiny.y1);
    }
  });

  it("on a phone's slot leaves link names off and shows OUTSIDE only where it is clear, so no text covers a button or a name", () => {
    // The breakout overview on a 362x267 slot, as a phone draws it: rings of 41 px, six buttons, text at 1.25.
    const k = 1.25;
    const phone = { x0: 16, y0: 359, x1: 374, y1: 622 };
    const labs = [
      { id: "meridian", name: "MERIDIAN", status: "HELD", x: 127, y: 425, r: 41 },
      { id: "kestrel", name: "KESTREL", status: "BREACHED", x: 262, y: 425, r: 41 },
      { id: "halcyon", name: "HALCYON", status: "BREACHED", x: 196, y: 510, r: 41 },
    ];
    const buttons = [
      { n: 1, x: 284, y: 396 },
      { n: 2, x: 320, y: 430 },
      { n: 3, x: 318, y: 375 },
      { n: 4, x: 349, y: 402 },
      { n: 5, x: 223, y: 475 },
      { n: 6, x: 175, y: 425 },
    ];
    const crowded = {
      bounds: phone,
      labs,
      links: [
        { index: 0, name: "Shared cache", x: 240, y: 468 },
        { index: 1, name: "Model registry", x: 175, y: 425 },
      ],
      markers: buttons,
      outside: { x: 339, y: 394 },
      segments: [[{ x: 290, y: 400 }, { x: 339, y: 394 }]] as [Point, Point][],
      k,
    };
    const l = layoutWorldLabels({ ...crowded, sparse: true });
    expect(l.links).toEqual([]);
    expect(l.labs).toHaveLength(3);
    const boxes = boxesOf(l);
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
    for (const r of boxes) {
      for (const m of buttons) expect(touchesDisc(r, m, MARKER_BUTTON * k)).toBe(false);
      expect(r.x0).toBeGreaterThanOrEqual(phone.x0);
      expect(r.x1).toBeLessThanOrEqual(phone.x1);
      expect(r.y0).toBeGreaterThanOrEqual(phone.y0);
      expect(r.y1).toBeLessThanOrEqual(phone.y1);
    }
    // A wide slot keeps every name whatever the crowd.
    expect(layoutWorldLabels(crowded).links).toHaveLength(2);
  });

  it("moves a name off a marker button that sits where it would go", () => {
    const l = layoutWorldLabels({ ...input, markers: [{ n: 1, x: 260, y: 360 }] });
    expect(touchesDisc(rectOf(l.labs[0]), { x: 260, y: 360 }, MARKER_BUTTON)).toBe(false);
  });

  it("is the same every time", () => {
    expect(layoutWorldLabels(input)).toEqual(layoutWorldLabels(input));
  });

  it("scales its text, and still finds clear spots on a small slot", () => {
    const small = layoutWorldLabels({
      bounds: { x0: 0, y0: 0, x1: 380, y1: 300 },
      labs: [
        { id: "a", name: "MERIDIAN", status: "HELD", x: 90, y: 90, r: 50 },
        { id: "b", name: "KESTREL", status: "BREACHED", x: 280, y: 110, r: 50 },
      ],
      links: [{ index: 0, name: "Shared cache", x: 185, y: 100 }],
      markers: [],
      outside: null,
      k: 1.2,
    });
    expect(small.labs[0].fontSize).toBeCloseTo(14.4);
    const boxes = boxesOf(small);
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
    expect(small.outside).toBeNull();
  });
});
