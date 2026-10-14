import { describe, expect, it } from "vitest";
import { LEGACY_POSE, type Pose } from "./camera";
import { fitView, pan, project, unproject, zoomAbout } from "./view";

const slot = { x: 300, y: 80, width: 760, height: 560 };
const overview: Pose = { x: 10, y: -20, w: 700, h: 640 };

describe("fitView", () => {
  it("is the plain Box's fit for its own frame: the origin lands on the slot's centre, 1 px per unit at 760x560", () => {
    const v = fitView(slot, LEGACY_POSE);
    expect(v.scale).toBe(1);
    expect(project(v, { x: 0, y: 0 })).toEqual({ x: 680, y: 360 });
    expect(project(v, { x: 100, y: 50 })).toEqual({ x: 780, y: 310 });
  });

  it("fits the pose inside the slot on the tighter side, never cropping it", () => {
    const v = fitView({ x: 0, y: 0, width: 1000, height: 300 }, overview);
    expect(v.scale).toBeCloseTo(300 / 640);
    const corner = project(v, { x: overview.x + overview.w / 2, y: overview.y + overview.h / 2 });
    expect(corner.y).toBeCloseTo(0);
    expect(corner.x).toBeLessThan(1000);
  });

  it("keeps a floor on the scale for a slot with no size yet", () => {
    expect(fitView({ x: 0, y: 0, width: 0, height: 0 }, overview).scale).toBe(0.05);
  });
});

describe("unproject", () => {
  it("undoes project", () => {
    const v = fitView(slot, overview);
    const p = { x: -123, y: 77 };
    const back = unproject(v, project(v, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });
});

describe("pan", () => {
  it("moves the world with the drag", () => {
    const v = fitView(slot, overview);
    const before = project(v, { x: 5, y: 5 });
    const moved = fitView(slot, pan(v, 40, -25));
    const after = project(moved, { x: 5, y: 5 });
    expect(after.x - before.x).toBeCloseTo(40);
    expect(after.y - before.y).toBeCloseTo(-25);
  });
});

describe("zoomAbout", () => {
  it("keeps the world point under the cursor still", () => {
    const v = fitView(slot, overview);
    const cursor = { x: 500, y: 200 };
    const under = unproject(v, cursor);
    const next = fitView(slot, zoomAbout(v, cursor, 1.5, overview));
    const now = unproject(next, cursor);
    expect(now.x).toBeCloseTo(under.x);
    expect(now.y).toBeCloseTo(under.y);
    expect(next.scale).toBeGreaterThan(v.scale);
  });

  it("stops at the zoom limits", () => {
    const v = fitView(slot, overview);
    const close = zoomAbout(v, { x: 680, y: 360 }, 1e6, overview);
    const far = zoomAbout(v, { x: 680, y: 360 }, 1e-6, overview);
    expect(close.w).toBeCloseTo(overview.w * 0.3);
    expect(far.w).toBeCloseTo(overview.w * 1.6);
  });
});
