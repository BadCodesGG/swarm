import { describe, expect, it } from "vitest";
import type { AgentAnchor } from "@/engine/inside/overlay-api";
import { pathOf, placeCallouts, type Rect } from "./callouts";

const anchor = (id: number, x: number, y: number, r = 30): AgentAnchor => ({ id, x, y, r, model: "sonnet", name: `agent ${id}`, tokens: 1000 * id, live: true, far: 0, focus: false });
const centre = { x: 700, y: 400 };
const stat = () => 14;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const ring = (n: number) =>
  Array.from({ length: n }, (_, i) => anchor(i, centre.x + Math.cos(i * 0.9) * 220, centre.y + Math.sin(i * 0.9) * 150));

describe("placeCallouts", () => {
  it("caps the count and keeps the busiest first", () => {
    const out = placeCallouts(ring(12), stat, centre, { width: 1400, height: 900 });
    expect(out.length).toBeLessThanOrEqual(6);
    expect(out[0].anchor.id).toBe(0);
  });

  it("never puts one label over another, off the canvas or over the rectangles to avoid", () => {
    const avoid: Rect[] = [{ x: 100, y: 100, w: 300, h: 80 }];
    const out = placeCallouts(ring(10), stat, centre, { width: 1400, height: 900, avoid });
    expect(out.length).toBeGreaterThan(1);
    out.forEach((c, i) => {
      expect(c.box.x).toBeGreaterThanOrEqual(0);
      expect(c.box.y).toBeGreaterThanOrEqual(0);
      expect(c.box.x + c.box.w).toBeLessThanOrEqual(1400);
      expect(c.box.y + c.box.h).toBeLessThanOrEqual(900);
      expect(overlap(c.box, avoid[0])).toBe(false);
      out.slice(i + 1).forEach((d) => expect(overlap(c.box, d.box)).toBe(false));
    });
  });

  it("hangs a label on the side its leader points away from the scene", () => {
    const [c] = placeCallouts([anchor(1, 1000, 400)], stat, centre, { width: 1400, height: 900 });
    expect(c.side).toBe("start");
    const [d] = placeCallouts([anchor(2, 400, 400)], stat, centre, { width: 1400, height: 900 });
    expect(d.side).toBe("end");
  });

  it("labels only two clouds on a narrow canvas, and drops one it cannot fit", () => {
    expect(placeCallouts(ring(8), stat, centre, { width: 600, height: 800 }).length).toBeLessThanOrEqual(2);
    expect(placeCallouts([anchor(1, 5, 5)], () => 30, { x: 5, y: 5 }, { width: 60, height: 60 })).toEqual([]);
  });
});

describe("callout leaders", () => {
  it("never run through another callout's label or across another leader", () => {
    const out = placeCallouts(ring(12), stat, centre, { width: 1400, height: 900 });
    const segs = (c: (typeof out)[number]) => pathOf(c.from, c.to, c.side === "start");
    const inside = (p: { x: number; y: number }, b: Rect) => p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h;
    out.forEach((c, i) =>
      out.forEach((d, j) => {
        if (i === j) return;
        for (const [p, q] of segs(c)) {
          for (let k = 0; k <= 20; k++) expect(inside({ x: p.x + ((q.x - p.x) * k) / 20, y: p.y + ((q.y - p.y) * k) / 20 }, d.box)).toBe(false);
        }
      }),
    );
  });
});
