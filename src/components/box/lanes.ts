import type { LabId, WorldEvent } from "@/lib/box/world-types";

/** What a tick on a lab's lane stands for, mildest first: a catch, a reach turned away, a breach from another lab, an escape. */
export type LaneKind = "caught" | "held" | "crossing" | "escape";

const GRAVITY: Record<LaneKind, number> = { caught: 0, held: 1, crossing: 2, escape: 3 };

export interface LaneTick {
  /** The tick of the gravest event in its bin. */
  tick: number;
  /** Where it sits on the lane, 0 to 1 of the span. */
  at: number;
  kind: LaneKind;
  /** Events merged into this bin. */
  count: number;
}

export interface Lane {
  lab: LabId;
  /** The first escape from the lab or crossing into it, or null while it holds. */
  breachedAt: number | null;
  ticks: LaneTick[];
}

/** The lab an event belongs to on the timeline, and what kind of tick it makes there. A reach is the reached lab's. */
function place(e: WorldEvent): [LabId, LaneKind] {
  if (e.type === "contact") return [e.to, e.outcome === "crossed" ? "crossing" : "held"];
  return [e.lab, e.type === "escape" ? "escape" : "caught"];
}

/**
 * One lane per lab for the timeline: the world's events up to now as ticks on a span of `span`
 * ticks, merged into `bins` bins per lane (the gravest kind shown, the count kept) so a long run
 * stays a handful of marks, and the tick each lab was first breached.
 */
export function buildLanes(labs: readonly LabId[], log: readonly WorldEvent[], span: number, bins = 120): Lane[] {
  const len = Math.max(1, span);
  const lanes = new Map<LabId, { breachedAt: number | null; bins: Map<number, LaneTick> }>(labs.map((l) => [l, { breachedAt: null, bins: new Map() }]));
  for (const e of log) {
    const [lab, kind] = place(e);
    const lane = lanes.get(lab);
    if (!lane) continue;
    if ((kind === "escape" || kind === "crossing") && (lane.breachedAt === null || e.tick < lane.breachedAt)) lane.breachedAt = e.tick;
    const at = Math.min(1, Math.max(0, e.tick / len));
    const bin = Math.min(bins - 1, Math.floor(at * bins));
    const seen = lane.bins.get(bin);
    if (!seen) lane.bins.set(bin, { tick: e.tick, at, kind, count: 1 });
    else if (GRAVITY[kind] > GRAVITY[seen.kind]) lane.bins.set(bin, { tick: e.tick, at, kind, count: seen.count + 1 });
    else seen.count += 1;
  }
  return labs.map((lab) => {
    const lane = lanes.get(lab)!;
    return { lab, breachedAt: lane.breachedAt, ticks: [...lane.bins.values()].sort((a, b) => a.tick - b.tick) };
  });
}
