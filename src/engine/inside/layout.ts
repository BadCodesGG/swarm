/**
 * Where everything in Act 1 sits, as a pure function of the trace and the time. World units: the
 * orchestrator at the origin in a large dark space; a cloud is about a unit across, so clusters sit
 * several cloud radii apart and the camera has to travel between them.
 *
 * - Stations hang on a wide, shallow shell around the orchestrator in `STATIONS` order, each at its
 *   own depth (so no two are coplanar), their spots nudged by a fixed `fork` stream.
 * - An agent orbits its parent at its depth's radius, in a direction (not just an angle) set by its
 *   order among its siblings, so children spread through depth; it eases out of the parent at
 *   `spawnT` and folds back in over `FOLD_TIME` after `returnT`.
 * - A flight is a call (or a subagent launch) travelling from the caller to its station. Its start,
 *   end and time window are baked once, at emission; `flightPos` is the CPU twin of the particle
 *   vertex node, so both must use the same easing.
 */

import { MODEL_FAMILIES } from "@/lib/trace/categories";
import { particleLife, type Timeline } from "@/lib/trace/timeline";
import type { SessionTrace, ToolCategory } from "@/lib/trace/types";
import { fork } from "@/lib/rng";

export const STATIONS = ["web", "plan", "advisor", "agents", "edit", "mcp", "files", "shell"] as const satisfies readonly ToolCategory[];
export type StationCategory = (typeof STATIONS)[number];

/** About how far the stations sit from the orchestrator. */
export const STATION_RADIUS = 15;
/** The ring a human prompt contracts from, around the orchestrator. */
export const PULSE_RADIUS = 7;
/** How far a web probe reaches past its station. */
export const PROBE_LENGTH = 4.5;
/** Orbit radius by depth; index 0 (the orchestrator) is unused. Deeper levels reuse the last. */
export const ORBIT_RADIUS = [0, 6.5, 3.2, 1.9] as const;
/** A `fork` stream no other part of the project draws from: the stations' fixed jitter. */
const STATION_STREAM = 0x57a7_0000;
/** Each station's depth (z) in world units: alternating near and far of the orchestrator. */
const STATION_DEPTH = [-5, 6, -8, 4, -6, 8, -4, 7] as const;
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

const stationSpots = STATIONS.map((_, i) => {
  const a = stationAngle(i);
  const r = fork(STATION_STREAM, i);
  const reach = STATION_RADIUS * (0.92 + r() * 0.16);
  return { x: Math.cos(a) * reach * 1.15, y: Math.sin(a) * reach * 0.68, z: STATION_DEPTH[i] * (0.85 + r() * 0.3) };
});

export function stationPos(index: number, out: Pose): Pose {
  const spot = stationSpots[index] ?? stationSpots[0];
  out.x = spot.x;
  out.y = spot.y;
  out.z = spot.z;
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
  // A direction on a sphere, a little flattened vertically: the elevation comes from the sibling
  // index, the longitude drifts, so children fan out through depth instead of round a disc.
  const lift = (fract(k * 0.754878 + a.parent * 0.569840) - 0.5) * 1.3;
  const ring = Math.sqrt(1 - lift * lift);
  out.x = Math.cos(angle) * ring * r;
  out.y = lift * r;
  out.z = Math.sin(angle) * ring * r;
}

/**
 * Per trace: every agent's last computed pose and the time it was computed for. A frame poses each
 * agent several times (agents, tethers, picking) at one `t`, so a pose's ancestors are computed
 * once per frame, not once per descendant: a deep spawn chain stays linear.
 */
interface PoseMemo {
  at: Float64Array;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  presence: Uint8Array;
  /** Ancestors waiting to be posed, deepest first. */
  stack: Int32Array;
}

const poseMemo = new WeakMap<SessionTrace, PoseMemo>();

function memoFor(trace: SessionTrace): PoseMemo {
  let m = poseMemo.get(trace);
  if (m) return m;
  const n = trace.agents.length;
  m = { at: new Float64Array(n).fill(NaN), x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), presence: new Uint8Array(n), stack: new Int32Array(n) };
  poseMemo.set(trace, m);
  return m;
}

const isRoot = (trace: SessionTrace, id: number) => {
  const a = trace.agents[id];
  return !a || a.parent < 0;
};

/** Agent `id` at trace time `t`, written into `out`. */
export function agentPose(trace: SessionTrace, id: number, t: number, out: Pose): Pose {
  if (isRoot(trace, id)) {
    out.x = out.y = out.z = 0;
    out.presence = 1;
    return out;
  }
  const m = memoFor(trace);
  if (m.at[id] !== t) {
    // Climb to the nearest ancestor already posed at t (or the root), then pose back down.
    let n = 0;
    let k = id;
    while (!isRoot(trace, k) && m.at[k] !== t && n < m.stack.length) {
      m.stack[n++] = k;
      k = trace.agents[k].parent;
    }
    let px = 0;
    let py = 0;
    let pz = 0;
    if (!isRoot(trace, k)) {
      px = m.x[k];
      py = m.y[k];
      pz = m.z[k];
    }
    for (let j = n - 1; j >= 0; j--) {
      const c = m.stack[j];
      const a = trace.agents[c];
      const fold = a.returned ? clamp01((t - a.returnT) / FOLD_TIME) : 0;
      // The orbit holds still once the agent has returned, so it folds straight back in.
      orbitOffset(trace, c, a.returned ? Math.min(t, a.returnT) : t, offset);
      const s = easeOut(clamp01((t - a.spawnT) / SPAWN_TIME)) * (1 - easeIn(fold));
      px = m.x[c] = px + offset.x * s;
      py = m.y[c] = py + offset.y * s;
      pz = m.z[c] = pz + offset.z * s;
      m.presence[c] = t < a.spawnT || fold >= 1 ? 0 : 1;
      m.at[c] = t;
    }
  }
  out.x = m.x[id];
  out.y = m.y[id];
  out.z = m.z[id];
  out.presence = m.presence[id];
  return out;
}

const offset = newPose();

/** Per trace: where each agent was at its `returnT` (x, y, z per agent; NaN until asked). */
const returnMemo = new WeakMap<SessionTrace, Float64Array>();

/**
 * Where agent `id` was when it returned (the end of its trail), written into `out`. Fixed for the
 * trace, so it is posed once and kept: asking for it never disturbs the current frame's poses.
 */
export function returnPose(trace: SessionTrace, id: number, out: Pose): Pose {
  let m = returnMemo.get(trace);
  if (!m) {
    m = new Float64Array(trace.agents.length * 3).fill(NaN);
    returnMemo.set(trace, m);
  }
  const a = trace.agents[id];
  if (!a) return agentPose(trace, id, 0, out);
  if (Number.isNaN(m[id * 3])) {
    agentPose(trace, id, a.returnT, out);
    m[id * 3] = out.x;
    m[id * 3 + 1] = out.y;
    m[id * 3 + 2] = out.z;
  }
  out.x = m[id * 3];
  out.y = m[id * 3 + 1];
  out.z = m[id * 3 + 2];
  out.presence = 1;
  return out;
}

/**
 * A call or a subagent launch in flight from its caller to its station. `t0` and `t1` are playback
 * seconds (after idle compression), which run at `rate` per real second even across a cut.
 */
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
export function makeFlight(timeline: Timeline, index: number, rate: number): Flight | null {
  const { trace } = timeline;
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
    t0: timeline.arrays.playback[index],
    t1: timeline.arrays.playback[index] + particleLife(rate) * Math.max(rate, 0),
  };
}

/** Fraction of the way along a flight at progress `u` in [0, 1]: decelerating into the station. */
export function flightEase(u: number): number {
  const v = clamp01(u);
  return 1 - (1 - v) * (1 - v);
}

/** The flight's head at playback time `t`; false (and `out` untouched) outside its window. */
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
  const web = stationPos(stationIndex("web"), newPose());
  const outward = Math.atan2(web.y, web.x);
  const reach = Math.hypot(web.x, web.y, web.z) || 1;
  const out: WebProbe[] = [];
  trace.events.forEach((e, i) => {
    if (e.kind !== "call" || e.category !== "web") return;
    const k = out.length;
    // Fan the probes across a 32 degree arc around the web station so neighbours do not overlap.
    const angle = outward + (fract(k * 0.618034 + 0.25) - 0.5) * ((32 * Math.PI) / 180);
    out.push({
      event: i,
      agent: e.agent,
      t0: e.t,
      t1: Math.max(resultOf.get(i) ?? e.t, e.t),
      tool: e.tool ?? "web",
      query: e.excerpt ?? "",
      ex: web.x + Math.cos(angle) * PROBE_LENGTH,
      ey: web.y + Math.sin(angle) * PROBE_LENGTH,
      ez: web.z + (web.z / reach) * PROBE_LENGTH,
    });
  });
  return out;
}

/** Trace seconds a probe takes to reach its end. */
export const PROBE_GROW = 1.2;

/**
 * Indices of the probes out at `t`, in list order, at most `max`. A probe still growing counts as
 * much as one that has reached its end, so the boundary's sprites (a flash and an end dot each)
 * never outnumber `2 * max`.
 */
export function liveProbes(probes: readonly WebProbe[], t: number, max: number, out: number[]): number[] {
  out.length = 0;
  for (let i = 0; i < probes.length && out.length < max; i++) {
    const p = probes[i];
    if (t >= p.t0 && t <= p.t1) out.push(i);
  }
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
  // One pass marks every agent with a running child of its own, so the pick stays linear.
  const hasRunningChild = new Uint8Array(trace.agents.length);
  for (const c of trace.agents) if (c.parent >= 0 && running(c.id)) hasRunningChild[c.parent] = 1;
  let best = -1;
  let bestScore = -Infinity;
  for (const a of trace.agents) {
    if (!running(a.id)) continue;
    const score = (hasRunningChild[a.id] ? 1e9 : 0) + a.toolCalls;
    if (score > bestScore) {
      best = a.id;
      bestScore = score;
    }
  }
  return best;
}

/** The part of the canvas the scene is framed in, CSS px. */
export interface SceneFrame {
  top: number;
  height: number;
  /** Defaults to the whole width. */
  left?: number;
  width?: number;
  /**
   * "boundary" (the phone band): the boundary ring nearly fills the frame and probes run past it.
   * "stations" (desktop, between the panels): the station ring and its labels fit inside it.
   */
  fit?: "boundary" | "stations";
}

/** Design framing: 100 px per world unit on a 900 px tall window. */
const DESIGN_HEIGHT_UNITS = 9;
/** Narrow windows fit the probes' reach across. */
const DESIGN_WIDTH_UNITS = 9.4;
/** The phone band's height in units: the boundary (7.5 across) nearly fills it. */
const BAND_HEIGHT_UNITS = 8;
/**
 * The tilted station ring with its labels, in units: about 3 above the core and 3.4 below it (the
 * near side reads larger), and 3.15 to each side plus a label like "SHELL 325".
 */
const STATIONS_FIT = { height: 6.6, width: 7.9 };

/**
 * Pixels per world unit, and the camera's view offset (CSS px) that puts the frame's centre where
 * the window's centre would be. With no frame the scene fills the window at the board's scale.
 */
export function sceneFraming(view: { width: number; height: number }, frame: SceneFrame | null): { pxPerUnit: number; offsetX: number; offsetY: number } {
  const design = view.height / DESIGN_HEIGHT_UNITS;
  if (!frame) return { pxPerUnit: Math.min(design, view.width / DESIGN_WIDTH_UNITS), offsetX: 0, offsetY: 0 };
  const left = frame.left ?? 0;
  const width = frame.width ?? view.width;
  const pxPerUnit =
    frame.fit === "stations"
      ? Math.min(design, frame.height / STATIONS_FIT.height, width / STATIONS_FIT.width)
      : Math.min(frame.height / BAND_HEIGHT_UNITS, width / DESIGN_WIDTH_UNITS);
  return { pxPerUnit, offsetX: view.width / 2 - (left + width / 2), offsetY: view.height / 2 - (frame.top + frame.height / 2) };
}

const cyclePose = newPose();

/**
 * The agent a keyboard step lands on: the orchestrator, then every subagent on screen at `t` (the
 * agents a click can pick) in id order, wrapping. `dir` 1 steps forward, -1 back; from -1 or an agent
 * no longer on screen it carries on from that id's place in the order.
 */
export function cycleAgent(trace: SessionTrace, t: number, current: number, dir: 1 | -1): number {
  const order = [0];
  for (let i = 1; i < trace.agents.length; i++) if (agentPose(trace, i, t, cyclePose).presence >= 0.5) order.push(i);
  if (current < 0) return dir > 0 ? order[0] : order[order.length - 1];
  const at = order.indexOf(current);
  if (at >= 0) return order[(at + dir + order.length) % order.length];
  // Gone: the next id above it going forward, the last id below it going back.
  if (dir > 0) return order.find((id) => id > current) ?? order[0];
  return [...order].reverse().find((id) => id < current) ?? order[order.length - 1];
}

/** The id of the point nearest (x, y) within `radius` px, or null. Ties go to the lower id. */
export function nearestWithin(points: readonly { id: number; x: number; y: number }[], x: number, y: number, radius: number): number | null {
  let best: number | null = null;
  let bestD = radius * radius;
  for (const p of points) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD || (d === bestD && best !== null && p.id < best)) {
      best = p.id;
      bestD = d;
    }
  }
  return best;
}

/** What a click landed on: an agent, else a tool station. */
export type PickHit = { kind: "agent"; id: number } | { kind: "station"; key: StationCategory };

/**
 * The agent nearest (x, y) within `radius`, else the station nearest within it. Agents win a tie of
 * reach because a subagent can sit on a station's spot, and the cloud is what the eye is on.
 */
export function pickTarget(
  agents: readonly { id: number; x: number; y: number }[],
  stations: readonly { id: number; x: number; y: number }[],
  x: number,
  y: number,
  radius: number,
): PickHit | null {
  const a = nearestWithin(agents, x, y, radius);
  if (a !== null) return { kind: "agent", id: a };
  const s = nearestWithin(stations, x, y, radius);
  return s === null ? null : { kind: "station", key: STATIONS[s] };
}
