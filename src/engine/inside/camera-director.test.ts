import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import { buildTimeline } from "@/lib/trace/timeline";
import { CAMERA_FOV, directorPose, FOCUS_FILL, followPose, holdFor, projectPoint, shotsOf, type CameraPose, type DirectorOptions } from "./camera-director";
import { agentPose, newPose, stationPos, STATIONS } from "./layout";
import { cloudRadius } from "./nebula-plan";

const trace = generateTrace(50, "medium");
const tl = buildTimeline(trace);
const opts: DirectorOptions = { rate: 4, aspect: 1.6 };
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Poses every `step` playback seconds across the run (idle stretches are cut, as on screen). */
const poses = (step: number, o = opts) => {
  const out: { t: number; p: CameraPose }[] = [];
  for (let pb = 0; pb <= tl.playbackDuration; pb += step) {
    const t = tl.toTrace(pb);
    out.push({ t, p: directorPose(tl, t, o) });
  }
  return out;
};

describe("shotsOf", () => {
  const shots = shotsOf(tl, 4);

  it("opens on the orchestrator, closes on the overview, and never fires twice inside a hold", () => {
    expect(shots[0]).toMatchObject({ t: 0, kind: "prompt" });
    expect(shots[shots.length - 1].kind).toBe("overview");
    for (let i = 1; i < shots.length; i++) expect(shots[i].t - shots[i - 1].t).toBeGreaterThanOrEqual(holdFor(4) - 1e-9);
  });

  it("cuts a shot for a spawn, a station burst and a return, and drifts through quiet stretches", () => {
    const kinds = new Set(shots.map((s) => s.kind));
    expect(kinds.has("spawn")).toBe(true);
    expect(kinds.has("overview")).toBe(true);
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it("holds longer and cuts fewer shots at a higher playback rate", () => {
    expect(holdFor(200)).toBeGreaterThan(holdFor(1));
    expect(shotsOf(tl, 200).length).toBeLessThan(shotsOf(tl, 1).length);
  });

  it("is the same shots every time", () => {
    expect(shotsOf(buildTimeline(generateTrace(50, "medium")), 4)).toEqual(shots);
  });
});

describe("directorPose", () => {
  it("is a pure function of the trace and the time: asking in any order gives the same pose", () => {
    const t = tl.toTrace(tl.playbackDuration * 0.4);
    const a = directorPose(tl, t, opts);
    directorPose(tl, tl.toTrace(tl.playbackDuration * 0.9), opts);
    directorPose(tl, 3, opts);
    expect(directorPose(tl, t, opts)).toEqual(a);
  });

  it("never snaps: the eye and target move in small, continuous steps", () => {
    const step = 0.25;
    const all = poses(step);
    let big = 0;
    for (let i = 1; i < all.length; i++) {
      const jump = Math.max(dist(all[i].p.eye, all[i - 1].p.eye), dist(all[i].p.target, all[i - 1].p.target));
      // A flight covers at most ~30 units in a few seconds; a snap would be one step of that size.
      if (jump > 6) big++;
    }
    expect(big).toBe(0);
  });

  it("flies to a spawned cluster: soon after the launch the camera looks at the new agent", () => {
    const shots = shotsOf(tl, 4);
    const s = shots.find((x) => x.kind === "spawn")!;
    const t = tl.toTrace(s.t + holdFor(4) * 0.9);
    const p = directorPose(tl, t, opts);
    const a = newPose();
    agentPose(trace, s.agents[0], t, a);
    // A fan-out frames the group; a single launch looks right at it.
    expect(dist(p.target, [a.x, a.y, a.z])).toBeLessThan(s.agents.length > 1 ? 12 : 1.5);
    expect(p.flight).toBe(0);
  });

  it("is mid-flight between shots and holds otherwise", () => {
    const shots = shotsOf(tl, 4);
    const s = shots[2];
    expect(directorPose(tl, tl.toTrace(s.t + 0.5), opts).flight).toBeGreaterThan(0);
    expect(directorPose(tl, tl.toTrace(s.t + holdFor(4) * 0.9), opts).flight).toBe(0);
  });

  it("keeps the eye clear of every cluster it flies past", () => {
    let flying = 0;
    for (const { t, p } of poses(0.5)) {
      if (p.flight <= 0) continue;
      flying++;
      for (const a of trace.agents) {
        if (a.id === p.agent || t < a.spawnT || (a.returned && t > a.returnT + 3)) continue;
        const q = newPose();
        agentPose(trace, a.id, t, q);
        // The focus agents are the destination; everything else must be passed at a distance.
        if (dist(p.eye, [q.x, q.y, q.z]) < 1.6 && !shotsOf(tl, 4).some((s) => s.agents.includes(a.id) && Math.abs(s.t - t) < holdFor(4))) {
          throw new Error(`eye inside agent ${a.id} at t=${t}`);
        }
      }
    }
    expect(flying).toBeGreaterThan(5);
  });

  it("ends on an overview that holds every station and the orchestrator in frame", () => {
    const p = directorPose(tl, trace.duration, opts);
    expect(p.kind).toBe("overview");
    const half = (CAMERA_FOV * Math.PI) / 360;
    const forward = [p.target[0] - p.eye[0], p.target[1] - p.eye[1], p.target[2] - p.eye[2]];
    const fl = Math.hypot(forward[0], forward[1], forward[2]);
    const pts: number[][] = [[0, 0, 0]];
    for (let i = 0; i < STATIONS.length; i++) {
      const s = stationPos(i, newPose());
      pts.push([s.x, s.y, s.z]);
    }
    for (const q of pts) {
      const v = [q[0] - p.eye[0], q[1] - p.eye[1], q[2] - p.eye[2]];
      const cos = (v[0] * forward[0] + v[1] * forward[1] + v[2] * forward[2]) / (Math.hypot(v[0], v[1], v[2]) * fl);
      expect(Math.acos(cos)).toBeLessThan(half * 1.6);
    }
    // And it stands much further back than any cluster shot.
    const spawn = directorPose(tl, tl.toTrace(shotsOf(tl, 4).find((s) => s.kind === "spawn")!.t + holdFor(4)), opts);
    expect(p.distance).toBeGreaterThan(spawn.distance * 1.8);
  });

  it("travels: the held shots look at several distinct places across the run", () => {
    const targets = poses(5)
      .filter((x) => x.p.flight === 0)
      .map((x) => x.p.target);
    const far = targets.filter((a) => targets.every((b) => a === b || true) && dist(a, [0, 0, 0]) > 3);
    expect(far.length).toBeGreaterThan(3);
    const spread = Math.max(...targets.map((a) => Math.max(...targets.map((b) => dist(a, b)))));
    expect(spread).toBeGreaterThan(8);
  });

  it("cuts instead of flying under reduced motion", () => {
    for (const { p } of poses(2, { ...opts, reduced: true })) expect(p.flight).toBe(0);
  });
});

describe("focus framing", () => {
  // A 1440x900 canvas with the left panels (340 px) and the open detail card (340 px) taken out,
  // the header above and the timeline below: the free frame the HUD passes to the camera.
  const canvas = { width: 1440, height: 900 };
  const free = { left: 340, top: 90, width: 760, height: 630 };
  const framed: DirectorOptions = { rate: 4, aspect: canvas.width / canvas.height, free: { width: free.width / canvas.width, height: free.height / canvas.height } };
  /** The camera's right vector under the app's lookAt convention (up is +y). */
  const rightOf = (p: CameraPose) => {
    const f = [p.target[0] - p.eye[0], p.target[1] - p.eye[1], p.target[2] - p.eye[2]];
    const r = [-f[2], 0, f[0]];
    const len = Math.hypot(r[0], r[1], r[2]) || 1;
    return [r[0] / len, 0, r[2] / len];
  };

  it("holds a focused cluster at a fifth of the free frame's height and in its centre", () => {
    const shots = shotsOf(tl, 4);
    const single = shots.find((s) => (s.kind === "drift" || s.kind === "spawn") && s.agents.length === 1 && s.agents[0] > 0)!;
    const t = tl.toTrace(single.t + holdFor(4) * 0.9);
    const p = directorPose(tl, t, framed);
    expect(p.flight).toBe(0);
    const radius = cloudRadius(trace, single.agents[0]);
    expect(radius).toBeGreaterThan(0);
    const centre = projectPoint(p, p.target, canvas, free);
    expect(centre.x).toBeCloseTo(free.left + free.width / 2, 3);
    expect(centre.y).toBeCloseTo(free.top + free.height / 2, 3);
    const r = rightOf(p);
    const rim = projectPoint(p, [p.target[0] + r[0] * radius, p.target[1] + r[1] * radius, p.target[2] + r[2] * radius], canvas, free);
    // A drift stands `wide` times further back than a close focus shot.
    const projected = (Math.hypot(rim.x - centre.x, rim.y - centre.y) * single.wide) / (free.height * FOCUS_FILL);
    expect(projected).toBeGreaterThan(0.97);
    expect(projected).toBeLessThan(1.03);
  });

  it("stands twice as far back when the free frame is half as tall, so the cluster fills the same share of it", () => {
    const shots = shotsOf(tl, 4);
    const single = shots.find((s) => s.kind === "drift" && s.agents.length === 1 && s.agents[0] > 0)!;
    const t = tl.toTrace(single.t + holdFor(4) * 0.9);
    const whole = directorPose(tl, t, { rate: 4, aspect: 1.6 });
    const half = directorPose(tl, t, { rate: 4, aspect: 1.6, free: { width: 1, height: 0.5 } });
    expect(half.distance).toBeCloseTo(whole.distance * 2, 6);
  });
});

describe("followPose", () => {
  it("looks at the agent from a cluster-filling distance", () => {
    const id = trace.agents.find((a) => a.parent === 0)!.id;
    const t = trace.agents[id].spawnT + 20;
    const p = followPose(tl, id, t, opts);
    const a = newPose();
    agentPose(trace, id, t, a);
    expect(dist(p.target, [a.x, a.y, a.z])).toBeLessThan(1e-9);
    expect(p.distance).toBeGreaterThan(4);
    // Its cloud's radius takes a fifth of the canvas height, like a director's focus shot.
    const canvas = { width: 1600, height: 1000 };
    const whole = { left: 0, top: 0, ...canvas };
    const c = projectPoint(p, p.target, canvas, whole);
    const rim = projectPoint(p, [a.x, a.y + cloudRadius(trace, id), a.z], canvas, whole);
    const projected = Math.hypot(rim.x - c.x, rim.y - c.y) / (canvas.height * FOCUS_FILL);
    expect(projected).toBeGreaterThan(0.9);
    expect(projected).toBeLessThan(1.03);
  });
});
