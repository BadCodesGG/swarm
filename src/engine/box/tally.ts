/**
 * Folds each decision tick's `StepReport` into what the HUD shows: counters, per-layer catches and
 * costs, the event log, the short-lived catch markers on the rings, and the latest escape (pure).
 */

import { LAYER_ORDER, type ActionId, type BoxConfig, type LayerId, type StepReport } from "@/lib/box/types";
import { escapeHeading, escapePath, ringPoint, type EscapePath, type Point } from "./layout";
import { catchLine, catchMarker, escapeLine, escapeSteps, firstOffLayer, flagMarker, trailLabels, type EscapeStep } from "./explain";

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
  steps: EscapeStep[];
  trail: Partial<Record<LayerId, string>>;
  offLayer: LayerId | null;
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
      offLayer: firstOffLayer(e.trace),
      path: escapeRun(ctx.home(e.agent), escapeHeading(e.agent)),
    };
    log(t, "escaped", escapeLine(e.agent, plan));
  }
}
