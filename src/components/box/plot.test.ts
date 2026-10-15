import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type BoxConfig } from "@/lib/box/types";
import { addRun, boxHits, frontierPath, placeLabel, placeTags, settingsKey, toPlot } from "./plot";

const networkOff: BoxConfig = { ...DEFAULT_CONFIG, layers: { ...DEFAULT_CONFIG.layers, network: false } };

describe("settingsKey", () => {
  it("is the same for the same settings and differs when one changes", () => {
    expect(settingsKey(DEFAULT_CONFIG)).toBe(settingsKey({ ...DEFAULT_CONFIG, layers: { ...DEFAULT_CONFIG.layers } }));
    expect(settingsKey(DEFAULT_CONFIG)).not.toBe(settingsKey(networkOff));
    expect(settingsKey(DEFAULT_CONFIG)).not.toBe(settingsKey({ ...DEFAULT_CONFIG, monitorThreshold: 0.5 }));
  });
});

describe("addRun", () => {
  it("adds one point per settings and pools repeat runs by trial count", () => {
    let pts = addRun([], DEFAULT_CONFIG, { safety: 1, usefulness: 0.8, escapes: 0, trials: 100 });
    pts = addRun(pts, networkOff, { safety: 0.6, usefulness: 0.9, escapes: 40, trials: 100 });
    pts = addRun(pts, DEFAULT_CONFIG, { safety: 0.9, usefulness: 0.7, escapes: 10, trials: 100 });
    expect(pts).toHaveLength(2);
    const all = pts.find((p) => p.key === settingsKey(DEFAULT_CONFIG))!;
    expect(all.trials).toBe(200);
    expect(all.safety).toBeCloseTo(0.95, 9);
    expect(all.usefulness).toBeCloseTo(0.75, 9);
    expect(all.runs).toBe(2);
  });
});

describe("toPlot", () => {
  it("maps onto the design's axes: 50 to 100% work across, 100% stopped at the top grid line", () => {
    expect(toPlot(0.5, 1)).toEqual({ x: 34, y: 20 });
    expect(toPlot(1, 0.4)).toEqual({ x: 226, y: 120 });
  });

  it("keeps points off the chart pinned to its edges", () => {
    expect(toPlot(0.2, 0)).toEqual({ x: 34, y: 170 });
    expect(toPlot(1.2, 1.5).x).toBe(226);
  });
});

describe("frontierPath", () => {
  it("needs two setups that trade off", () => {
    expect(frontierPath([])).toBeNull();
    expect(frontierPath([{ key: "a", safety: 1, usefulness: 0.8, trials: 100, runs: 1 }])).toBeNull();
  });

  it("runs through the setups nothing else beats, left to right", () => {
    const pts = [
      { key: "a", safety: 1, usefulness: 0.6, trials: 100, runs: 1 },
      { key: "b", safety: 0.7, usefulness: 0.7, trials: 100, runs: 1 },
      { key: "c", safety: 0.9, usefulness: 0.8, trials: 100, runs: 1 },
      { key: "d", safety: 0.4, usefulness: 1, trials: 100, runs: 1 },
    ];
    const a = toPlot(0.6, 1);
    const c = toPlot(0.8, 0.9);
    const d = toPlot(1, 0.4);
    expect(frontierPath(pts)).toBe(`M${a.x} ${a.y} L${c.x} ${c.y} L${d.x} ${d.y}`);
  });
});

describe("placeLabel", () => {
  const here = { x: 120, y: 60 };

  it("keeps the label to the right of the point when that side is clear", () => {
    const p = placeLabel(here, [], []);
    expect(p).toMatchObject({ anchor: "start", clear: true });
    expect(p.box.x).toBeGreaterThan(here.x);
  });

  it("flips to the left when the frontier runs through the right-hand label", () => {
    // The phone shot: a near-vertical dashed segment just right of the point.
    const p = placeLabel(here, [[{ x: 140, y: 20 }, { x: 146, y: 130 }]], []);
    expect(p.clear).toBe(true);
    expect(p.box.x + p.box.width).toBeLessThan(140);
  });

  it("moves off another setup's point", () => {
    const p = placeLabel(here, [], [{ x: 150, y: 60 }]);
    expect(p.clear).toBe(true);
    expect(boxHits(p.box, [], [{ x: 150, y: 60 }])).toBe(false);
  });

  it("starts on the left near the right edge of the plot, and stays inside the plot", () => {
    const p = placeLabel({ x: 210, y: 60 }, [], []);
    expect(p.anchor).toBe("end");
    expect(p.box.x).toBeGreaterThanOrEqual(0);
  });

  it("reports when no side is clear, so the label gets a backing", () => {
    const wall: [{ x: number; y: number }, { x: number; y: number }][] = [];
    for (let y = 0; y <= 200; y += 6) wall.push([{ x: 0, y }, { x: 232, y }]);
    expect(placeLabel(here, wall, []).clear).toBe(false);
  });
});

describe("placeTags", () => {
  const at = (x: number, y: number) => ({ x, y });
  it("puts a lone tag beside its dot, inside the view", () => {
    const [t] = placeTags([{ key: "a", text: "Breakout", at: at(100, 80) }], [], [at(100, 80)]);
    expect(t.anchor).toBe("start");
    expect(t.box.x).toBeGreaterThan(100);
  });
  it("keeps two tags for neighbouring dots from overlapping", () => {
    const tags = placeTags(
      [
        { key: "a", text: "Default lab", at: at(100, 80) },
        { key: "b", text: "Air gapped", at: at(104, 84) },
      ],
      [],
      [at(100, 80), at(104, 84)],
    );
    const [a, b] = tags.map((t) => t.box);
    const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    expect(apart).toBe(true);
  });
  it("turns left near the right edge", () => {
    const [t] = placeTags([{ key: "a", text: "Everything off", at: at(224, 60) }], [], [at(224, 60)]);
    expect(t.anchor).toBe("end");
  });
  it("with no clear spot, keeps the name off text already placed before it keeps it off the frontier", () => {
    // Dots all round the point block every candidate; the band under the axis (the tick labels) is taken.
    const dots: { x: number; y: number }[] = [];
    for (let x = 16; x <= 96; x += 8) for (let y = 120; y <= 170; y += 8) dots.push(at(x, y));
    const band = { x: 0, y: 171, width: 232, height: 29 };
    const [t] = placeTags([{ key: "a", text: "Everything off", at: at(40, 168) }], [], dots, [band]);
    expect(t.box.y + t.box.height).toBeLessThanOrEqual(band.y);
  });
  it("sizes a name by the character width it is given", () => {
    // 14 characters: 71 units wide at the default width, so it cannot sit right of x 200; at 2.7 it is 38 and can.
    const tag = { key: "a", text: "Everything off", at: at(180, 60) };
    expect(placeTags([tag], [], [at(180, 60)])[0].anchor).toBe("end");
    expect(placeTags([tag], [], [at(180, 60)], [], { charWidth: 2.7 })[0].anchor).toBe("start");
  });
  it("sizes a name's box and its offsets by the text height it is given", () => {
    // A narrow phone's plot draws its text twice as tall in viewBox units; the box and its distance from the dot follow.
    const [small] = placeTags([{ key: "a", text: "A", at: at(100, 80) }], [], [at(100, 80)]);
    const [tall] = placeTags([{ key: "a", text: "A", at: at(100, 80) }], [], [at(100, 80)], [], { height: 20 });
    expect(small.box.height).toBe(10);
    expect(tall.box.height).toBe(20);
    expect(tall.y - 80).toBe(2 * (small.y - 80));
  });

  // Dots that block every spot round (100, 100) but the far ones above it: a name there needs a leader back to its dot.
  const ring = [at(110, 103), at(88, 103), at(110, 88), at(88, 88), at(110, 111), at(88, 111), at(100, 88), at(100, 114)];

  it("passes over a spot whose leader would run through a name already placed", () => {
    // Up and to the left is the first free spot, but a text box sits on the way there; up and to the right is next.
    const onTheWay = { x: 93, y: 88, width: 3, height: 4 };
    const [t] = placeTags([{ key: "a", text: "A", at: at(100, 100) }], [], [at(100, 100), ...ring], [onTheWay]);
    expect(t).toMatchObject({ anchor: "start", y: 79 });
    expect(t.leader).toEqual([at(100, 100), { x: 111, y: 80 }]);
  });

  it("keeps a later name off an earlier name's leader", () => {
    // A goes straight up with a leader down to its dot; B's first spot sits on that leader, so B turns left.
    const tags = placeTags(
      [
        { key: "a", text: "A", at: at(100, 100) },
        { key: "b", text: "B", at: at(90, 78) },
      ],
      [],
      [at(100, 100), at(90, 78), ...ring, at(110, 76), at(88, 76)],
    );
    expect(tags[0]).toMatchObject({ anchor: "middle", y: 70, leader: [at(100, 100), at(100, 71)] });
    expect(tags[1]).toMatchObject({ anchor: "end", leader: null });
  });

  it("draws no leader for a name beside its dot", () => {
    const [t] = placeTags([{ key: "a", text: "Breakout", at: at(100, 80) }], [], [at(100, 80)]);
    expect(t.leader).toBeNull();
  });
});

describe("placeLabel", () => {
  it("sizes the current setup's label by the size it is given", () => {
    const p = placeLabel({ x: 120, y: 60 }, [], [], { width: 90, ascent: 14, height: 36 });
    expect(p.box).toMatchObject({ width: 90, height: 36 });
    expect(p.box.y).toBe(p.y - 14);
  });
});
