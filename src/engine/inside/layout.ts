/**
 * Where everything in Act 1 sits, as a pure function of the trace and the time. World units: the
 * orchestrator at the origin, the scene in the XY plane (the app tilts it slightly), about 100 px
 * per unit at the hero framing.
 *
 * - Stations sit on a ring in `STATIONS` order, anticlockwise from half past one on a clock face.
 * - An agent orbits its parent at its depth's radius, its angle set by its order among its siblings;
 *   it eases out of the parent at `spawnT` and folds back in over `FOLD_TIME` after `returnT`.
 * - A flight is a call (or a subagent launch) travelling from the caller to its station. Its start,
 *   end and time window are baked once, at emission; `flightPos` is the CPU twin of the particle
 *   vertex node, so both must use the same easing.
 */

import { MODEL_FAMILIES } from "@/lib/trace/categories";
import { particleLife } from "@/lib/trace/timeline";
import type { SessionTrace, ToolCategory } from "@/lib/trace/types";

export const STATIONS = ["web", "plan", "advisor", "agents", "edit", "mcp", "files", "shell"] as const satisfies readonly ToolCategory[];
export type StationCategory = (typeof STATIONS)[number];

export const STATION_RADIUS = 3;
export const BOUNDARY_RADIUS = 3.75;
/** Where a web probe ends, past the boundary. */
export const PROBE_RADIUS = 4.45;
/** Orbit radius by depth; index 0 (the orchestrator) is unused. Deeper levels reuse the last. */
export const ORBIT_RADIUS = [0, 1.55, 0.6, 0.36] as const;
/** Trace seconds an agent takes to ease out of its parent, and to fold back in. */
export const SPAWN_TIME = 3;
export const FOLD_TIME = 3;
/** First station's angle: half past one. */
const FIRST_ANGLE = Math.PI / 4;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Orbit drift, radians per trace second, by depth. */
const DRIFT = [0, 0.004, 0.012, 0.02];

export interface Pose {
  x: number;
  y: number;
  z: number;
  /** 0 absent, 1 fully there. */
  presence: number;
}

export const newPose = (): Pose => ({ x: 0, y: 0, z: 0, presence: 0 });

export function stationIndex(category: ToolCategory): number {
  return (STATIONS as readonly string[]).indexOf(category);
}

export function stationAngle(index: number): number {
  return FIRST_ANGLE + (index * 2 * Math.PI) / STATIONS.length;
}

export function stationPos(index: number, out: Pose): Pose {
  const a = stationAngle(index);
  out.x = Math.cos(a) * STATION_RADIUS;
  out.y = Math.sin(a) * STATION_RADIUS;
  out.z = 0;
  out.presence = 1;
  return out;
}

const fract = (x: number) => x - Math.floor(x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (u: number) => 1 - (1 - u) ** 3;
const easeIn = (u: number) => u * u * u;

/** Per trace: each agent's index among its parent's children (by id, which is spawn order). */
const siblingCache = new WeakMap<SessionTrace, Int32Array>();
function siblingIndex(trace: SessionTrace): Int32Array {
  let s = siblingCache.get(trace);
  if (s) return s;
  s = new Int32Array(trace.agents.length);
  const next = new Map<number, number>();
  for (const a of trace.agents) {
    const k = next.get(a.parent) ?? 0;
    s[a.id] = k;
    next.set(a.parent, k + 1);
  }
  siblingCache.set(trace, s);
  return s;
}

/** Offset from the parent while orbiting, at trace time `t`. */
function orbitOffset(trace: SessionTrace, id: number, t: number, out: Pose): void {
  const a = trace.agents[id];
  const k = siblingIndex(trace)[id];
  const d = Math.min(a.depth, ORBIT_RADIUS.length - 1);
  const r = ORBIT_RADIUS[d] * (0.85 + 0.3 * fract(k * 0.618034 + a.parent * 0.3));
  const angle = 0.9 + a.parent * 1.3 + k * GOLDEN + DRIFT[d] * t;
  out.x = Math.cos(angle) * r;
  out.y = Math.sin(angle) * r;
  out.z = Math.sin(k * 1.7 + a.parent) * r * 0.3;
}

const scratch: Pose[] = [];

/** Agent `id` at trace time `t`, written into `out`. */
export function agentPose(trace: SessionTrace, id: number, t: number, out: Pose): Pose {
  const a = trace.agents[id];
  if (!a || a.parent < 0) {
    out.x = out.y = out.z = 0;
    out.presence = 1;
    return out;
  }
  const fold = a.returned ? clamp01((t - a.returnT) / FOLD_TIME) : 0;
  // Parent first, into a scratch pose per depth so the recursion never clobbers it.
  const p = (scratch[a.depth] ??= newPose());
  agentPose(trace, a.parent, t, p);
  // The orbit holds still once the agent has returned, so it folds straight back in.
  orbitOffset(trace, id, a.returned ? Math.min(t, a.returnT) : t, offset);
  const s = easeOut(clamp01((t - a.spawnT) / SPAWN_TIME)) * (1 - easeIn(fold));
  out.x = p.x + offset.x * s;
  out.y = p.y + offset.y * s;
  out.z = p.z + offset.z * s;
  out.presence = t < a.spawnT || fold >= 1 ? 0 : 1;
  return out;
}

const offset = newPose();

/** A call or a subagent launch in flight from its caller to its station. Trace seconds. */
export interface Flight {
  event: number;
  agent: number;
  station: number;
  /** Index into `MODEL_FAMILIES` of the caller. */
  model: number;
  sx: number;
  sy: number;
  sz: number;
  ex: number;
  ey: number;
  ez: number;
  t0: number;
  t1: number;
}

const flightStart = newPose();
const flightEnd = newPose();

/** The flight for event `index`, or null if it does not fly (results, turns, tools with no station). */
export function makeFlight(trace: SessionTrace, index: number, rate: number): Flight | null {
  const e = trace.events[index];
  if (!e) return null;
  let station = -1;
  if (e.kind === "spawn") station = stationIndex("agents");
  else if (e.kind === "call" && e.category) station = stationIndex(e.category);
  if (station < 0) return null;
  agentPose(trace, e.agent, e.t, flightStart);
  stationPos(station, flightEnd);
  const model = MODEL_FAMILIES.indexOf(trace.agents[e.agent]?.model ?? "other");
  return {
    event: index,
    agent: e.agent,
    station,
    model,
    sx: flightStart.x,
    sy: flightStart.y,
    sz: flightStart.z,
    ex: flightEnd.x,
    ey: flightEnd.y,
    ez: flightEnd.z,
    t0: e.t,
    t1: e.t + particleLife(rate) * Math.max(rate, 0),
  };
}

/** Fraction of the way along a flight at progress `u` in [0, 1]: decelerating into the station. */
export function flightEase(u: number): number {
  const v = clamp01(u);
  return 1 - (1 - v) * (1 - v);
}

/** The flight's head at trace time `t`; false (and `out` untouched) outside its window. */
export function flightPos(f: Flight, t: number, out: Pose): boolean {
  if (t < f.t0 || t > f.t1) return false;
  const k = flightEase((t - f.t0) / Math.max(f.t1 - f.t0, 1e-9));
  out.x = f.sx + (f.ex - f.sx) * k;
  out.y = f.sy + (f.ey - f.sy) * k;
  out.z = f.sz + (f.ez - f.sz) * k;
  out.presence = 1;
  return true;
}

export interface StationCounts {
  /** Calls (and launches, for `agents`) made at or before trace time `t`. */
  at(station: number, t: number): number;
}

export function stationCounts(trace: SessionTrace): StationCounts {
  const times: number[][] = STATIONS.map(() => []);
  for (const e of trace.events) {
    const s = e.kind === "spawn" ? stationIndex("agents") : e.kind === "call" && e.category ? stationIndex(e.category) : -1;
    if (s >= 0) times[s].push(e.t);
  }
  return {
    at(station, t) {
      const a = times[station];
      if (!a) return 0;
      let lo = 0;
      let hi = a.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (a[mid] > t) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    },
  };
}

/** A web call reaching out past the boundary, from its call to its result. */
export interface WebProbe {
  event: number;
  agent: number;
  t0: number;
  t1: number;
  tool: string;
  /** The call's excerpt (a sample's query), or empty. */
  query: string;
  /** Where the probe ends, past the boundary. */
  ex: number;
  ey: number;
  ez: number;
}

export function webProbes(trace: SessionTrace): WebProbe[] {
  const resultOf = new Map<number, number>();
  trace.events.forEach((e) => {
    if (e.kind === "result" && e.call !== undefined) resultOf.set(e.call, e.t);
  });
  const web = stationAngle(stationIndex("web"));
  const out: WebProbe[] = [];
  trace.events.forEach((e, i) => {
    if (e.kind !== "call" || e.category !== "web") return;
    const k = out.length;
    // Fan the probes across a 32 degree arc around the web station so neighbours do not overlap.
    const angle = web + (fract(k * 0.618034 + 0.25) - 0.5) * ((32 * Math.PI) / 180);
    out.push({
      event: i,
      agent: e.agent,
      t0: e.t,
      t1: Math.max(resultOf.get(i) ?? e.t, e.t),
      tool: e.tool ?? "web",
      query: e.excerpt ?? "",
      ex: Math.cos(angle) * PROBE_RADIUS,
      ey: Math.sin(angle) * PROBE_RADIUS,
      ez: 0,
    });
  });
  return out;
}

/** Trace seconds a station takes to go dark after its last call returns. */
export const ACTIVE_FADE = 1.5;
/** A subagent launch keeps the agents station lit this long. */
const LAUNCH_LIT = 2;

export interface StationActivity {
  /** 1 while a call to the station is out, fading to 0 over `ACTIVE_FADE` after the last returns. */
  at(station: number, t: number): number;
}

export function stationActivity(trace: SessionTrace): StationActivity {
  const resultOf = new Map<number, number>();
  trace.events.forEach((e) => {
    if (e.kind === "result" && e.call !== undefined) resultOf.set(e.call, e.t);
  });
  const starts: number[][] = STATIONS.map(() => []);
  // Running maximum of the end times, so "is any interval starting by t still open" is one search.
  const maxEnd: number[][] = STATIONS.map(() => []);
  trace.events.forEach((e, i) => {
    let s = -1;
    let end = e.t;
    if (e.kind === "spawn") {
      s = stationIndex("agents");
      end = e.t + LAUNCH_LIT;
    } else if (e.kind === "call" && e.category) {
      s = stationIndex(e.category);
      end = Math.max(resultOf.get(i) ?? e.t, e.t);
    }
    if (s < 0) return;
    const m = maxEnd[s];
    starts[s].push(e.t);
    m.push(Math.max(end, m.length ? m[m.length - 1] : -Infinity));
  });
  return {
    at(station, t) {
      const a = starts[station];
      if (!a) return 0;
      let lo = 0;
      let hi = a.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (a[mid] > t) hi = mid;
        else lo = mid + 1;
      }
      if (lo === 0) return 0;
      const end = maxEnd[station][lo - 1];
      if (t <= end) return 1;
      return clamp01(1 - (t - end) / ACTIVE_FADE);
    },
  };
}

/**
 * The subagent worth selecting for a still at `t`: a running one with a running child of its own,
 * else any running one (more tool calls first, then the earliest); -1 when none runs.
 */
export function featuredAgent(trace: SessionTrace, t: number): number {
  const running = (id: number) => {
    const a = trace.agents[id];
    return a.parent >= 0 && a.spawnT + SPAWN_TIME <= t && (!a.returned || t < a.returnT);
  };
  let best = -1;
  let bestScore = -Infinity;
  for (const a of trace.agents) {
    if (!running(a.id)) continue;
    const parentOfRunning = trace.agents.some((c) => c.parent === a.id && running(c.id));
    const score = (parentOfRunning ? 1e9 : 0) + a.toolCalls;
    if (score > bestScore) {
      best = a.id;
      bestScore = score;
    }
  }
  return best;
}
