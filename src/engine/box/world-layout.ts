/**
 * Where the labs sit on the shared map (pure). Scene units are the Box's own (px of the 760x560
 * design frame), y up. A one-lab world is the plain Box: its lab sits at the origin at scale 1, so
 * every constant in `layout.ts` still holds. From two labs each lab is drawn at `LAB_SCALE` in a
 * fixed slot, chosen by the lab's id alone, so adding a lab never moves the others.
 */

import { LAB_NAME, LINK_LABEL, type LabId, type Link, type LinkKind } from "@/lib/box/world-types";
import { escapeHeading, escapePath, RING_RADIUS, type EscapePath, type Point } from "./layout";

/** Lab-local units to world units once there is more than one lab. */
export const LAB_SCALE = 0.45;
/** A lab's outer ring, world units, once there is more than one lab. */
export const LAB_OUTER = RING_RADIUS.audit * LAB_SCALE;
/** Local radii the world trails use: the trail runs out past the labs' edge, the escapee parks short of its end. */
export const WORLD_TRAIL_RADIUS = 430;
export const WORLD_ESCAPEE_RADIUS = 395;

export interface LabFrame {
  id: LabId;
  /** The lab's centre in world units. */
  x: number;
  y: number;
  /** World units per lab-local unit. */
  scale: number;
}

/** One fixed slot per lab id; no two are closer than two outer rings plus a gap. */
export const SLOTS: Readonly<Record<LabId, Point>> = {
  meridian: { x: -240, y: 90 },
  kestrel: { x: 220, y: 90 },
  halcyon: { x: -10, y: -170 },
  orrery: { x: -500, y: -150 },
  vesper: { x: 480, y: -150 },
};

export function labFrames(ids: readonly LabId[]): LabFrame[] {
  if (ids.length === 1) return [{ id: ids[0], x: 0, y: 0, scale: 1 }];
  return ids.map((id) => ({ id, ...SLOTS[id], scale: LAB_SCALE }));
}

export const toWorld = (f: LabFrame, p: Point): Point => ({ x: f.x + p.x * f.scale, y: f.y + p.y * f.scale });
export const toLocal = (f: LabFrame, p: Point): Point => ({ x: (p.x - f.x) / f.scale, y: (p.y - f.y) / f.scale });

/** The lab's outer radius on the map. */
export const outerRadius = (f: LabFrame): number => RING_RADIUS.audit * f.scale;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The labs' rings, with `pad` world units round them. */
export function worldBounds(frames: readonly LabFrame[], pad = 0): Box {
  const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const f of frames) {
    const r = outerRadius(f) + pad;
    box.x0 = Math.min(box.x0, f.x - r);
    box.x1 = Math.max(box.x1, f.x + r);
    box.y0 = Math.min(box.y0, f.y - r);
    box.y1 = Math.max(box.y1, f.y + r);
  }
  return box;
}

export const centroid = (points: readonly Point[]): Point => ({
  x: points.reduce((n, p) => n + p.x, 0) / Math.max(1, points.length),
  y: points.reduce((n, p) => n + p.y, 0) / Math.max(1, points.length),
});

/**
 * The way an escapee from this lab heads: the plain Box's own heading in a one-lab world, else away
 * from the map's middle (so a trail runs out into the empty edge, not across the other labs), with
 * the same per-agent spread.
 */
export function exitHeading(frames: readonly LabFrame[], frame: LabFrame, agent: number): number {
  if (frames.length === 1) return escapeHeading(agent);
  const c = centroid(frames);
  const away = Math.hypot(frame.x - c.x, frame.y - c.y) < 1 ? 0.12 : Math.atan2(frame.y - c.y, frame.x - c.x);
  return away + (escapeHeading(agent) - 0.12);
}

/** A lab-local escape run laid on the map. */
export function worldEscapePath(frames: readonly LabFrame[], frame: LabFrame, start: Point, heading: number): EscapePath {
  const local = frames.length === 1 ? escapePath(start, heading) : escapePath(start, heading, { trail: WORLD_TRAIL_RADIUS, escapee: WORLD_ESCAPEE_RADIUS });
  const w = (p: Point) => toWorld(frame, p);
  return {
    start: w(local.start),
    end: w(local.end),
    escapeeAt: local.escapeeAt,
    escapee: w(local.escapee),
    crossings: local.crossings.map((c) => ({ ...c, ...w(c) })),
  };
}

// --- links ---

/** Segments in every drawn conduit; the shader takes `SEGMENTS + 1` points. */
export const SEGMENTS = 16;
/** Gap between a lab's outer ring and where its conduits start, world units. */
const EDGE_GAP = 5;
/** Sideways bow of the nth link between the same labs, world units: the first runs straight. */
const BOW = [0, 34, -34, 68, -68];

export interface LinkShape {
  index: number;
  kind: LinkKind;
  /** The link's name on the map, "Shared cache". */
  name: string;
  labs: LabId[];
  /** One polyline per conduit (an arc between two labs, or a spoke to a hub), each `SEGMENTS + 1` points. */
  conduits: { from: LabId; points: Point[] }[];
  /** For a hub link, where the spokes meet. */
  hub: Point | null;
  /** Where the name sits. */
  at: Point;
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function sample(a: Point, c: Point, b: Point): Point[] {
  return Array.from({ length: SEGMENTS + 1 }, (_, i) => {
    const t = i / SEGMENTS;
    return lerp(lerp(a, c, t), lerp(c, b, t), t);
  });
}

const edgePoint = (f: LabFrame, toward: Point): Point => {
  const d = Math.hypot(toward.x - f.x, toward.y - f.y) || 1;
  const r = outerRadius(f) + EDGE_GAP;
  return { x: f.x + ((toward.x - f.x) / d) * r, y: f.y + ((toward.y - f.y) / d) * r };
};

/** Every link of the scenario laid on the map; links naming a lab not in the world are skipped. */
export function linkShapes(links: readonly Link[], frames: readonly LabFrame[]): LinkShape[] {
  const seen = new Map<string, number>();
  const out: LinkShape[] = [];
  links.forEach((link, index) => {
    // In map order, so a pair's bow does not depend on how the link lists its labs.
    const members = frames.filter((f) => link.labs.includes(f.id));
    if (members.length < 2) return;
    const name = LINK_LABEL[link.kind];
    if (members.length === 2) {
      const [a, b] = members;
      const key = [a.id, b.id].sort().join();
      const rank = seen.get(key) ?? 0;
      seen.set(key, rank + 1);
      const mid = lerp(a, b, 0.5);
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const bow = BOW[rank % BOW.length];
      const control = { x: mid.x + (-(b.y - a.y) / d) * bow * 2, y: mid.y + ((b.x - a.x) / d) * bow * 2 };
      const start = edgePoint(a, control);
      const end = edgePoint(b, control);
      const points = sample(start, control, end);
      out.push({ index, kind: link.kind, name, labs: [a.id, b.id], conduits: [{ from: a.id, points }], hub: null, at: points[SEGMENTS / 2] });
      return;
    }
    const hub = centroid(members);
    const conduits = members.map((f) => {
      const start = edgePoint(f, hub);
      return { from: f.id, points: sample(start, lerp(start, hub, 0.5), hub) };
    });
    out.push({ index, kind: link.kind, name, labs: members.map((f) => f.id), conduits, hub, at: { x: hub.x, y: hub.y } });
  });
  return out;
}

/**
 * The points a crossing from one lab to another travels, in order, over the link's conduits: the
 * arc itself (reversed when it runs the other way), or the first lab's spoke in and the second's out.
 */
export function routePoints(shape: LinkShape, from: LabId, to: LabId): Point[] {
  const own = (id: LabId) => shape.conduits.find((c) => c.from === id)?.points;
  if (!shape.hub) {
    const arc = shape.conduits[0].points;
    return shape.conduits[0].from === from ? arc : [...arc].reverse();
  }
  const a = own(from) ?? [];
  const b = own(to) ?? [];
  return [...a, ...[...b].reverse()];
}

/** Total length of a polyline. */
export const polylineLength = (pts: readonly Point[]): number => pts.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);

/** The point `t` (0 to 1) of the way along a polyline, by length. */
export function pointAlong(pts: readonly Point[], t: number): Point {
  const total = polylineLength(pts);
  let left = Math.min(1, Math.max(0, t)) * total;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (left <= len || i === pts.length - 1) return lerp(pts[i - 1], pts[i], len === 0 ? 0 : Math.min(1, left / len));
    left -= len;
  }
  return pts[0];
}

export const labName = (id: LabId): string => LAB_NAME[id];
