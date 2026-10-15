import { describe, expect, it } from "vitest";
import type { StoryItem } from "./camera";
import { CROSS_TICKS, ESCAPE_TICKS } from "./camera";
import { HELD_STOP, LINGER_TICKS, breachTicks, escapeProgress, markerSlots, markerTick, reachLanded, reachProgress, settledTick } from "./story";

const escape: StoryItem = { kind: "escape", lab: "kestrel", tick: 152, start: 152, end: 152 + ESCAPE_TICKS, index: 0 };
const crossed: StoryItem = { kind: "crossed", lab: "halcyon", from: "kestrel", tick: 158, start: 178, end: 178 + CROSS_TICKS, index: 1 };
const held: StoryItem = { kind: "held", lab: "meridian", from: "kestrel", tick: 160, start: crossed.end, end: crossed.end + CROSS_TICKS, index: 2 };
const items = [escape, crossed, held];

describe("escapeProgress", () => {
  it("runs from nothing to parked over the flight, easing out", () => {
    expect(escapeProgress(escape, 100)).toBe(0);
    expect(escapeProgress(escape, escape.start)).toBe(0);
    expect(escapeProgress(escape, escape.start + ESCAPE_TICKS / 2)).toBeGreaterThan(0.5);
    expect(escapeProgress(escape, escape.end)).toBe(1);
    expect(escapeProgress(escape, 9999)).toBe(1);
  });
});

describe("reachProgress", () => {
  it("is off before the reach starts and after its pulse has lingered", () => {
    expect(reachProgress(crossed, crossed.start - 1)).toBeNull();
    expect(reachProgress(crossed, crossed.end + LINGER_TICKS + 1)).toBeNull();
  });

  it("carries a crossing all the way along its conduit", () => {
    expect(reachProgress(crossed, crossed.start)).toBe(0);
    expect(reachProgress(crossed, crossed.start + CROSS_TICKS / 2)).toBeCloseTo(0.5);
    expect(reachProgress(crossed, crossed.end)).toBe(1);
  });

  it("stops a refused reach short of the far lab", () => {
    expect(reachProgress(held, held.end)).toBeCloseTo(HELD_STOP);
  });

  it("lands a reach just before its end", () => {
    expect(reachLanded(crossed, crossed.end - 2)).toBe(false);
    expect(reachLanded(crossed, crossed.end)).toBe(true);
  });
});

describe("markers and breaches", () => {
  it("numbers four markers for an escape, one for a crossing and one for the first refusal into a lab, in event order", () => {
    expect(markerSlots(items)).toEqual([
      { item: escape, beat: 0 },
      { item: escape, beat: 1 },
      { item: escape, beat: 2 },
      { item: escape, beat: 3 },
      { item: crossed, beat: null },
      { item: held, beat: null },
    ]);
    expect(markerSlots([...items, { ...held, tick: held.tick + 50, start: held.start + 50, end: held.end + 50 }])).toHaveLength(6);
  });

  it("shows an escape's sub-steps one after another, the last where the whole marker used to appear", () => {
    const ticks = [0, 1, 2, 3].map((b) => markerTick(escape, b));
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    expect(new Set(ticks).size).toBe(4);
    expect(ticks[0]).toBeGreaterThan(escape.start);
    expect(ticks[3]).toBe(escape.start + Math.round(26 * 0.7));
  });

  it("shows an escape's marker once the agent is well out and a crossing's as it lands", () => {
    expect(markerTick(escape)).toBeGreaterThan(escape.start);
    expect(markerTick(escape)).toBeLessThan(escape.end);
    expect(markerTick(crossed)).toBe(crossed.end - 3);
  });

  it("breaches the lab an agent left once it is out, and the one a crossing reaches when it lands; a refusal breaches nothing", () => {
    const b = breachTicks(items);
    expect(b.kestrel).toBeGreaterThan(escape.start);
    expect(b.halcyon).toBe(crossed.end);
    expect(b.meridian).toBeUndefined();
  });

  it("reads a lab breached at once after a replay past its breach event, without waiting for the pulse", () => {
    // Replayed to tick 170: the escape (152) and the crossing (158) happened, the crossing's pulse lands at 178 + CROSS_TICKS.
    const b = breachTicks(items, 170);
    expect(b.kestrel).toBeLessThanOrEqual(170);
    expect(b.halcyon).toBeLessThanOrEqual(170);
    expect(b.meridian).toBeUndefined();
  });

  it("keeps the pulse-then-breach timing for events after the replayed tick", () => {
    const b = breachTicks(items, 155);
    expect(b.kestrel).toBeLessThanOrEqual(155);
    expect(b.halcyon).toBe(crossed.end);
  });

  it("settles after the last beat has lingered", () => {
    expect(settledTick(items)).toBe(held.end + LINGER_TICKS + 1);
    expect(settledTick([])).toBe(0);
  });
});
