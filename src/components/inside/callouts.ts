/**
 * Where the annotated star chart's callouts go: one small mono label per chosen cloud on a thin
 * leader line, none over another label, over a station label, or off the canvas. Pure, so it is
 * tested without a browser. The anchors arrive busiest first with the orchestrator leading.
 */

import type { AgentAnchor } from "@/engine/inside/overlay-api";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Callout {
  anchor: AgentAnchor;
  /** Where the leader leaves the cloud. */
  from: { x: number; y: number };
  /** Where it meets the label box (the box's near vertical edge). */
  to: { x: number; y: number };
  box: Rect;
  /** The label hangs to the right of its leader (`start`) or to the left (`end`). */
  side: "start" | "end";
}

export interface CalloutOptions {
  /** The canvas, CSS px. */
  width: number;
  height: number;
  /** Where labels may sit; defaults to the canvas inset by a margin. */
  bounds?: Rect;
  /** Rectangles already taken (station labels, the boundary label, the HUD's panels). */
  avoid?: Rect[];
  /** Most callouts; fewer on a narrow canvas. */
  max?: number;
}

/** Below this canvas width only the two busiest clouds are labelled. */
export const NARROW_CALLOUTS = 640;
export const MAX_CALLOUTS = 6;
const LABEL_H = 30;
const CHAR_W = 6.6;
const PAD = 8;
/** Px between the end of a leader and its label. */
export const LABEL_GAP = 18;
const MAX_CHARS = 24;

/** The label's box size: the longer of its two lines, at the mono face's advance. */
export function labelSize(a: AgentAnchor, statChars: number): { w: number; h: number } {
  const chars = Math.min(Math.max(a.name.length, statChars), MAX_CHARS);
  return { w: Math.ceil(chars * CHAR_W) + 4, h: LABEL_H };
}

const hits = (a: Rect, b: Rect, pad = PAD) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

type Pt = { x: number; y: number };

/** The two pieces a callout draws: the leader, then the short tick that runs to its label. */
export function pathOf(from: Pt, to: Pt, right: boolean): [Pt, Pt][] {
  return [
    [from, to],
    [to, { x: to.x + (right ? LABEL_GAP - 4 : 4 - LABEL_GAP), y: to.y }],
  ];
}

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}

/** Whether the segment p to q crosses the rectangle (a coarse sample is plenty at label scale). */
function segmentHits(p: { x: number; y: number }, q: { x: number; y: number }, r: Rect): boolean {
  for (let i = 0; i <= 24; i++) {
    const s = i / 24;
    const x = p.x + (q.x - p.x) * s;
    const y = p.y + (q.y - p.y) * s;
    if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
  }
  return false;
}

/** Angles to try, radians off straight outward, nearest first. */
const TURNS = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, Math.PI];
/** How far past the cloud's edge the label sits, px. */
const REACH = [36, 62, 92, 128];

export function placeCallouts(anchors: readonly AgentAnchor[], statChars: (a: AgentAnchor) => number, centre: { x: number; y: number }, o: CalloutOptions): Callout[] {
  const max = o.max ?? (o.width < NARROW_CALLOUTS ? 2 : MAX_CALLOUTS);
  const bounds = o.bounds ?? { x: 12, y: 12, w: o.width - 24, h: o.height - 24 };
  // No label sits on a cloud: it would be lost in the glow.
  const discs: Rect[] = anchors.map((a) => ({ x: a.x - a.r * 0.8, y: a.y - a.r * 0.8, w: a.r * 1.6, h: a.r * 1.6 }));
  const taken: Rect[] = [...(o.avoid ?? []), ...discs];
  const out: Callout[] = [];
  for (const a of anchors) {
    if (out.length >= max) break;
    const { w, h } = labelSize(a, statChars(a));
    // Outward from the scene centre; the orchestrator sits on it, so it goes up and to the left.
    const away = Math.hypot(a.x - centre.x, a.y - centre.y) < 12 ? Math.atan2(-1, -1.4) : Math.atan2(a.y - centre.y, a.x - centre.x);
    let placed: Callout | null = null;
    search: for (const reach of REACH) {
      for (const turn of TURNS) {
        const ang = away + turn;
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        const from = { x: a.x + dx * a.r * 0.8, y: a.y + dy * a.r * 0.8 };
        const tip = { x: a.x + dx * (a.r + reach), y: a.y + dy * (a.r + reach) };
        const right = dx >= 0;
        // The label hangs off the tip, vertically centred on it.
        const box: Rect = { x: right ? tip.x + LABEL_GAP : tip.x - LABEL_GAP - w, y: tip.y - h / 2, w, h };
        if (box.x < bounds.x || box.y < bounds.y || box.x + box.w > bounds.x + bounds.w || box.y + box.h > bounds.y + bounds.h) continue;
        if (taken.some((r) => hits(box, r))) continue;
        const mine = pathOf(from, tip, right);
        const clear = out.every((c) => {
          const theirs = pathOf(c.from, c.to, c.side === "start");
          return (
            !mine.some(([p, q]) => segmentHits(p, q, c.box)) &&
            !theirs.some(([p, q]) => segmentHits(p, q, box)) &&
            !mine.some(([p, q]) => theirs.some(([u, v]) => segmentsCross(p, q, u, v)))
          );
        });
        if (!clear) continue;
        if (o.avoid?.some((r) => mine.some(([p, q]) => segmentHits(p, q, r)))) continue;
        placed = { anchor: a, from, to: tip, box, side: right ? "start" : "end" };
        break search;
      }
    }
    if (placed) {
      taken.push(placed.box);
      out.push(placed);
    }
  }
  return out;
}
