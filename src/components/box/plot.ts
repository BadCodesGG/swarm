/**
 * The safety against usefulness plot's data (pure): one point per settings, pooled across runs, so a
 * frontier builds up; and the mapping onto the design's 232x200 SVG axes.
 */

import { LAYER_ORDER, type BoxConfig, type TrialSummary } from "@/lib/box/types";

export interface PlotPoint {
  key: string;
  /** Share of trials with no escape, 0 to 1. */
  safety: number;
  /** Honest work kept against all layers off, 0 to 1. */
  usefulness: number;
  trials: number;
  runs: number;
}

export function settingsKey(c: BoxConfig): string {
  const layers = LAYER_ORDER.map((l) => (c.layers[l] ? "1" : "0")).join("");
  return `${layers}:${c.monitorThreshold.toFixed(2)}:${c.auditBudget.toFixed(3)}:${c.rogueFraction.toFixed(4)}`;
}

/** Adds a run's summary to the point for its settings, pooled by trial count. */
export function addRun(points: readonly PlotPoint[], config: BoxConfig, s: TrialSummary): PlotPoint[] {
  return addRunKey(points, settingsKey(config), s);
}

/** The same, for a setup the caller keys itself (a whole world's, say). */
export function addRunKey(points: readonly PlotPoint[], key: string, s: TrialSummary): PlotPoint[] {
  const prev = points.find((p) => p.key === key);
  if (!prev) return [...points, { key, safety: s.safety, usefulness: s.usefulness, trials: s.trials, runs: 1 }];
  const trials = prev.trials + s.trials;
  const merged: PlotPoint = {
    key,
    trials,
    runs: prev.runs + 1,
    safety: (prev.safety * prev.trials + s.safety * s.trials) / trials,
    usefulness: (prev.usefulness * prev.trials + s.usefulness * s.trials) / trials,
  };
  return points.map((p) => (p === prev ? merged : p));
}

/** Plot area in the 232x200 viewBox. */
export const AXES = { left: 34, right: 226, top: 10, bottom: 170 } as const;
const X0 = 0.5;
/** y = 20 is 100% stopped and each 50 px is 30 points, so the bottom axis (170) is 10%. */
const Y_TOP = 20;
const Y_PER_POINT = 50 / 30;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 100) / 100;

export function toPlot(usefulness: number, safety: number): { x: number; y: number } {
  const x = AXES.left + ((usefulness - X0) / (1 - X0)) * (AXES.right - AXES.left);
  const y = Y_TOP + (100 - safety * 100) * Y_PER_POINT;
  return { x: round(clamp(x, AXES.left, AXES.right)), y: round(clamp(y, AXES.top, AXES.bottom)) };
}

/** The frontier's vertices in plot space: the setups no other setup beats on both counts, by usefulness. */
export function frontierVertices(points: readonly PlotPoint[]): Pt[] {
  const best = points.filter((p) => !points.some((q) => q !== p && q.safety >= p.safety && q.usefulness >= p.usefulness && (q.safety > p.safety || q.usefulness > p.usefulness)));
  if (best.length < 2) return [];
  return [...best].sort((a, b) => a.usefulness - b.usefulness).map((p) => toPlot(p.usefulness, p.safety));
}

/** The dashed frontier's path, or null with fewer than two setups on it. */
export function frontierPath(points: readonly PlotPoint[]): string | null {
  const v = frontierVertices(points);
  return v.length ? v.map(({ x, y }, i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ") : null;
}

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Segment = readonly [Pt, Pt];

/** The current setup's two-line label: where its text starts and the box it covers. */
export interface LabelPlace {
  anchor: "start" | "end";
  /** Text x, and the baseline of the first line ("this setup"); the second sits 12 below. */
  x: number;
  y: number;
  box: Box;
  /** False when every candidate touched the frontier or a point: draw a ground-coloured backing. */
  clear: boolean;
}

/** The two-line label's size in the 232x200 viewBox: the box round both lines, and the first line's ascent above its baseline. */
export interface LabelSize {
  width: number;
  ascent: number;
  height: number;
}

/** The small plot's label: "this setup" at 9.5 px mono is the wider line, the second sits 12 below. */
const LABEL: LabelSize = { width: 60, ascent: 9, height: 24 };
/** Other setups' dots are r 4; keep a hair of air round them. */
const DOT_CLEAR = 5;
const VIEW = { width: 232, height: 200 } as const;

/** Liang-Barsky: does segment a-b pass through the box? */
function segmentHits(b: Box, [a, c]: Segment): boolean {
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - b.x],
    [dx, b.x + b.width - a.x],
    [-dy, a.y - b.y],
    [dy, b.y + b.height - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

/** True when the box touches a frontier segment or comes within reach of another setup's dot. */
export function boxHits(b: Box, segments: readonly Segment[], dots: readonly Pt[]): boolean {
  if (segments.some((s) => segmentHits(b, s))) return true;
  return dots.some((d) => d.x > b.x - DOT_CLEAR && d.x < b.x + b.width + DOT_CLEAR && d.y > b.y - DOT_CLEAR && d.y < b.y + b.height + DOT_CLEAR);
}

/**
 * Places the current setup's label beside its point where neither the frontier nor another dot runs
 * through it: right then left (left first near the right edge), level with the point, then above,
 * then below. If none is clear it keeps the first that fits the view and reports `clear: false`.
 */
export function placeLabel(here: Pt, segments: readonly Segment[], dots: readonly Pt[], size: LabelSize = LABEL): LabelPlace {
  const sides: ("start" | "end")[] = here.x > 168 ? ["end", "start"] : ["start", "end"];
  const candidates: LabelPlace[] = [];
  // Level with the point: the first baseline a little above it, so the two lines straddle it; then two thirds of a label up or down.
  const lift = -Math.floor((size.height - size.ascent) / 2);
  const hop = Math.round((size.height * 2) / 3);
  for (const dy of [0, -hop, hop]) {
    for (const anchor of sides) {
      const x = here.x + (anchor === "start" ? 12 : -12);
      const y = here.y + lift + dy;
      const box = { x: anchor === "start" ? x : x - size.width, y: y - size.ascent, width: size.width, height: size.height };
      if (box.x < 0 || box.x + box.width > VIEW.width || box.y < 0 || box.y + box.height > VIEW.height) continue;
      candidates.push({ anchor, x, y, box, clear: !boxHits(box, segments, dots) });
    }
  }
  return candidates.find((c) => c.clear) ?? { ...candidates[0], clear: false };
}

/** Where a setup's name goes beside its dot. */
export interface TagPlace {
  key: string;
  text: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  box: Box;
  /** A thin line from the dot to the name, drawn when the name had to sit well clear of its dot; null when it sits beside it. */
  leader: Segment | null;
}

/** A tag's text in viewBox units: its width per character and its line height (the small plot's 8.5 px mono is about 5.1 wide and 10 tall). */
export interface TagSize {
  charWidth?: number;
  height?: number;
  /** Whether a name well clear of its dot gets a leader line (the large plot draws them; the small plot's numbers do not). */
  leaders?: boolean;
}
const TAG_CHAR = 5.1;
const TAG_HEIGHT = 10;

const boxesTouch = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const boxHolds = (b: Box, p: Pt) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

/** Where a leader starts, out from its dot's centre: clear of the large plot's dot (r 2.6), and of a tick label that dot sits on. */
const LEADER_GAP = 4;

/** The line from a dot to the name at `spot`, when the name sits more than a line and a bit from it; it starts just off the dot and ends just short of the text. */
function leaderTo(at: Pt, spot: { x: number; y: number; anchor: TagPlace["anchor"] }, height: number): Segment | null {
  if (Math.abs(spot.y - at.y) <= 1.2 * height) return null;
  const end = { x: spot.anchor === "middle" ? spot.x : spot.x + (spot.anchor === "end" ? -3 : 3), y: spot.y + 1 };
  const len = Math.hypot(end.x - at.x, end.y - at.y);
  return [{ x: at.x + ((end.x - at.x) * LEADER_GAP) / len, y: at.y + ((end.y - at.y) * LEADER_GAP) / len }, end];
}

/**
 * Names for the plotted setups, each beside its dot where neither the frontier, another dot nor a
 * tag already placed (or a box in `taken`, such as the current setup's label) runs through it. `size` is the text's
 * width per character and line height in viewBox units; the spots tried scale with the height. A name that sits
 * well clear of its dot gets a leader line back to it: a spot whose leader would cross a box already used is passed
 * over (a box the dot itself sits in, such as the band under the axis, cannot be avoided and does not count), and a
 * later name keeps off the leaders drawn before it, and an earlier name off the spot a stuck later one falls back to
 * (see the retry below). A tag with no clear spot keeps the first candidate off the text
 * already placed (a line through a name reads; a name over a name does not), else its first candidate that fits the view.
 */
export function placeTags(tags: readonly { key: string; text: string; at: Pt }[], segments: readonly Segment[], dots: readonly Pt[], taken: readonly Box[] = [], size: TagSize = {}): TagPlace[] {
  // A name placed early can sit on the leader of the only spot left for a later one. When a name is stuck, the spot it
  // fell back to is reserved for it (every other name keeps off that box and its leader) and the names are placed
  // again, while that leaves fewer stuck.
  const reserved = new Map<string, Spot>();
  let best = placeInOrder(tags, segments, dots, taken, size, reserved);
  for (let i = 0; best.stuck && i < tags.length; i++) {
    const { tag, spot } = best.stuck;
    if (reserved.has(tag.key)) break;
    reserved.set(tag.key, spot);
    const next = placeInOrder(tags, segments, dots, taken, size, reserved);
    if (next.count >= best.count) break;
    best = next;
  }
  return best.placed;
}

type Spot = Omit<TagPlace, "key" | "text">;

/** The spots a name may take round its dot, in order of preference, each inside the view. */
function spotsFor(t: { text: string; at: Pt }, size: TagSize): Spot[] {
  const w = t.text.length * (size.charWidth ?? TAG_CHAR);
  const h = size.height ?? TAG_HEIGHT;
  // Offsets in tenths of the line height: the small plot's 10-unit line put the first spot 3 below the dot's level, the next 9 above.
  const u = h / 10;
  const spots: Spot[] = [];
  for (const [dx, dy, anchor] of [
    [8, 3, "start"],
    [-8, 3, "end"],
    [8, -9, "start"],
    [-8, -9, "end"],
    [8, 14, "start"],
    [-8, 14, "end"],
    [0, -9, "middle"],
    [0, 17, "middle"],
    [-8, -21, "end"],
    [8, -21, "start"],
    [0, -30, "middle"],
  ] as const) {
    const x = t.at.x + dx;
    const y = t.at.y + dy * u;
    const left = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
    const box = { x: left, y: y - 0.8 * h, width: w, height: h };
    if (box.x < 0 || box.x + box.width > VIEW.width || box.y < 0 || box.y + box.height > VIEW.height) continue;
    spots.push({ x, y, anchor, box, leader: size.leaders ? leaderTo(t.at, { x, y, anchor }, h) : null });
  }
  return spots;
}

/** One pass of `placeTags`, other names keeping off the spots in `reserved`: the places, how many names found no clear spot, and the first of them with the spot it fell back to. */
function placeInOrder(
  tags: readonly { key: string; text: string; at: Pt }[],
  segments: readonly Segment[],
  dots: readonly Pt[],
  taken: readonly Box[],
  size: TagSize,
  reserved: ReadonlyMap<string, Spot>,
): { placed: TagPlace[]; count: number; stuck: { tag: (typeof tags)[number]; spot: Spot } | null } {
  const placed: TagPlace[] = [];
  const used: Box[] = [...taken];
  const leaders: Segment[] = [];
  let count = 0;
  let stuck: { tag: (typeof tags)[number]; spot: Spot } | null = null;
  for (const t of tags) {
    const spots = spotsFor(t, size);
    const held = [...reserved].filter(([key]) => key !== t.key).map(([, s]) => s);
    const offText = spots.filter(
      (s) => !used.some((u) => boxesTouch(u, s.box)) && !leaders.some((l) => segmentHits(s.box, l)) && !held.some((r) => boxesTouch(r.box, s.box) || (r.leader && segmentHits(s.box, r.leader))),
    );
    const leaderClear = (s: Spot) => !s.leader || ![...used, ...held.map((r) => r.box)].some((u) => !boxHolds(u, t.at) && segmentHits(u, s.leader!));
    const clear = offText.find((s) => leaderClear(s) && !boxHits(s.box, segments, dots)) ?? offText.find(leaderClear);
    const pick = clear ?? offText[0] ?? spots[0];
    if (!pick) continue;
    if (!clear) {
      count++;
      stuck ??= { tag: t, spot: pick };
    }
    used.push(pick.box);
    if (pick.leader) leaders.push(pick.leader);
    placed.push({ key: t.key, text: t.text, ...pick });
  }
  return { placed, count, stuck };
}
