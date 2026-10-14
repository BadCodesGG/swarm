import { describe, expect, it } from "vitest";
import { waitingShare, arcPath, callDuration, radarPoints, resultSize, sparkPath, toolRows } from "./charts";

describe("radarPoints", () => {
  it("puts the biggest share on its axis at the radius", () => {
    const p = radarPoints([4, 2, 0, 0], 100, 100, 50);
    expect(p[0]).toEqual({ x: 100, y: 50 });
    expect(p[1]).toEqual({ x: 125, y: 100 });
    expect(p[2]).toEqual({ x: 100, y: 100 });
  });
  it("collapses to the centre with no tokens", () => {
    expect(radarPoints([0, 0, 0, 0], 10, 10, 5).every((q) => q.x === 10 && q.y === 10)).toBe(true);
  });
});

describe("sparkPath", () => {
  it("scales to the box and flips y", () => {
    expect(sparkPath([0, 10, 5], 200, 100)).toBe("M0 100L100 0L200 50");
  });
  it("is flat on zeros", () => {
    expect(sparkPath([0, 0], 100, 40)).toBe("M0 40L100 40");
  });
});

describe("arcPath", () => {
  it("is empty at zero and a sweep otherwise", () => {
    expect(arcPath(100, 100, 50, 0)).toBe("");
    expect(arcPath(100, 100, 50, 0.5)).toMatch(/^M [\d.-]+ [\d.-]+ A 50 50 0 0 1/);
    expect(arcPath(100, 100, 50, 1)).toMatch(/A 50 50 0 1 1/);
  });
});

describe("toolRows", () => {
  it("lists the used categories biggest first, at most five", () => {
    const mix = { web: 4, shell: 32, files: 5, edit: 7, agents: 6, advisor: 0, plan: 1, mcp: 2, other: 3 };
    const rows = toolRows(mix);
    expect(rows.map((r) => r.key)).toEqual(["shell", "edit", "agents", "files", "web"]);
    expect(rows[0].share).toBe(1);
  });
});

describe("call formatting", () => {
  it("formats durations and result sizes", () => {
    expect(callDuration(0.04)).toBe("<0.1s");
    expect(callDuration(3.21)).toBe("3.2s");
    expect(callDuration(125)).toBe("2m05s");
    expect(resultSize(undefined)).toBe("-");
    expect(resultSize(950)).toBe("950");
    expect(resultSize(12_400)).toBe("12.4k");
  });
});

describe("waitingShare", () => {
  it("rounds, floors tiny shares to <1% and handles nothing", () => {
    expect(waitingShare(25, 100)).toBe("25%");
    expect(waitingShare(0.2, 100)).toBe("<1%");
    expect(waitingShare(0, 100)).toBe("0%");
    expect(waitingShare(5, 0)).toBe("0%");
  });
});
