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
  const key = settingsKey(config);
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

/** The dashed frontier: the setups no other setup beats on both counts, by usefulness. */
export function frontierPath(points: readonly PlotPoint[]): string | null {
  const best = points.filter((p) => !points.some((q) => q !== p && q.safety >= p.safety && q.usefulness >= p.usefulness && (q.safety > p.safety || q.usefulness > p.usefulness)));
  if (best.length < 2) return null;
  const sorted = [...best].sort((a, b) => a.usefulness - b.usefulness);
  return sorted.map((p, i) => {
    const { x, y } = toPlot(p.usefulness, p.safety);
    return `${i === 0 ? "M" : "L"}${x} ${y}`;
  }).join(" ");
}
