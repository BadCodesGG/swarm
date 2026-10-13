/**
 * What the Box's live regions say (pure): the caught and escaped counts, spoken when they change but
 * at most once per gap so a 10 Hz tick never floods a screen reader, an escape or a reset at once;
 * and one line per finished trial run.
 */

import type { TrialSummary } from "@/lib/box/types";

export interface Said {
  caught: number;
  escaped: number;
  /** When it was said, ms. */
  at: number;
}

export const countsLine = (caught: number, escaped: number) => `${caught.toLocaleString("en-US")} caught, ${escaped.toLocaleString("en-US")} escaped.`;

/** Whether `next` should be said now, given what was last said. */
export function nextAnnouncement(last: Said, next: { caught: number; escaped: number }, now: number, gapMs: number): boolean {
  if (next.caught === last.caught && next.escaped === last.escaped) return false;
  if (next.escaped !== last.escaped || next.caught < last.caught) return true;
  return now - last.at >= gapMs;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const trialsLine = (s: TrialSummary) =>
  `${s.trials} trials done: escapes stopped in ${pct(s.safety)} of them, ${pct(s.usefulness)} of useful work kept.`;
