import { describe, expect, it } from "vitest";
import { LAYER_ORDER } from "@/lib/box/types";
import {
  CROWD_RADIUS,
  ESCAPEE_RADIUS,
  escapeHeading,
  escapePath,
  homes,
  RING_RADIUS,
  ringPoint,
  toDesign,
  TRAIL_RADIUS,
  wander,
} from "./layout";

describe("rings", () => {
  it("nest inside out at the design's radii", () => {
    expect(LAYER_ORDER.map((l) => RING_RADIUS[l])).toEqual([70, 120, 170, 220, 262]);
    expect(CROWD_RADIUS).toBeLessThan(RING_RADIUS.sandbox);
  });

  it("places a point on a ring at the given angle", () => {
    const p = ringPoint("monitor", Math.PI / 2);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(220, 6);
  });

  it("maps scene units to the 760x560 design frame, y down", () => {
    expect(toDesign(0, 0)).toEqual({ x: 380, y: 280 });
    expect(toDesign(262, 0)).toEqual({ x: 642, y: 280 });
    expect(toDesign(0, 262)).toEqual({ x: 380, y: 18 });
  });
});

describe("homes", () => {
  it("fills the crowd disc and is the same for the same seed", () => {
    const a = homes(2000, 7);
    const b = homes(2000, 7);
    expect(a).toEqual(b);
    for (let i = 0; i < 2000; i++) expect(Math.hypot(a[i * 2], a[i * 2 + 1])).toBeLessThan(CROWD_RADIUS);
    const far = Array.from({ length: 2000 }, (_, i) => Math.hypot(a[i * 2], a[i * 2 + 1])).filter((r) => r > CROWD_RADIUS * 0.8);
    expect(far.length).toBeGreaterThan(200);
  });

  it("changes with the seed", () => {
    expect(homes(50, 1)).not.toEqual(homes(50, 2));
  });
});

describe("wander", () => {
  it("drifts a few units around home and moves between ticks", () => {
    const out = { x: 0, y: 0 };
    wander(10, -5, 3, 100, out);
    expect(Math.hypot(out.x - 10, out.y + 5)).toBeLessThanOrEqual(4.01);
    const first = { ...out };
    wander(10, -5, 3, 110, out);
    expect(out).not.toEqual(first);
  });
});

describe("escape path", () => {
  it("heads right, toward the OUTSIDE panel", () => {
    for (let a = 0; a < 200; a++) expect(Math.cos(escapeHeading(a))).toBeGreaterThan(0.9);
  });

  it("crosses every ring once, inside out, at that ring's radius", () => {
    const path = escapePath({ x: 40, y: 10 }, 0.12);
    expect(path.crossings.map((c) => c.layer)).toEqual([...LAYER_ORDER]);
    let last = 0;
    for (const c of path.crossings) {
      expect(Math.hypot(c.x, c.y)).toBeCloseTo(RING_RADIUS[c.layer], 4);
      expect(c.at).toBeGreaterThan(last);
      last = c.at;
    }
    expect(last).toBeLessThan(1);
  });

  it("ends the trail past the outer ring and parks the escapee short of it", () => {
    const path = escapePath({ x: -20, y: 30 }, 0.1);
    expect(Math.hypot(path.end.x, path.end.y)).toBeCloseTo(TRAIL_RADIUS, 4);
    expect(Math.hypot(path.escapee.x, path.escapee.y)).toBeCloseTo(ESCAPEE_RADIUS, 4);
    expect(ESCAPEE_RADIUS).toBeGreaterThan(RING_RADIUS.audit);
    expect(TRAIL_RADIUS).toBeGreaterThan(ESCAPEE_RADIUS);
  });
});
