/**
 * The camera director: a pure function from `(timeline, t)` to where the camera is and what it looks
 * at, so the shot is deterministic, scrubbing backwards flies the same path backwards, and nothing
 * here needs three.
 *
 * Shots live in playback seconds (trace time with idle stretches cut), so a long idle gap is not
 * hundreds of shots, and a shot lasts about five real seconds at any playback rate.
 *
 * The session is cut into shots from its own events. A shot has a focus (a cluster, a station, a
 * group of siblings, or the whole scene), an arrival time, and a slow orbit while it holds. Between
 * two shots the camera flies: eye and target ease from one to the other with a dolly out and a
 * sideways arc in the middle, pushed clear of any cloud it would pass through. While a shot holds
 * the camera sways slowly round its focus (a bounded sine, so a long hold never winds up).
 *
 * Shot rules (an earlier rule never fires within `holdFor(rate)` seconds of the last shot, so the
 * camera never ping-pongs):
 *  - spawn: a launch flies to the new cluster; launches within one hold of each other are one shot
 *    on the group (a fan-out, framed to hold every child);
 *  - station: a burst (four or more calls to one station within eight seconds) swings to it;
 *  - return: a handback follows the report line back to the parent cluster;
 *  - prompt: the opening shot, on the orchestrator reading the first prompt;
 *  - compact: a context compaction pulls back to the orchestrator and its near children;
 *  - drift: a long quiet stretch (three holds with no other shot) tours the running clusters in
 *    turn, a little wider, each with a slow sway;
 *  - overview: the last stretch of the run pulls all the way back to show everything at once.
 */

import type { Timeline } from "@/lib/trace/timeline";
import type { SessionTrace } from "@/lib/trace/types";
import { agentPose, newPose, SPAWN_TIME, stationPos, STATIONS, stationIndex } from "./layout";
import { cloudRadius } from "./nebula-plan";

export type Vec3 = [number, number, number];
export type ShotKind = "spawn" | "station" | "return" | "prompt" | "compact" | "drift" | "overview" | "follow";

export interface Shot {
  /** Playback seconds at which the camera starts flying to this shot. */
  t: number;
  kind: ShotKind;
  /** The clusters in focus (one, or a group for a fan-out); empty for a station or the overview. */
  agents: number[];
  /** The station in focus, an index into `STATIONS`, or -1. */
  station: number;
  /** Multiplies the framing distance: drifts and prompts stand further back. */
  wide: number;
  /** Where round the focus the camera starts, radians. */
  azimuth: number;
}

export interface CameraPose {
  eye: Vec3;
  target: Vec3;
  /** Eye to target. */
  distance: number;
  kind: ShotKind;
  /** The agent in focus, or -1. */
  agent: number;
  /** The station in focus (index into `STATIONS`), or -1. */
  station: number;
  /** 0 while holding a shot, 0..1 across a flight. */
  flight: number;
}

export interface DirectorOptions {
  /** Playback rate: faster playback holds and flies for more trace seconds, so shots last as long on screen. */
  rate: number;
  /** Canvas width over height. */
  aspect: number;
  /**
   * The free frame: the canvas minus the HUD's panels and the open detail card, as fractions of
   * the canvas width and height (0..1). The camera's view offset centres the target in it, and a
   * focused cluster is sized to it. The whole canvas when absent.
   */
  free?: { width: number; height: number };
  /** Cuts instead of flights, and no orbit. */
  reduced?: boolean;
}

/** Vertical field of view, degrees (the app's camera uses the same). */
export const CAMERA_FOV = 36;
/** Fallback cluster radii in world units for an agent without a cloud, about where its point fades out. */
export const ORCHESTRATOR_RADIUS = 1.9;
export const CLUSTER_RADIUS = 1.1;
export const STATION_FOCUS_RADIUS = 1.0;
/** A focused cluster's projected radius as a fraction of the free frame's height (its diameter fills 40%). */
export const FOCUS_FILL = 0.2;
/** The overview's radius as a fraction of the free frame's short side (everything fills 92%). */
const OVERVIEW_FILL = 0.46;
const BURST_CALLS = 4;
const BURST_WINDOW = 8;
/** Playback seconds before the end at which the final pull back begins, at least. */
const OVERVIEW_LEAD = 10;
/** How close the eye may pass a cluster's centre. */
const CLEARANCE = 2.6;
const MAX_AVOID_AGENTS = 160;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoother = (x: number) => {
  const u = clamp01(x);
  return u * u * u * (u * (u * 6 - 15) + 10);
};

/** Playback seconds a shot holds at least: about five real seconds at any rate, six at 1x. */
export const holdFor = (rate: number) => Math.max(6, rate * 5);
/** Playback seconds a flight takes: three fifths of a hold. */
const flyFor = (hold: number) => hold * 0.6;

const cache = new WeakMap<Timeline, Map<number, Shot[]>>();

/** The shots of a trace for a playback rate (cached per trace and hold). */
export function shotsOf(tl: Timeline, rate: number): Shot[] {
  const hold = holdFor(rate);
  let byHold = cache.get(tl);
  if (!byHold) cache.set(tl, (byHold = new Map()));
  let shots = byHold.get(hold);
  if (!shots) byHold.set(hold, (shots = buildShots(tl, hold)));
  return shots;
}

interface Candidate {
  t: number;
  kind: ShotKind;
  agents: number[];
  station: number;
  priority: number;
}

function buildShots(tl: Timeline, hold: number): Shot[] {
  const { trace } = tl;
  const cands: Candidate[] = [{ t: 0, kind: "prompt", agents: [0], station: -1, priority: 9 }];

  // Spawns within one hold of the first of a group join it.
  let group: Candidate | null = null;
  const recent = new Map<number, number[]>();
  for (const e of trace.events) {
    if (e.kind === "spawn" && e.child !== undefined) {
      if (group && tl.toPlayback(e.t) - group.t < hold) group.agents.push(e.child);
      else cands.push((group = { t: tl.toPlayback(e.t) + 0.3, kind: "spawn", agents: [e.child], station: -1, priority: 4 }));
    } else if (e.kind === "return" && e.child !== undefined) {
      const parent = trace.agents[e.child]?.parent ?? 0;
      cands.push({ t: tl.toPlayback(e.t), kind: "return", agents: [Math.max(parent, 0)], station: -1, priority: 2 });
    } else if (e.kind === "compact") {
      cands.push({ t: tl.toPlayback(e.t), kind: "compact", agents: [0], station: -1, priority: 3 });
    } else if (e.kind === "call" && e.category) {
      const s = stationIndex(e.category);
      if (s < 0) continue;
      const q = recent.get(s) ?? [];
      recent.set(s, q);
      q.push(e.t);
      while (q.length && e.t - q[0] > BURST_WINDOW) q.shift();
      if (q.length >= BURST_CALLS) {
        cands.push({ t: tl.toPlayback(q[0]), kind: "station", agents: [], station: s, priority: 1 });
        q.length = 0;
      }
    }
  }
  cands.sort((a, b) => a.t - b.t || b.priority - a.priority);

  // The final pull back starts late enough to leave a hold after the last shot.
  const overviewAt = Math.max(tl.playbackDuration - Math.max(OVERVIEW_LEAD, hold * 1.2), 0);
  const kept: Shot[] = [];
  let last: Candidate | null = null;
  for (const c of cands) {
    if (c.t > overviewAt - hold * 0.5) break;
    if (last && c.t - last.t < hold) continue;
    kept.push({ t: c.t, kind: c.kind, agents: c.agents, station: c.station, wide: c.kind === "prompt" || c.kind === "compact" ? 1.9 : 1, azimuth: 0 });
    last = c;
  }

  // Quiet stretches: drift round the last focus, wider.
  const out: Shot[] = [];
  let drifts = 0;
  for (let i = 0; i < kept.length; i++) {
    out.push(kept[i]);
    const next = i + 1 < kept.length ? kept[i + 1].t : overviewAt;
    let at = kept[i].t + hold * 2;
    while (next - at > hold * 1.2 && next - kept[i].t > hold * 3) {
      // Drift to the next running cluster in turn, so a quiet stretch tours the live agents.
      const now = tl.toTrace(at);
      const live = trace.agents.filter((a) => a.parent >= 0 && now >= a.spawnT + SPAWN_TIME && (!a.returned || now < a.returnT));
      const focus = live.length ? [live[drifts++ % live.length].id] : [0];
      out.push({ t: at, kind: "drift", agents: focus, station: -1, wide: focus[0] === 0 ? 1.9 : 1.5, azimuth: 0 });
      at += hold * 2;
    }
  }
  out.push({ t: overviewAt, kind: "overview", agents: [], station: -1, wide: 1, azimuth: 0 });
  // A deterministic, varied approach side for each shot, within about a third of a turn.
  out.forEach((s, i) => {
    s.azimuth = Math.sin(i * 2.3 + 0.7) * 0.9;
  });
  return out;
}

const scratch = newPose();

interface Focus {
  centre: Vec3;
  radius: number;
}

/** Where a shot looks at time `t` and how big what it looks at is. */
function focusOf(trace: SessionTrace, shot: Shot, t: number): Focus {
  if (shot.kind === "overview") return overviewFocus(trace, t);
  if (shot.station >= 0) {
    stationPos(shot.station, scratch);
    return { centre: [scratch.x, scratch.y, scratch.z], radius: STATION_FOCUS_RADIUS };
  }
  let n = 0;
  const sum: Vec3 = [0, 0, 0];
  const pts: Vec3[] = [];
  for (const id of shot.agents) {
    agentPose(trace, id, t, scratch);
    sum[0] += scratch.x;
    sum[1] += scratch.y;
    sum[2] += scratch.z;
    pts.push([scratch.x, scratch.y, scratch.z]);
    n++;
  }
  if (!n) return { centre: [0, 0, 0], radius: clusterRadius(trace, 0) };
  const centre: Vec3 = [sum[0] / n, sum[1] / n, sum[2] / n];
  let radius = clusterRadius(trace, shot.agents[0]);
  if (shot.agents.length > 1) {
    // A fan-out: hold every child, and the parent they came out of.
    pts.forEach((p, i) => {
      radius = Math.max(radius, Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]) + clusterRadius(trace, shot.agents[i]));
    });
  }
  return { centre, radius };
}

/** The world radius of agent `id`'s cloud at full growth, or the fallback for an agent drawn as a point. */
function clusterRadius(trace: SessionTrace, id: number): number {
  return cloudRadius(trace, id) || (id === 0 ? ORCHESTRATOR_RADIUS : CLUSTER_RADIUS);
}

/** Everything at once: the stations, the orchestrator and every cluster still out. */
function overviewFocus(trace: SessionTrace, t: number): Focus {
  const pts: Vec3[] = [[0, 0, 0]];
  for (let i = 0; i < STATIONS.length; i++) {
    stationPos(i, scratch);
    pts.push([scratch.x, scratch.y, scratch.z]);
  }
  let seen = 0;
  for (let id = 1; id < trace.agents.length && seen < MAX_AVOID_AGENTS; id++) {
    const a = trace.agents[id];
    if (t < a.spawnT || (a.returned && t > a.returnT + 3)) continue;
    agentPose(trace, id, t, scratch);
    pts.push([scratch.x, scratch.y, scratch.z]);
    seen++;
  }
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  }
  const centre: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  let radius = 0;
  for (const p of pts) radius = Math.max(radius, Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]));
  return { centre, radius: radius + clusterRadius(trace, 0) };
}

const tanHalfFov = () => Math.tan((CAMERA_FOV * Math.PI) / 360);

/**
 * Eye to target distance at which a sphere of `radius` round the target projects to `fill` of the
 * free frame's height, and no more than `fill` of its width (a narrow frame stands further back).
 */
export function focusDistance(radius: number, fill: number, o: DirectorOptions): number {
  const freeH = o.free?.height ?? 1;
  const freeW = (o.free?.width ?? 1) * o.aspect;
  // The projected radius in canvas heights is radius / (distance * 2 * tan(fov / 2)).
  return radius / (2 * tanHalfFov() * fill * Math.min(freeH, freeW));
}

/**
 * The app's camera as a pure pinhole: canvas px of a world `point` under `pose`, with the view
 * offset that puts the target in the middle of the free frame (`free`, canvas px). `depth` is the
 * distance along the line of sight; a point behind the eye has `depth <= 0`.
 */
export function projectPoint(
  pose: CameraPose,
  point: Vec3,
  canvas: { width: number; height: number },
  free: { left: number; top: number; width: number; height: number },
): { x: number; y: number; depth: number } {
  const { eye, target } = pose;
  const f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const fl = Math.hypot(f[0], f[1], f[2]) || 1;
  const z = [-f[0] / fl, -f[1] / fl, -f[2] / fl];
  // lookAt with up = +y: x = up cross z, y = z cross x.
  let x = [z[2], 0, -z[0]];
  const xl = Math.hypot(x[0], x[2]);
  x = xl > 1e-9 ? [x[0] / xl, 0, x[2] / xl] : [1, 0, 0];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const d = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
  const vx = d[0] * x[0] + d[1] * x[1] + d[2] * x[2];
  const vy = d[0] * y[0] + d[1] * y[1] + d[2] * y[2];
  const depth = -(d[0] * z[0] + d[1] * z[1] + d[2] * z[2]);
  const safe = depth > 1e-9 ? depth : 1e-9;
  const halfH = canvas.height / 2;
  const px = (vx / (safe * tanHalfFov())) * halfH;
  const py = (vy / (safe * tanHalfFov())) * halfH;
  return { x: free.left + free.width / 2 + px, y: free.top + free.height / 2 - py, depth };
}

const EL_BASE = 0.2;

/** The pose a shot holds at `t`, before any flight blending. */
function shotPose(trace: SessionTrace, shot: Shot, index: number, t: number, p: number, o: DirectorOptions): CameraPose {
  const focus = focusOf(trace, shot, t);
  const overview = shot.kind === "overview";
  const distance = Math.max(overview ? focusDistance(focus.radius, OVERVIEW_FILL, o) : focusDistance(focus.radius, FOCUS_FILL, o) * shot.wide, 4);
  // A slow sway round the focus, bounded so a long hold never winds up.
  const hold = holdFor(Math.max(o.rate, 1));
  const amplitude = shot.kind === "drift" ? 0.7 : overview ? 0.25 : 0.4;
  const turn = o.reduced ? 0 : amplitude * Math.sin(((p - shot.t) / hold) * 0.9);
  const az = shot.azimuth + (overview ? 0.35 : 0) + turn;
  const el = EL_BASE + (overview ? 0.12 : 0.07 * Math.sin(index * 1.7));
  const eye: Vec3 = [
    focus.centre[0] + distance * Math.sin(az) * Math.cos(el),
    focus.centre[1] + distance * Math.sin(el),
    focus.centre[2] + distance * Math.cos(az) * Math.cos(el),
  ];
  // A held shot never sits inside another cluster either.
  clearClusters(trace, t, eye, shot.agents, 1);
  return {
    eye,
    target: focus.centre,
    distance,
    kind: shot.kind,
    agent: shot.agents.length === 1 ? shot.agents[0] : -1,
    station: shot.station,
    flight: 0,
  };
}

const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** Pushes `eye` out of any live cluster it would pass through (continuous in `eye`). */
function clearClusters(trace: SessionTrace, t: number, eye: Vec3, keep: readonly number[], strength: number): void {
  let seen = 0;
  for (let id = 0; id < trace.agents.length && seen < MAX_AVOID_AGENTS; id++) {
    const a = trace.agents[id];
    if (id > 0 && (t < a.spawnT || (a.returned && t > a.returnT + 3))) continue;
    seen++;
    if (keep.includes(id)) continue;
    agentPose(trace, id, t, scratch);
    const dx = eye[0] - scratch.x;
    const dy = eye[1] - scratch.y;
    const dz = eye[2] - scratch.z;
    const d = Math.hypot(dx, dy, dz);
    const min = id === 0 ? CLEARANCE + 1 : CLEARANCE;
    if (d >= min) continue;
    const push = d > 1e-6 ? ((min - d) / d) * strength : 0;
    if (d > 1e-6) {
      eye[0] += dx * push;
      eye[1] += dy * push;
      eye[2] += dz * push;
    } else eye[1] += min * strength;
  }
}

/** The director's pose at trace time `t`. */
export function directorPose(tl: Timeline, t: number, o: DirectorOptions): CameraPose {
  const { trace } = tl;
  const rate = Math.max(o.rate, 1);
  const shots = shotsOf(tl, rate);
  const p = tl.toPlayback(t);
  let i = 0;
  while (i + 1 < shots.length && shots[i + 1].t <= p) i++;
  const now = shotPose(trace, shots[i], i, t, p, o);
  const fly = o.reduced ? 1e-6 : flyFor(holdFor(rate));
  const s = i === 0 ? 1 : clamp01((p - shots[i].t) / fly);
  if (s >= 1) return now;
  const prev = shotPose(trace, shots[i - 1], i - 1, t, p, o);
  const e = smoother(s);
  const bump = Math.sin(Math.PI * e);
  const eye = lerp3(prev.eye, now.eye, e);
  const target = lerp3(prev.target, now.target, e);
  // Dolly out through the middle of the flight, and arc to one side, so it reads as travel.
  const dist = Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]) || 1;
  const run = Math.hypot(now.eye[0] - prev.eye[0], now.eye[1] - prev.eye[1], now.eye[2] - prev.eye[2]);
  const out: Vec3 = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]];
  const lift = 0.35 * bump;
  const arc = Math.min(run * 0.12, 9) * bump * (i % 2 ? 1 : -1);
  // The arc runs along the horizontal normal of the line of sight.
  const side: Vec3 = [out[2] / (Math.hypot(out[0], out[2]) || 1), 0, -out[0] / (Math.hypot(out[0], out[2]) || 1)];
  const flown: Vec3 = [eye[0] + out[0] * lift + side[0] * arc, eye[1] + out[1] * lift, eye[2] + out[2] * lift + side[2] * arc];
  // Eased in and out, so the push never snaps the eye at either end of a flight.
  clearClusters(trace, t, flown, [...shots[i].agents, ...shots[i - 1].agents], Math.min(1, bump * 3));
  return {
    eye: flown,
    target,
    distance: Math.hypot(flown[0] - target[0], flown[1] - target[1], flown[2] - target[2]) || dist,
    kind: now.kind,
    agent: now.agent,
    station: now.station,
    flight: s,
  };
}

/** A pose that holds one agent in frame, slowly orbiting: what Follow locks the camera onto. */
export function followPose(tl: Timeline, id: number, t: number, o: DirectorOptions): CameraPose {
  const shot: Shot = { t: 0, kind: "follow", agents: [id], station: -1, wide: 1, azimuth: 0.5 };
  return shotPose(tl.trace, shot, 1, t, tl.toPlayback(t), o);
}
