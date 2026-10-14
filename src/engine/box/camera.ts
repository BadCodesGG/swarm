/**
 * The Box's camera (pure). The director frames the story: all the labs, then the lab where an agent
 * escaped, then the pair a crossing runs between, then all of them again. Its pose is a function of
 * the world's events and a (fractional) tick alone, so scrubbing the tick back flies the camera
 * back, and the same tick always shows the same frame. Under reduced motion it is the overview.
 *
 * `schedule` is also the story's clock for the scene: an escape's flight and a crossing's pulse run
 * over the ticks it gives them, one after another, so the camera and the animation never disagree.
 */

import type { LabId, WorldEvent } from "@/lib/box/world-types";
import { worldBounds, type LabFrame } from "./world-layout";

/** The visible rectangle in world units: centre and size. */
export interface Pose {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The plain Box's frame: the 760x560 design frame about the origin. */
export const LEGACY_POSE: Pose = { x: 0, y: 0, w: 760, h: 560 };

/** Ticks an escape's flight out of its lab takes (2.6 s at 10 Hz), and a crossing's run along its link. */
export const ESCAPE_TICKS = 26;
export const CROSS_TICKS = 18;
/** Ticks the camera stays on a beat after it ends, before it pulls back. */
export const HOLD_TICKS = 24;
/** Ticks a move between two poses takes, ending at the later pose's tick. */
export const TRAVEL_TICKS = 18;
/** Ticks before a beat starts that the camera is already there. */
const LEAD_TICKS = 2;

/** World units round the rings the overview keeps clear, enough for an escape trail to run out. */
const OVERVIEW_PAD = 80;
const FOCUS = { w: 520, h: 420 } as const;
const PAIR_PAD = 70;

export function overviewPose(frames: readonly LabFrame[]): Pose {
  if (frames.length <= 1) return LEGACY_POSE;
  const b = worldBounds(frames, OVERVIEW_PAD);
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, w: b.x1 - b.x0, h: b.y1 - b.y0 };
}

export function focusPose(frame: LabFrame): Pose {
  return { x: frame.x, y: frame.y, w: FOCUS.w, h: FOCUS.h };
}

/** Both labs of a crossing and the link between them. */
export function pairPose(a: LabFrame, b: LabFrame): Pose {
  const box = worldBounds([a, b], PAIR_PAD);
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, w: Math.max(box.x1 - box.x0, FOCUS.w), h: Math.max(box.y1 - box.y0, FOCUS.h) };
}

export type StoryKind = "escape" | "crossed" | "held";

/** One beat of the story: when it happened, and the ticks it plays over. */
export interface StoryItem {
  kind: StoryKind;
  /** The lab it happened at: where the agent got out, or the lab the reach came into. */
  lab: LabId;
  /** The lab a reach came from. */
  from?: LabId;
  /** The tick of the event itself. */
  tick: number;
  /** The ticks its animation runs over, `start` to `end`. */
  start: number;
  end: number;
  /** Index into the events given. */
  index: number;
}

/**
 * Lines the events up on the story's clock: an escape plays from its own tick; a crossing or a
 * refused reach waits for its agent's flight to finish and for the previous reach to end, so the
 * labs are visited one after another.
 */
export function schedule(events: readonly WorldEvent[]): StoryItem[] {
  const items: StoryItem[] = [];
  let reachEnd = -Infinity;
  events.forEach((e, index) => {
    if (e.type === "escape") {
      items.push({ kind: "escape", lab: e.lab, tick: e.tick, start: e.tick, end: e.tick + ESCAPE_TICKS, index });
    } else if (e.type === "contact") {
      const flight = items.find((i) => i.kind === "escape" && i.lab === e.from.lab && (events[i.index] as { agent: number }).agent === e.from.agent);
      const start = Math.max(e.tick, flight?.end ?? e.tick, reachEnd);
      reachEnd = start + CROSS_TICKS;
      items.push({ kind: e.outcome === "crossed" ? "crossed" : "held", lab: e.to, from: e.from.lab, tick: e.tick, start, end: reachEnd, index });
    }
  });
  return items;
}

export interface Key {
  tick: number;
  pose: Pose;
}

/** The poses the director visits, in tick order. */
export function cameraKeys(frames: readonly LabFrame[], items: readonly StoryItem[]): Key[] {
  const overview = overviewPose(frames);
  const keys: Key[] = [{ tick: 0, pose: overview }];
  if (frames.length < 2) return keys;
  const frame = (id: LabId) => frames.find((f) => f.id === id);
  for (const item of [...items].sort((a, b) => a.start - b.start)) {
    const at = frame(item.lab);
    if (!at) continue;
    const from = item.from ? frame(item.from) : undefined;
    const pose = item.kind === "escape" || !from ? focusPose(at) : pairPose(from, at);
    const tick = Math.max(item.start - LEAD_TICKS, keys[keys.length - 1].tick + 1);
    keys.push({ tick, pose });
  }
  if (keys.length > 1) {
    const last = items.reduce((n, i) => Math.max(n, i.end), 0);
    keys.push({ tick: Math.max(last + HOLD_TICKS + TRAVEL_TICKS, keys[keys.length - 1].tick + TRAVEL_TICKS), pose: overview });
  }
  return keys;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export function mixPose(a: Pose, b: Pose, t: number): Pose {
  const k = smooth(Math.min(1, Math.max(0, t)));
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w * (b.w / a.w) ** k, h: a.h * (b.h / a.h) ** k };
}

/** The pose at a tick: it holds each key's pose, then eases to the next over the `TRAVEL_TICKS` before that key's tick. */
export function poseAt(keys: readonly Key[], tick: number): Pose {
  if (tick <= keys[0].tick) return keys[0].pose;
  for (let i = 1; i < keys.length; i++) {
    const prev = keys[i - 1];
    const next = keys[i];
    if (tick > next.tick) continue;
    const travel = Math.min(TRAVEL_TICKS, next.tick - prev.tick);
    return mixPose(prev.pose, next.pose, (tick - (next.tick - travel)) / travel);
  }
  return keys[keys.length - 1].pose;
}

/** The beat the camera is on at a tick: from its move in until its hold runs out. Null on the overview. */
export function activeItem(items: readonly StoryItem[], tick: number): StoryItem | null {
  let hit: StoryItem | null = null;
  for (const i of items) if (tick >= i.start - LEAD_TICKS - TRAVEL_TICKS / 2 && tick <= i.end + HOLD_TICKS && (!hit || i.start > hit.start)) hit = i;
  return hit;
}

export interface Director {
  items: readonly StoryItem[];
  keys: readonly Key[];
  overview: Pose;
  /** The pose at a tick; `reduced` keeps the overview. */
  pose(tick: number, reduced?: boolean): Pose;
}

export function createDirector(frames: readonly LabFrame[], events: readonly WorldEvent[]): Director {
  const items = schedule(events);
  const keys = cameraKeys(frames, items);
  const overview = overviewPose(frames);
  return { items, keys, overview, pose: (tick, reduced = false) => (reduced ? overview : poseAt(keys, tick)) };
}
