/**
 * What the scene shows at a story tick (pure). The world's events are given their ticks by
 * `camera.schedule`; this turns a (fractional) tick into how far each animation has got, when a
 * numbered marker appears and when a lab starts to read as breached. The same tick always gives
 * the same picture, so replaying or scrubbing never disagrees with the camera.
 */

import { ESCAPE_BEATS } from "@/lib/box/breakout";
import type { LabId } from "@/lib/box/world-types";
import { CROSS_TICKS, ESCAPE_TICKS, type StoryItem } from "./camera";

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** How far along the escape's run out of its lab is (0 before it starts, 1 once parked). */
export const escapeProgress = (item: StoryItem, tick: number): number => easeOut(clamp01((tick - item.start) / ESCAPE_TICKS));

/** A reach turned away stops this far along the conduit, short of the far lab's edge. */
export const HELD_STOP = 0.9;
/** Ticks a pulse stays drawn after it lands. */
export const LINGER_TICKS = 6;

/** How far along its conduit a crossing's pulse is, or null while it is not on show. */
export function reachProgress(item: StoryItem, tick: number): number | null {
  if (tick < item.start || tick > item.end + LINGER_TICKS) return null;
  const t = clamp01((tick - item.start) / CROSS_TICKS);
  return item.kind === "held" ? t * HELD_STOP : t;
}

/** Whether a reach has landed by this tick (a crossing got in, a refusal was felt). */
export const reachLanded = (item: StoryItem, tick: number): boolean => tick >= item.end - 1;

/**
 * The tick a step's numbered marker appears: an escape's sub-steps one after another as the agent
 * runs out (the last at 70% of the flight), a crossing or a refusal as it lands.
 */
export const markerTick = (item: StoryItem, beat = 0): number =>
  item.kind === "escape" ? item.start + Math.round(ESCAPE_TICKS * (0.7 - 0.16 * (ESCAPE_BEATS - 1 - beat))) : item.end - 3;

/** One numbered marker: the beat of the story it belongs to and, for an escape, which sub-step. */
export interface MarkerSlot {
  item: StoryItem;
  beat: number | null;
}

/**
 * The numbered markers in order, matching `breakoutSteps`: an escape is `ESCAPE_BEATS` markers, a
 * crossing one, and the first refused reach into each lab one; later refusals there carry none.
 */
export function markerSlots(items: readonly StoryItem[]): MarkerSlot[] {
  const slots: MarkerSlot[] = [];
  const refused = new Set<LabId>();
  for (const item of items) {
    if (item.kind === "escape") for (let beat = 0; beat < ESCAPE_BEATS; beat++) slots.push({ item, beat });
    else if (item.kind === "crossed") slots.push({ item, beat: null });
    else if (!refused.has(item.lab)) {
      refused.add(item.lab);
      slots.push({ item, beat: null });
    }
  }
  return slots;
}

/**
 * The tick each lab starts to read as breached: when its agent is out, or the crossing lands. After a
 * replay to `replayed`, an event at or before that tick already happened, so its lab reads breached
 * from the replayed tick on instead of waiting for its queued pulse; a live run passes nothing.
 */
export function breachTicks(items: readonly StoryItem[], replayed = -Infinity): Partial<Record<LabId, number>> {
  const out: Partial<Record<LabId, number>> = {};
  for (const i of items) {
    if (i.kind === "held") continue;
    const played = i.kind === "escape" ? i.start + Math.round(ESCAPE_TICKS * 0.75) : i.end;
    const at = i.tick <= replayed ? Math.min(played, replayed) : played;
    out[i.lab] = Math.min(out[i.lab] ?? Infinity, at);
  }
  return out;
}

/** The first tick at which every beat so far has played out and settled. */
export const settledTick = (items: readonly StoryItem[]): number => items.reduce((n, i) => Math.max(n, i.end + LINGER_TICKS + 1), 0);
