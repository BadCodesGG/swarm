/**
 * The scrubber's per-agent lanes as data: one row per agent, boxes for what it was doing and marks
 * for errors, retries, compactions and permission pauses, all on the 0..1 playback axis. Pure, so the
 * canvas that draws it and the hover that reads it share one plan.
 */

import type { AgentLane, SegmentKind } from "@/engine/inside/lanes";
import { clock, compact } from "@/engine/inside/format";

export interface LaneBox {
  row: number;
  kind: Exclude<SegmentKind, "idle">;
  x0: number;
  x1: number;
  agent: number;
  tool?: string;
  on?: "permission" | "prompt";
  /** Trace seconds long. */
  seconds: number;
}

export type MarkKind = "error" | "retry" | "compaction" | "pause";

export interface LaneMark {
  row: number;
  kind: MarkKind;
  x: number;
  agent: number;
  t: number;
  tool?: string;
  /** pause: seconds waited. retry: seconds after the failure. */
  seconds?: number;
  /** compaction: tokens before and after. */
  before?: number;
  after?: number;
}

export interface LanePlan {
  rows: number;
  boxes: LaneBox[];
  marks: LaneMark[];
}

export function planLanes(lanes: readonly AgentLane[], toFrac: (t: number) => number): LanePlan {
  const boxes: LaneBox[] = [];
  const marks: LaneMark[] = [];
  lanes.forEach((l, row) => {
    for (const s of l.segments) {
      if (s.kind === "idle") continue;
      boxes.push({ row, kind: s.kind, x0: toFrac(s.start), x1: toFrac(s.end), agent: l.agent, tool: s.tool, on: s.on, seconds: s.end - s.start });
    }
    for (const e of l.errors) marks.push({ row, kind: "error", x: toFrac(e.t), agent: l.agent, t: e.t, tool: e.tool });
    for (const r of l.retries) marks.push({ row, kind: "retry", x: toFrac(r.t), agent: l.agent, t: r.t, tool: r.tool, seconds: r.t - r.failedAt });
    for (const c of l.compactions) marks.push({ row, kind: "compaction", x: toFrac(c.t), agent: l.agent, t: c.t, before: c.preTokens, after: c.postTokens });
    for (const p of l.pauses) marks.push({ row, kind: "pause", x: toFrac(p.t), agent: l.agent, t: p.t, tool: p.tool, seconds: p.duration });
  });
  return { rows: lanes.length, boxes, marks };
}

/** CSS px of canvas height: about 2 px a lane, kept between a thin strip and a bounded block. */
export function laneHeight(rows: number): number {
  return Math.min(34, Math.max(12, rows * 2));
}

export type LaneHit = { type: "mark"; mark: LaneMark } | { type: "box"; box: LaneBox };

/**
 * What is under the pointer: `x` and `y` are fractions of the canvas, `widthPx` its CSS width. A mark
 * within 5 px along the axis (a compaction on any row, others on the row under the pointer) wins over a box.
 */
export function hitLane(plan: LanePlan, x: number, y: number, widthPx: number): LaneHit | null {
  if (plan.rows === 0) return null;
  const row = Math.min(plan.rows - 1, Math.max(0, Math.floor(y * plan.rows)));
  const reach = 5 / Math.max(widthPx, 1);
  let best: LaneMark | null = null;
  for (const m of plan.marks) {
    if (m.kind !== "compaction" && m.row !== row) continue;
    const d = Math.abs(m.x - x);
    if (d <= reach && (!best || d < Math.abs(best.x - x))) best = m;
  }
  if (best) return { type: "mark", mark: best };
  const box = plan.boxes.find((b) => b.row === row && x >= b.x0 && x <= b.x1);
  return box ? { type: "box", box } : null;
}

const secs = (s: number) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))}s`);

/** One line of plain text for the hover readout. `name` turns an agent id into its short name. */
export function describeHit(hit: LaneHit, name: (id: number) => string): string {
  if (hit.type === "box") {
    const b = hit.box;
    const who = name(b.agent);
    if (b.kind === "think") return `${who}: thinking, ${secs(b.seconds)}`;
    if (b.kind === "tool") return `${who}: ${b.tool ?? "tool"}, ${secs(b.seconds)}`;
    return b.on === "permission" ? `${who}: waited ${secs(b.seconds)} for you to allow ${b.tool ?? "a tool"}` : `${who}: waited ${secs(b.seconds)} for your next prompt`;
  }
  const m = hit.mark;
  const who = name(m.agent);
  switch (m.kind) {
    case "error":
      return `${who}: ${m.tool ?? "a call"} failed at ${clock(m.t)}`;
    case "retry":
      return `${who}: ${m.tool ?? "call"} tried again ${secs(m.seconds ?? 0)} after it failed (inferred)`;
    case "compaction":
      return `Compaction at ${clock(m.t)}: context ${compact(m.before ?? 0)} to ${compact(m.after ?? 0)} tokens`;
    case "pause":
      return `${who}: waited ${secs(m.seconds ?? 0)} for you to allow ${m.tool ?? "a tool"}`;
  }
}
