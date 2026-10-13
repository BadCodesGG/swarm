import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type BoxConfig } from "@/lib/box/types";
import { addRun, frontierPath, settingsKey, toPlot } from "./plot";

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
