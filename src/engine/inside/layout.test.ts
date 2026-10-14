import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import { buildTimeline, particleLife } from "@/lib/trace/timeline";
import type { SessionTrace, TraceAgent, TraceEvent } from "@/lib/trace/types";
import {
  ACTIVE_FADE,
  agentPose,
  PROBE_LENGTH,
  FOLD_TIME,
  cycleAgent,
  featuredAgent,
  flightPos,
  makeFlight,
  nearestWithin,
  newPose,
  pickTarget,
  ORBIT_RADIUS,
  SPAWN_TIME,
  STATION_RADIUS,
  STATIONS,
  stationActivity,
  stationCounts,
  stationIndex,
  sceneFraming,
  stationPos,
  liveProbes,
  PROBE_GROW,
  webProbes,
  type StationCategory,
  type WebProbe,
} from "./layout";
import { createPlayback } from "./playback";

const U = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function agent(id: number, parent: number, depth: number, spawnT: number, returnT: number): TraceAgent {
  return {
    id,
    parent,
    depth,
    model: id === 0 ? "opus" : "sonnet",
    modelId: "m",
    agentType: "general",
    label: `agent ${id}`,
    spawnT,
    returnT,
    returned: id !== 0,
    background: false,
    usage: U,
    toolCalls: 0,
    childMissing: false,
  };
}

/** Orchestrator 0; children 1 and 2 (10..60 s, 12..50 s); grandchild 3 under 1 (20..40 s). */
function tree(): SessionTrace {
  const events: TraceEvent[] = [
    { t: 0, agent: 0, kind: "prompt", excerpt: "go" },
    { t: 10, agent: 0, kind: "spawn", category: "agents", tool: "Agent", child: 1 },
    { t: 12, agent: 0, kind: "spawn", category: "agents", tool: "Agent", child: 2 },
    { t: 20, agent: 1, kind: "spawn", category: "agents", tool: "Agent", child: 3 },
    { t: 25, agent: 3, kind: "call", category: "web", tool: "WebSearch", excerpt: "tide tables" },
    { t: 27, agent: 2, kind: "call", category: "shell", tool: "Bash" },
    { t: 28, agent: 2, kind: "result", category: "shell", tool: "Bash", call: 5 },
    { t: 29, agent: 3, kind: "result", category: "web", tool: "WebSearch", call: 4 },
    { t: 30, agent: 2, kind: "call", category: "other", tool: "Skill" },
    { t: 40, agent: 1, kind: "return", child: 3, call: 3 },
    { t: 50, agent: 0, kind: "return", child: 2, call: 2 },
    { t: 60, agent: 0, kind: "return", child: 1, call: 1 },
  ];
  return {
    version: 1,
    source: "sample",
    label: "tree",
    duration: 70,
    agents: [agent(0, -1, 0, 0, 70), agent(1, 0, 1, 10, 60), agent(2, 0, 1, 12, 50), agent(3, 1, 2, 20, 40)],
    events,
    truncated: false,
  };
}

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("stations", () => {
  it("hang around the orchestrator in STATIONS order, each at its own depth, none coplanar", () => {
    expect(STATIONS).toEqual(["web", "plan", "advisor", "agents", "edit", "mcp", "files", "shell"]);
    const pts = STATIONS.map((_, i) => ({ ...stationPos(i, newPose()) }));
    for (const p of pts) {
      expect(Math.hypot(p.x, p.y, p.z)).toBeGreaterThan(STATION_RADIUS * 0.5);
      expect(Math.hypot(p.x, p.y, p.z)).toBeLessThan(STATION_RADIUS * 1.6);
      expect(Math.abs(p.z)).toBeGreaterThan(2);
    }
    // Web is up and to the right (half past one), shell to the right, agents to the left.
    const at = (k: StationCategory) => pts[stationIndex(k)];
    expect(at("web").x).toBeGreaterThan(0);
    expect(at("web").y).toBeGreaterThan(0);
    expect(at("agents").x).toBeLessThan(0);
    expect(at("shell").x).toBeGreaterThan(0);
    expect(new Set(pts.map((p) => Math.round(p.z))).size).toBeGreaterThan(5);
  });

  it("are fixed: the same spot every time", () => {
    expect({ ...stationPos(3, newPose()) }).toEqual({ ...stationPos(3, newPose()) });
  });

  it("has no station for the other category", () => {
    expect(stationIndex("other")).toBe(-1);
  });

  it("counts calls and launches made so far per station", () => {
    const counts = stationCounts(tree());
    expect(counts.at(stationIndex("agents"), 11)).toBe(1);
    expect(counts.at(stationIndex("agents"), 70)).toBe(3);
    expect(counts.at(stationIndex("web"), 24)).toBe(0);
    expect(counts.at(stationIndex("web"), 25)).toBe(1);
    expect(counts.at(stationIndex("shell"), 70)).toBe(1);
  });
});

describe("agentPose", () => {
  it("keeps the orchestrator at the centre", () => {
    const p = newPose();
    agentPose(tree(), 0, 33, p);
    expect([p.x, p.y, p.z, p.presence]).toEqual([0, 0, 0, 1]);
  });

  it("is absent before the spawn and starts out of the parent", () => {
    const trace = tree();
    const p = newPose();
    agentPose(trace, 1, 5, p);
    expect(p.presence).toBe(0);
    agentPose(trace, 1, 10, p);
    expect(dist(p, { x: 0, y: 0, z: 0 })).toBeLessThan(1e-9);
  });

  it("orbits its parent at its depth's radius once spawned", () => {
    const trace = tree();
    const child = newPose();
    const parent = newPose();
    agentPose(trace, 1, 10 + SPAWN_TIME + 1, child);
    expect(child.presence).toBe(1);
    const r = dist(child, { x: 0, y: 0, z: 0 });
    expect(r).toBeGreaterThan(ORBIT_RADIUS[1] * 0.8);
    expect(r).toBeLessThan(ORBIT_RADIUS[1] * 1.2);

    const t = 20 + SPAWN_TIME + 2;
    agentPose(trace, 3, t, child);
    agentPose(trace, 1, t, parent);
    const r2 = dist(child, parent);
    expect(r2).toBeGreaterThan(ORBIT_RADIUS[2] * 0.8);
    expect(r2).toBeLessThan(ORBIT_RADIUS[2] * 1.2);
  });

  it("places siblings apart", () => {
    const trace = tree();
    const a = newPose();
    const b = newPose();
    agentPose(trace, 1, 30, a);
    agentPose(trace, 2, 30, b);
    expect(dist(a, b)).toBeGreaterThan(ORBIT_RADIUS[1] * 0.5);
  });

  it("folds back into the parent after it returns, then is gone", () => {
    const trace = tree();
    const parent = newPose();
    const p = newPose();
    agentPose(trace, 3, 40 + FOLD_TIME / 2, p);
    agentPose(trace, 1, 40 + FOLD_TIME / 2, parent);
    expect(p.presence).toBeGreaterThan(0);
    expect(dist(p, parent)).toBeLessThan(ORBIT_RADIUS[2]);
    agentPose(trace, 3, 40 + FOLD_TIME, p);
    agentPose(trace, 1, 40 + FOLD_TIME, parent);
    expect(dist(p, parent)).toBeLessThan(1e-9);
    expect(p.presence).toBe(0);
  });
});

describe("flights", () => {
  it("bakes a call from the caller's pose to its station, living particleLife(rate) real seconds", () => {
    const trace = tree();
    const f = makeFlight(buildTimeline(trace), 5, 4)!;
    const caller = newPose();
    agentPose(trace, 2, 27, caller);
    expect([f.sx, f.sy, f.sz]).toEqual([caller.x, caller.y, caller.z]);
    const station = newPose();
    stationPos(stationIndex("shell"), station);
    expect([f.ex, f.ey, f.ez]).toEqual([station.x, station.y, station.z]);
    expect(f.t0).toBe(27);
    expect(f.t1).toBeCloseTo(27 + particleLife(4) * 4, 9);
    expect(f.station).toBe(stationIndex("shell"));
  });

  it("flies a subagent launch to the agents station, and nothing for results or other tools", () => {
    const trace = tree();
    expect(makeFlight(buildTimeline(trace), 1, 1)!.station).toBe(stationIndex("agents"));
    expect(makeFlight(buildTimeline(trace), 6, 1)).toBeNull();
    expect(makeFlight(buildTimeline(trace), 8, 1)).toBeNull();
  });

  it("moves from start to end inside its window and is dead outside it", () => {
    const f = makeFlight(buildTimeline(tree()), 5, 1)!;
    const p = newPose();
    expect(flightPos(f, f.t0 - 0.01, p)).toBe(false);
    expect(flightPos(f, f.t1 + 0.01, p)).toBe(false);
    expect(flightPos(f, f.t0, p)).toBe(true);
    expect([p.x, p.y, p.z]).toEqual([f.sx, f.sy, f.sz]);
    flightPos(f, f.t1, p);
    expect(p.x).toBeCloseTo(f.ex, 9);
    expect(p.y).toBeCloseTo(f.ey, 9);
    flightPos(f, (f.t0 + f.t1) / 2, p);
    const total = Math.hypot(f.ex - f.sx, f.ey - f.sy);
    const done = Math.hypot(p.x - f.sx, p.y - f.sy);
    // Decelerating into the station: past halfway at half time.
    expect(done / total).toBeGreaterThan(0.5);
    expect(done / total).toBeLessThan(1);
  });

  it("lives 0.4 to 2 real seconds at every rate, even across an idle cut", () => {
    const tl = buildTimeline(generateTrace(50, "medium"));
    expect(tl.cuts.length).toBeGreaterThan(0);
    const dt = 1 / 120;
    const p = newPose();
    for (const rate of [1, 25, 200]) {
      let flights = 0;
      let acrossCut = 0;
      for (let i = 0; i < tl.trace.events.length; i++) {
        const f = makeFlight(tl, i, rate);
        // A flight cut short by the end of the session is not a short flight.
        if (!f || f.t1 >= tl.playbackDuration) continue;
        flights++;
        if (tl.cuts.some((c) => c.at > f.t0 && c.at < f.t1)) acrossCut++;
        // Play the real clock from the call and time how long the streak is on screen.
        const clock = createPlayback(tl, { t: tl.trace.events[i].t, rate, playing: true });
        let real = 0;
        while (flightPos(f, tl.toPlayback(clock.time()), p) && real < 5) {
          clock.advance(dt);
          real += dt;
        }
        expect(real, `event ${i} at ${rate}x`).toBeGreaterThanOrEqual(0.4 - 2 * dt);
        expect(real, `event ${i} at ${rate}x`).toBeLessThanOrEqual(2 + 2 * dt);
      }
      expect(flights).toBeGreaterThan(100);
      expect(acrossCut, `flights across a cut at ${rate}x`).toBeGreaterThan(0);
    }
  });
});

describe("webProbes", () => {
  it("lists each web call with its result time, tool and query, reaching out past the web station", () => {
    const probes = webProbes(tree());
    expect(probes).toHaveLength(1);
    const [w] = probes;
    expect(w).toMatchObject({ event: 4, agent: 3, t0: 25, t1: 29, tool: "WebSearch", query: "tide tables" });
    const web = stationPos(stationIndex("web"), newPose());
    expect(Math.hypot(w.ex - web.x, w.ey - web.y, w.ez - web.z)).toBeGreaterThan(PROBE_LENGTH * 0.9);
    expect(Math.hypot(w.ex, w.ey, w.ez)).toBeGreaterThan(Math.hypot(web.x, web.y, web.z));
  });

  it("finds web calls in a generated sample", () => {
    const trace = generateTrace(3, "medium");
    const probes = webProbes(trace);
    expect(probes.length).toBeGreaterThan(0);
    for (const p of probes) {
      expect(p.t1).toBeGreaterThanOrEqual(p.t0);
      // A sample web call carries a short generic query to label its probe with.
      expect(p.query.length).toBeGreaterThan(0);
    }
  });
});

describe("liveProbes", () => {
  const probe = (t0: number, t1: number): WebProbe => ({ event: 0, agent: 0, t0, t1, tool: "WebSearch", query: "", ex: 4, ey: 0, ez: 0 });

  it("lists the probes out at t, in order", () => {
    const probes = [probe(0, 10), probe(5, 6), probe(20, 30)];
    expect(liveProbes(probes, 5.5, 64, [])).toEqual([0, 1]);
    expect(liveProbes(probes, 15, 64, [])).toEqual([]);
  });

  it("never lists more than max, growing probes included, so the boundary's sprites stay in their buffer", () => {
    // One probe still growing toward its end, then 64 fully out.
    const probes = [probe(100 - PROBE_GROW / 2, 200), ...Array.from({ length: 64 }, () => probe(0, 100))];
    expect(liveProbes(probes, 100, 64, []).length).toBeLessThanOrEqual(64);
    // Many growing ones first: still capped.
    const early = [...Array.from({ length: 80 }, () => probe(99.9, 200)), ...Array.from({ length: 64 }, () => probe(0, 200))];
    expect(liveProbes(early, 100, 64, []).length).toBe(64);
  });
});

describe("stationActivity", () => {
  it("is lit from a call until its result, then fades out", () => {
    const act = stationActivity(tree());
    const shell = stationIndex("shell");
    expect(act.at(shell, 26.9)).toBe(0);
    expect(act.at(shell, 27.5)).toBe(1);
    expect(act.at(shell, 28)).toBe(1);
    const fading = act.at(shell, 28 + ACTIVE_FADE / 2);
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(1);
    expect(act.at(shell, 28 + ACTIVE_FADE)).toBe(0);
  });

  it("stays lit while an earlier, longer call is still out", () => {
    const act = stationActivity(tree());
    // The web call runs 25..29; no later web call starts, so 28 is still lit.
    expect(act.at(stationIndex("web"), 28)).toBe(1);
    expect(act.at(stationIndex("plan"), 28)).toBe(0);
  });
});

describe("featuredAgent", () => {
  it("prefers a running subagent with a running child of its own", () => {
    expect(featuredAgent(tree(), 30)).toBe(1);
  });

  it("falls back to a running subagent, and to none", () => {
    expect(featuredAgent(tree(), 45)).toBe(1);
    expect(featuredAgent(tree(), 55)).toBe(1);
    expect(featuredAgent(tree(), 5)).toBe(-1);
  });
});

describe("nearestWithin", () => {
  const pts = [
    { id: 1, x: 100, y: 100 },
    { id: 2, x: 110, y: 100 },
    { id: 3, x: 300, y: 300 },
  ];
  it("picks the nearest point inside the radius", () => {
    expect(nearestWithin(pts, 108, 101, 30)).toBe(2);
    expect(nearestWithin(pts, 101, 99, 30)).toBe(1);
  });
  it("returns null outside the radius or with no points", () => {
    expect(nearestWithin(pts, 200, 200, 30)).toBeNull();
    expect(nearestWithin([], 0, 0, 30)).toBeNull();
  });
});

describe("cycleAgent", () => {
  it("starts at the orchestrator and steps through the agents on screen in id order, wrapping", () => {
    // At 30 s agents 1, 2 and 3 are all out.
    expect(cycleAgent(tree(), 30, -1, 1)).toBe(0);
    expect(cycleAgent(tree(), 30, 0, 1)).toBe(1);
    expect(cycleAgent(tree(), 30, 1, 1)).toBe(2);
    expect(cycleAgent(tree(), 30, 3, 1)).toBe(0);
  });

  it("steps backwards, wrapping from the orchestrator to the last agent", () => {
    expect(cycleAgent(tree(), 30, 0, -1)).toBe(3);
    expect(cycleAgent(tree(), 30, 2, -1)).toBe(1);
    expect(cycleAgent(tree(), 30, -1, -1)).toBe(3);
  });

  it("skips agents not yet spawned or folded away, and carries on from where a gone one was", () => {
    // At 55 s only agent 1 is still out; 2 returned at 50 and 3 at 40.
    expect(cycleAgent(tree(), 55, 0, 1)).toBe(1);
    expect(cycleAgent(tree(), 55, 1, 1)).toBe(0);
    expect(cycleAgent(tree(), 55, 2, 1)).toBe(0);
    expect(cycleAgent(tree(), 55, 2, -1)).toBe(1);
  });

  it("offers only the orchestrator before any subagent starts", () => {
    expect(cycleAgent(tree(), 5, -1, 1)).toBe(0);
    expect(cycleAgent(tree(), 5, 0, 1)).toBe(0);
  });
});

describe("sceneFraming", () => {
  it("frames the whole window at the board's 100 px per unit on a 1440x900 screen", () => {
    expect(sceneFraming({ width: 1440, height: 900 }, null)).toEqual({ pxPerUnit: 100, offsetX: 0, offsetY: 0 });
  });

  it("fits the phone's band to 8 units, centred on the band", () => {
    const f = sceneFraming({ width: 390, height: 844 }, { top: 160, height: 300 });
    expect(f.pxPerUnit).toBeCloseTo(37.5);
    expect(f.offsetX).toBe(0);
    expect(f.offsetY).toBe(112);
  });

  it("fits the station ring and its labels inside a desktop frame, centred on it", () => {
    const f = sceneFraming({ width: 1440, height: 900 }, { top: 90, height: 652, left: 340, width: 740, fit: "stations" });
    // The width binds: 740 px over the ring's 7.9 units with its side labels.
    expect(f.pxPerUnit).toBeCloseTo(740 / 7.9);
    expect(f.offsetX).toBe(10);
    expect(f.offsetY).toBe(450 - 416);
  });

  it("never zooms a desktop frame past the board's scale", () => {
    const f = sceneFraming({ width: 2560, height: 900 }, { top: 0, height: 900, left: 0, width: 2560, fit: "stations" });
    expect(f.pxPerUnit).toBe(100);
  });
});

describe("pickTarget", () => {
  const agents = [{ id: 3, x: 100, y: 100 }];
  const stations = [
    { id: 0, x: 110, y: 100 },
    { id: 7, x: 300, y: 300 },
  ];

  it("takes the agent when one is in reach, even with a station nearer", () => {
    expect(pickTarget(agents, stations, 108, 100, 30)).toEqual({ kind: "agent", id: 3 });
  });

  it("reports the station when no agent is in reach", () => {
    expect(pickTarget(agents, stations, 295, 296, 30)).toEqual({ kind: "station", key: STATIONS[7] });
  });

  it("reports nothing in empty space", () => {
    expect(pickTarget(agents, stations, 600, 600, 30)).toBeNull();
  });
});

describe("the world is spread out through depth", () => {
  it("puts subagents several cloud radii from their parents and spreads them in z", () => {
    const trace = generateTrace(50, "medium");
    // The busiest moment: the spawn time with the most agents running.
    const live = (t: number) => trace.agents.filter((a) => a.parent >= 0 && t >= a.spawnT + SPAWN_TIME && (!a.returned || t < a.returnT)).length;
    const t = trace.agents.map((a) => a.spawnT + SPAWN_TIME + 0.1).reduce((best, x) => (live(x) > live(best) ? x : best), 0);
    const parent = newPose();
    const child = newPose();
    const zs: number[] = [];
    for (const a of trace.agents) {
      if (a.parent < 0 || t < a.spawnT + SPAWN_TIME || (a.returned && t > a.returnT)) continue;
      agentPose(trace, a.id, t, child);
      agentPose(trace, a.parent, t, parent);
      // A cloud is about 1.1 units across its radius: well clear of its parent's.
      expect(dist(child, parent)).toBeGreaterThan(ORBIT_RADIUS[Math.min(a.depth, 3)] * 0.8);
      zs.push(child.z);
    }
    expect(zs.length).toBeGreaterThan(3);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(3);
  });
});
