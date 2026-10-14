import { describe, expect, it } from "vitest";
import { LAB_IDS, type Link } from "@/lib/box/world-types";
import { RING_RADIUS } from "./layout";
import {
  LAB_OUTER,
  LAB_SCALE,
  SEGMENTS,
  SLOTS,
  centroid,
  exitHeading,
  labFrames,
  linkShapes,
  outerRadius,
  pointAlong,
  polylineLength,
  routePoints,
  toLocal,
  toWorld,
  worldBounds,
  worldEscapePath,
} from "./world-layout";

describe("labFrames", () => {
  it("lays one lab out as the plain Box: origin, scale 1", () => {
    expect(labFrames(["kestrel"])).toEqual([{ id: "kestrel", x: 0, y: 0, scale: 1 }]);
  });

  it("gives each lab the same slot whoever else is in the world", () => {
    const three = labFrames(["meridian", "kestrel", "halcyon"]);
    const five = labFrames([...LAB_IDS]);
    for (const f of three) expect(five.find((g) => g.id === f.id)).toEqual(f);
    expect(three.every((f) => f.scale === LAB_SCALE)).toBe(true);
  });

  it("leaves room between every pair of labs, at any count", () => {
    const frames = labFrames([...LAB_IDS]);
    for (const a of frames) {
      for (const b of frames) {
        if (a.id === b.id) continue;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * LAB_OUTER + 40);
      }
    }
  });

  it("round-trips lab-local and world points", () => {
    const f = labFrames(LAB_IDS.slice(0, 3))[1];
    const p = { x: 31, y: -12 };
    const back = toLocal(f, toWorld(f, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it("bounds the rings with the padding", () => {
    const frames = labFrames(["meridian", "kestrel"]);
    const b = worldBounds(frames, 10);
    expect(b.x0).toBeCloseTo(SLOTS.meridian.x - LAB_OUTER - 10);
    expect(b.x1).toBeCloseTo(SLOTS.kestrel.x + LAB_OUTER + 10);
    expect(outerRadius(frames[0])).toBeCloseTo(LAB_OUTER);
  });
});

describe("exitHeading and worldEscapePath", () => {
  it("keeps the plain Box's heading for one lab", () => {
    const f = labFrames(["meridian"]);
    expect(exitHeading(f, f[0], 4)).toBeCloseTo(0.12 + (exitHeading(f, f[0], 4) - 0.12));
    expect(Math.abs(exitHeading(f, f[0], 4) - 0.12)).toBeLessThan(0.21);
  });

  it("sends a lab's escapees away from the middle of the map", () => {
    const frames = labFrames(["meridian", "kestrel", "halcyon"]);
    const c = centroid(frames);
    for (const f of frames) {
      const h = exitHeading(frames, f, 3);
      const away = Math.atan2(f.y - c.y, f.x - c.x);
      expect(Math.cos(h - away)).toBeGreaterThan(0.9);
    }
  });

  it("runs the trail out through every ring and past the lab's edge", () => {
    const frames = labFrames(["meridian", "kestrel", "halcyon"]);
    const f = frames[1];
    const path = worldEscapePath(frames, f, { x: 40, y: 0 }, exitHeading(frames, f, 1));
    expect(path.crossings.map((c) => c.layer)).toEqual(["sandbox", "permissions", "network", "monitor", "audit"]);
    const outer = path.crossings[4];
    expect(Math.hypot(outer.x - f.x, outer.y - f.y)).toBeCloseTo(RING_RADIUS.audit * LAB_SCALE, 3);
    expect(Math.hypot(path.end.x - f.x, path.end.y - f.y)).toBeGreaterThan(LAB_OUTER + 60);
    expect(path.escapeeAt).toBeGreaterThan(path.crossings[4].at);
    expect(path.escapeeAt).toBeLessThan(1);
  });
});

describe("linkShapes", () => {
  const frames = labFrames(["meridian", "kestrel", "halcyon"]);

  it("draws a link between two labs as one arc from edge to edge", () => {
    const [s] = linkShapes([{ kind: "shared-cache", labs: ["kestrel", "halcyon"] }], frames);
    expect(s.name).toBe("Shared cache");
    expect(s.hub).toBeNull();
    expect(s.conduits).toHaveLength(1);
    const pts = s.conduits[0].points;
    expect(pts).toHaveLength(SEGMENTS + 1);
    const k = frames[1];
    const h = frames[2];
    expect(Math.hypot(pts[0].x - k.x, pts[0].y - k.y)).toBeCloseTo(LAB_OUTER + 5, 0);
    expect(Math.hypot(pts[SEGMENTS].x - h.x, pts[SEGMENTS].y - h.y)).toBeCloseTo(LAB_OUTER + 5, 0);
  });

  it("bows parallel links between the same pair apart", () => {
    const links: Link[] = [
      { kind: "shared-cache", labs: ["kestrel", "halcyon"] },
      { kind: "chat-bus", labs: ["halcyon", "kestrel"] },
      { kind: "ci-runner", labs: ["kestrel", "halcyon"] },
    ];
    const mids = linkShapes(links, frames).map((s) => s.at);
    expect(new Set(mids.map((m) => `${Math.round(m.x)},${Math.round(m.y)}`)).size).toBe(3);
  });

  it("joins three or more labs at a hub, one spoke each", () => {
    const [s] = linkShapes([{ kind: "model-registry", labs: ["meridian", "kestrel", "halcyon"] }], frames);
    expect(s.hub).not.toBeNull();
    expect(s.conduits.map((c) => c.from)).toEqual(["meridian", "kestrel", "halcyon"]);
    const c = centroid(frames);
    expect(s.hub!.x).toBeCloseTo(c.x);
    expect(s.hub!.y).toBeCloseTo(c.y);
  });

  it("skips a link that names a lab not in the world, and keeps the scenario's link index", () => {
    const shapes = linkShapes(
      [
        { kind: "chat-bus", labs: ["kestrel", "orrery"] },
        { kind: "shared-cache", labs: ["kestrel", "halcyon"] },
      ],
      frames,
    );
    expect(shapes.map((s) => s.index)).toEqual([1]);
  });

  it("routes a crossing from the first lab to the second, either way round, through a hub too", () => {
    const [arc] = linkShapes([{ kind: "shared-cache", labs: ["kestrel", "halcyon"] }], frames);
    const there = routePoints(arc, "kestrel", "halcyon");
    const back = routePoints(arc, "halcyon", "kestrel");
    expect(there[0]).toEqual(back[back.length - 1]);
    const [hub] = linkShapes([{ kind: "model-registry", labs: ["meridian", "kestrel", "halcyon"] }], frames);
    const route = routePoints(hub, "kestrel", "halcyon");
    expect(route[0]).toEqual(hub.conduits[1].points[0]);
    expect(route[route.length - 1]).toEqual(hub.conduits[2].points[0]);
    expect(route.some((p) => Math.hypot(p.x - hub.hub!.x, p.y - hub.hub!.y) < 1e-6)).toBe(true);
  });
});

describe("pointAlong", () => {
  const line = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  it("walks a polyline by length", () => {
    expect(polylineLength(line)).toBe(20);
    expect(pointAlong(line, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAlong(line, 0.25)).toEqual({ x: 5, y: 0 });
    expect(pointAlong(line, 0.75)).toEqual({ x: 10, y: 5 });
    expect(pointAlong(line, 2)).toEqual({ x: 10, y: 10 });
  });
});
