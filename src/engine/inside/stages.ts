/**
 * Stages of a run: PLAN, EXPLORE, BUILD, VERIFY, REVIEW, DELIVER.
 *
 * INFERRED. The trace has no notion of a stage. This is a heuristic read off the tool category mix
 * over time, and the HUD must label it as inferred. The run is cut into equal time windows; each
 * window scores against each stage by the share of its calls in the categories that stage usually
 * uses; then the best non-decreasing assignment of stages to windows is found (a stage never
 * recurs, and switching costs a little so stages do not flicker). The result is contiguous, in
 * order, covers [0, duration] and has at most six stages; a stage nothing pointed to is absent.
 * Pure.
 */

import type { SessionTrace, ToolCategory } from "@/lib/trace/types";

export const STAGE_IDS = ["plan", "explore", "build", "verify", "review", "deliver"] as const;
export type StageId = (typeof STAGE_IDS)[number];

export interface Stage {
  id: StageId;
  label: string;
  /** Trace seconds. */
  start: number;
  end: number;
}

const LABELS: Record<StageId, string> = {
  plan: "PLAN",
  explore: "EXPLORE",
  build: "BUILD",
  verify: "VERIFY",
  review: "REVIEW",
  deliver: "DELIVER",
};

/** Which categories point at which stage, and how strongly. */
const AFFINITY: Record<StageId, Partial<Record<ToolCategory, number>>> = {
  plan: { plan: 1, advisor: 1 },
  explore: { files: 0.8, web: 1, mcp: 0.4, other: 0.3 },
  build: { edit: 1, agents: 0.6 },
  verify: { shell: 1 },
  review: { files: 0.55, advisor: 0.4, agents: 0.3 },
  deliver: {},
};

export const STAGE_WINDOWS = 24;
/** Cost of moving to the next stage, so one odd window does not split a stage. */
const SWITCH_COST = 0.15;
/** The first window leans PLAN and the last leans DELIVER: a run opens by orienting and closes by reporting. */
const EDGE_BONUS = 0.4;

export function inferStages(trace: SessionTrace, windows = STAGE_WINDOWS): Stage[] {
  const duration = trace.duration;
  if (!(duration > 0) || windows < 1) return [];
  const mix = Array.from({ length: windows }, () => new Map<ToolCategory, number>());
  for (const e of trace.events) {
    if (e.kind !== "call" && e.kind !== "spawn") continue;
    const w = Math.min(windows - 1, Math.max(0, Math.floor((e.t / duration) * windows)));
    const c = e.category ?? "other";
    mix[w].set(c, (mix[w].get(c) ?? 0) + 1);
  }
  const S = STAGE_IDS.length;
  const score = mix.map((m, w) => {
    let total = 0;
    for (const n of m.values()) total += n;
    return STAGE_IDS.map((id, s) => {
      let v = 0;
      if (total > 0) for (const [c, n] of m) v += ((AFFINITY[id][c] ?? 0) * n) / total;
      if (w === 0 && s === 0) v += EDGE_BONUS;
      if (w === windows - 1 && s === S - 1) v += EDGE_BONUS;
      return v;
    });
  });

  // best[w][s]: highest total score with window w in stage s and stages never going back.
  const best = Array.from({ length: windows }, () => new Array<number>(S).fill(-Infinity));
  const from = Array.from({ length: windows }, () => new Array<number>(S).fill(0));
  for (let s = 0; s < S; s++) best[0][s] = score[0][s];
  for (let w = 1; w < windows; w++) {
    for (let s = 0; s < S; s++) {
      for (let p = 0; p <= s; p++) {
        const v = best[w - 1][p] + score[w][s] - (p === s ? 0 : SWITCH_COST);
        if (v > best[w][s]) {
          best[w][s] = v;
          from[w][s] = p;
        }
      }
    }
  }
  let s = 0;
  for (let k = 1; k < S; k++) if (best[windows - 1][k] > best[windows - 1][s]) s = k;
  const label = new Array<number>(windows);
  for (let w = windows - 1; w >= 0; w--) {
    label[w] = s;
    s = from[w][s];
  }

  const stages: Stage[] = [];
  for (let w = 0; w < windows; w++) {
    const id = STAGE_IDS[label[w]];
    const end = w === windows - 1 ? duration : ((w + 1) / windows) * duration;
    const last = stages[stages.length - 1];
    if (last && last.id === id) last.end = end;
    else stages.push({ id, label: LABELS[id], start: w === 0 ? 0 : (w / windows) * duration, end });
  }
  return stages;
}

/** The stage a trace time falls in; the last stage past the end, the first before the start, null when there are none. */
export function stageAt(stages: readonly Stage[], t: number): Stage | null {
  if (stages.length === 0) return null;
  for (const s of stages) if (t < s.end) return s;
  return stages[stages.length - 1];
}
