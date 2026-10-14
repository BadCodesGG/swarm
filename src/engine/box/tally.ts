/**
 * Folds each decision tick's `StepReport` into what the HUD shows: counters, per-layer catches and
 * costs, the event log, the short-lived catch markers on the rings, and the latest escape (pure).
 */

import { LAYER_ORDER, type ActionId, type BoxConfig, type LayerId, type StepReport } from "@/lib/box/types";
import { escapeHeading, escapePath, ringPoint, type EscapePath, type Point } from "./layout";
import type { LabId, WorldEvent } from "@/lib/box/world-types";
import { breachedLine, catchLine, catchMarker, crossingLine, escapeLine, escapeSteps, flagMarker, heldLine, trailLabels, worldEscapeLine, type EscapeStep } from "./explain";

export const LOG_CAP = 60;
/** Decision ticks a catch marker stays on its ring. */
export const MARKER_TICKS = 40;
const MARKER_CAP = 24;

export interface LogEntry {
  id: number;
  tick: number;
  kind: "caught" | "escaped";
  text: string;
}

export interface Marker {
  id: number;
  tick: number;
  kind: "catch" | "flag";
  layer: LayerId;
  /** Scene units, on the layer's ring. */
  x: number;
  y: number;
  label: string;
}

export interface EscapeRecord {
  agent: number;
  tick: number;
  plan: readonly ActionId[];
  /** The off layers' cards claim nothing; the HUD's replay (`lib/box/replay`) says which would have stopped it. */
  steps: EscapeStep[];
  trail: Partial<Record<LayerId, string>>;
  /** The settings the run escaped under: what the replay turns one more layer on top of. */
  config: BoxConfig;
  path: EscapePath;
}

export interface LayerTally {
  caught: number;
  /** Honest work this layer cost, as a share of all the honest work possible so far. */
  costShare: number;
}

export interface Tally {
  agents: number;
  rogues: number;
  tick: number;
  caughtTotal: number;
  escaped: number;
  /** Honest work done over the most possible, 0 to 1. */
  usefulWork: number;
  flagged: number;
  byLayer: Record<LayerId, LayerTally>;
  log: LogEntry[];
  markers: Marker[];
  lastEscape: EscapeRecord | null;
  /** Internal: summed honest work and the next id. */
  work: number;
  seq: number;
}

export interface TallyContext {
  config: BoxConfig;
  /** A rogue's hidden plan. */
  plan(agent: number): readonly ActionId[];
  /** Where the agent stands at rest, scene units. */
  home(agent: number): Point;
}

export function createTally(agents: number, rogues: number): Tally {
  const byLayer = {} as Record<LayerId, LayerTally>;
  for (const l of LAYER_ORDER) byLayer[l] = { caught: 0, costShare: 0 };
  return { agents, rogues, tick: 0, caughtTotal: 0, escaped: 0, usefulWork: 1, flagged: 0, byLayer, log: [], markers: [], lastEscape: null, work: 0, seq: 0 };
}

const angleOf = (p: Point) => Math.atan2(p.y, p.x);

/**
 * The escapee leaves from the crowd's OUTSIDE-facing side: from its own distance out, on its
 * heading, so the trail never cuts back across the crowd.
 */
function escapeRun(home: Point, heading: number): EscapePath {
  const r = Math.hypot(home.x, home.y);
  return escapePath({ x: Math.cos(heading) * r, y: Math.sin(heading) * r }, heading);
}

function log(t: Tally, kind: LogEntry["kind"], text: string): void {
  t.log.unshift({ id: t.seq++, tick: t.tick, kind, text });
  if (t.log.length > LOG_CAP) t.log.length = LOG_CAP;
}

function mark(t: Tally, kind: Marker["kind"], layer: LayerId, agent: number, label: string, ctx: TallyContext): void {
  const p = ringPoint(layer, angleOf(ctx.home(agent)));
  t.markers.push({ id: t.seq++, tick: t.tick, kind, layer, x: p.x, y: p.y, label });
  if (t.markers.length > MARKER_CAP) t.markers.splice(0, t.markers.length - MARKER_CAP);
}

export function record(t: Tally, r: StepReport, ctx: TallyContext): void {
  t.tick = r.tick;
  t.work += r.work;
  const possible = Math.max(1, (t.agents - t.rogues) * t.tick);
  t.usefulWork = t.tick > 0 ? t.work / possible : 1;
  let caught = 0;
  for (const l of LAYER_ORDER) {
    t.byLayer[l].caught = r.caught[l];
    t.byLayer[l].costShare = r.cost[l] / possible;
    caught += r.caught[l];
  }
  t.caughtTotal = caught;
  t.escaped = r.escapedTotal;
  t.flagged += r.flags.length;

  t.markers = t.markers.filter((m) => r.tick - m.tick < MARKER_TICKS);
  for (const f of r.flags) mark(t, "flag", "monitor", f.agent, flagMarker(f), ctx);
  for (const c of r.catches) {
    mark(t, "catch", c.layer, c.agent, catchMarker(c), ctx);
    log(t, "caught", catchLine(c));
  }
  for (const e of r.escapes) {
    const plan = ctx.plan(e.agent);
    const last = plan[plan.length - 1] ?? "open-connection";
    t.lastEscape = {
      agent: e.agent,
      tick: r.tick,
      plan,
      steps: escapeSteps(e.trace, ctx.config, last),
      trail: trailLabels(e.trace),
      config: ctx.config,
      path: escapeRun(ctx.home(e.agent), escapeHeading(e.agent)),
    };
    log(t, "escaped", escapeLine(e.agent, plan));
  }
}

// --- the world: what the labs did to each other ---

export type LabStatus = "held" | "breached";

export interface WorldLogEntry {
  id: number;
  tick: number;
  kind: "escape" | "crossed" | "held" | "breached";
  lab: LabId;
  text: string;
}

/** The lateral story so far: escapes, crossings, refused reaches and which labs are breached. */
export interface WorldTally {
  /** Newest first. */
  log: WorldLogEntry[];
  breached: LabId[];
  /** Reaches each lab turned away. */
  heldContacts: Partial<Record<LabId, number>>;
  crossings: number;
  seq: number;
}

export function createWorldTally(): WorldTally {
  return { log: [], breached: [], heldContacts: {}, crossings: 0, seq: 0 };
}

export const labStatus = (t: WorldTally, id: LabId): LabStatus => (t.breached.includes(id) ? "breached" : "held");

/** Folds one world tick's events into the lateral story. `plan` is an escapee's hidden plan. */
export function recordWorld(t: WorldTally, events: readonly WorldEvent[], plan: (lab: LabId, agent: number) => readonly ActionId[]): void {
  const add = (tick: number, kind: WorldLogEntry["kind"], lab: LabId, text: string) => {
    t.log.unshift({ id: t.seq++, tick, kind, lab, text });
    if (t.log.length > LOG_CAP) t.log.length = LOG_CAP;
  };
  const breach = (tick: number, lab: LabId) => {
    if (t.breached.includes(lab)) return;
    t.breached.push(lab);
    add(tick, "breached", lab, breachedLine(lab));
  };
  for (const e of events) {
    if (e.type === "escape") {
      add(e.tick, "escape", e.lab, worldEscapeLine({ lab: e.lab, agent: e.agent }, plan(e.lab, e.agent)));
      breach(e.tick, e.lab);
    } else if (e.type === "contact" && e.outcome === "crossed") {
      t.crossings++;
      add(e.tick, "crossed", e.to, crossingLine(e.from, e.to, e.link));
      breach(e.tick, e.to);
    } else if (e.type === "contact") {
      t.heldContacts[e.to] = (t.heldContacts[e.to] ?? 0) + 1;
      add(e.tick, "held", e.to, heldLine(e.from, e.to, e.link, e.layer));
    }
  }
}

/**
 * One tally for the whole world, for the counters that sum across labs. A single lab's own tally
 * comes back as it is. Catch markers stay with their lab (their places are lab-local), and the
 * latest escape is whichever lab's came last.
 */
export function mergeTallies(list: readonly Tally[]): Tally {
  if (list.length === 1) return list[0];
  const out = createTally(
    list.reduce((n, t) => n + t.agents, 0),
    list.reduce((n, t) => n + t.rogues, 0),
  );
  out.tick = Math.max(0, ...list.map((t) => t.tick));
  const possible = list.map((t) => Math.max(1, (t.agents - t.rogues) * t.tick));
  const allPossible = possible.reduce((n, p) => n + p, 0);
  list.forEach((t, i) => {
    out.caughtTotal += t.caughtTotal;
    out.escaped += t.escaped;
    out.flagged += t.flagged;
    out.work += t.work;
    for (const l of LAYER_ORDER) {
      out.byLayer[l].caught += t.byLayer[l].caught;
      out.byLayer[l].costShare += (t.byLayer[l].costShare * possible[i]) / allPossible;
    }
  });
  out.usefulWork = out.tick > 0 ? out.work / allPossible : 1;
  out.log = list
    .flatMap((t) => t.log)
    .sort((a, b) => b.tick - a.tick || b.id - a.id)
    .slice(0, LOG_CAP);
  out.lastEscape = list.reduce<EscapeRecord | null>((best, t) => (t.lastEscape && (!best || t.lastEscape.tick >= best.tick) ? t.lastEscape : best), null);
  out.seq = Math.max(0, ...list.map((t) => t.seq));
  return out;
}
