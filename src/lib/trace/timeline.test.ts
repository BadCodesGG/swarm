import { describe, expect, it } from "vitest";
import { generateTrace } from "./generate";
import { IDLE_GAP, IDLE_KEEP, buildTimeline, particleLife } from "./timeline";
import type { SessionTrace, TraceAgent, TraceEvent, Usage } from "./types";

const U = (n: number): Usage => ({ input: n, output: 2 * n, cacheRead: 3 * n, cacheWrite: 4 * n });

function agent(over: Partial<TraceAgent>): TraceAgent {
  return {
    id: 0,
    parent: -1,
    depth: 0,
    model: "opus",
    modelId: "claude-opus-sample",
    agentType: "main",
    label: "a",
    spawnT: 0,
    returnT: 0,
    returned: false,
    background: false,
    usage: U(0),
    toolCalls: 0,
    childMissing: false,
    ...over,
  };
}

/** Events at 0, 1, 2, 3 (spawn), 5, 6 (return), then a 600 s idle, then 606, 700, then a 130 s gap, then 830. */
function gappy(): SessionTrace {
  const events: TraceEvent[] = [
    { t: 0, agent: 0, kind: "prompt" },
    { t: 1, agent: 0, kind: "turn", usage: U(1) },
    { t: 2, agent: 0, kind: "call", category: "web", tool: "WebSearch" },
    { t: 3, agent: 0, kind: "spawn", category: "agents", tool: "Agent", child: 1 },
    { t: 5, agent: 0, kind: "result", category: "web", tool: "WebSearch", call: 2 },
    { t: 6, agent: 0, kind: "return", child: 1, call: 3 },
    { t: 606, agent: 0, kind: "turn", usage: U(10) },
    { t: 700, agent: 0, kind: "turn", usage: U(100) },
    { t: 830, agent: 0, kind: "turn", usage: U(1000) },
  ];
  return {
    version: 1,
    source: "sample",
    label: "gappy",
    duration: 830,
    agents: [agent({ returnT: 830 }), agent({ id: 1, parent: 0, depth: 1, spawnT: 3, returnT: 6, returned: true })],
    events,
    truncated: false,
  };
}

/** Counters computed the slow way: scan every event with t <= time. */
function direct(trace: SessionTrace, time: number) {
  let tokens = 0;
  let toolCalls = 0;
  let spawned = 0;
  let returned = 0;
  for (const e of trace.events) {
    if (e.t > time) break;
    if (e.kind === "turn" && e.usage) tokens += e.usage.input + e.usage.output + e.usage.cacheRead + e.usage.cacheWrite;
    if (e.kind === "call" || e.kind === "spawn") toolCalls++;
    if (e.kind === "spawn") spawned++;
    if (e.kind === "return") returned++;
  }
  return {
    tokens,
    toolCalls,
    agentsSpawned: spawned,
    agentsActive: 1 + spawned - returned,
    elapsed: Math.min(Math.max(time, 0), trace.duration),
  };
}

describe("indexAt", () => {
  const tl = buildTimeline(gappy());
  it("is the first event with t > time", () => {
    expect(tl.indexAt(-1)).toBe(0);
    expect(tl.indexAt(0)).toBe(1);
    expect(tl.indexAt(2.5)).toBe(3);
    expect(tl.indexAt(830)).toBe(9);
    expect(tl.indexAt(9999)).toBe(9);
  });
});

describe("countersAt", () => {
  it("seeking equals playing through, on the hand-built trace", () => {
    const trace = gappy();
    const tl = buildTimeline(trace);
    // Play through: accumulate event by event and compare at each event time.
    const acc = { tokens: 0, toolCalls: 0, agentsSpawned: 0, agentsActive: 1, elapsed: 0 };
    for (const e of trace.events) {
      if (e.kind === "turn" && e.usage) acc.tokens += e.usage.input + e.usage.output + e.usage.cacheRead + e.usage.cacheWrite;
      if (e.kind === "call" || e.kind === "spawn") acc.toolCalls++;
      if (e.kind === "spawn") {
        acc.agentsSpawned++;
        acc.agentsActive++;
      }
      if (e.kind === "return") acc.agentsActive--;
      acc.elapsed = e.t;
      // Several events can share a timestamp; only compare when the next event is later.
      expect(tl.countersAt(e.t)).toEqual({ ...direct(trace, e.t), elapsed: e.t });
    }
    expect(tl.countersAt(trace.duration)).toEqual({ ...acc, elapsed: trace.duration });
  });

  it("matches a direct scan at arbitrary times on generated traces", () => {
    for (const size of ["small", "medium"] as const) {
      const trace = generateTrace(3, size);
      const tl = buildTimeline(trace);
      for (let k = -1; k <= 60; k++) {
        const time = (trace.duration * k) / 60;
        expect(tl.countersAt(time)).toEqual(direct(trace, time));
      }
    }
  });

  it("reports the orchestrator as active on an empty trace", () => {
    const tl = buildTimeline({ ...gappy(), events: [], duration: 10 });
    expect(tl.countersAt(5)).toEqual({ tokens: 0, toolCalls: 0, agentsSpawned: 0, agentsActive: 1, elapsed: 5 });
  });
});

describe("idle compression", () => {
  const tl = buildTimeline(gappy());

  it("cuts each gap over the threshold and reports it", () => {
    expect(tl.cuts).toEqual([
      { at: 6, removed: 600 - IDLE_KEEP },
      { at: 6 + IDLE_KEEP + 94, removed: 130 - IDLE_KEEP },
    ]);
    expect(tl.playbackDuration).toBeCloseTo(830 - 592 - 122, 9);
  });

  it("leaves gaps at or under the threshold alone", () => {
    const trace = gappy();
    trace.events[7].t = 606 + IDLE_GAP; // exactly the threshold is not cut
    trace.events[8].t = trace.events[7].t + IDLE_GAP;
    trace.duration = trace.events[8].t;
    expect(buildTimeline(trace).cuts).toHaveLength(1);
  });

  it("maps are inverse and monotonic", () => {
    let prevPb = -1;
    for (let x = 0; x <= 830; x += 0.5) {
      const pb = tl.toPlayback(x);
      expect(pb).toBeGreaterThanOrEqual(prevPb);
      prevPb = pb;
      expect(tl.toTrace(pb)).toBeCloseTo(x, 6);
    }
    let prevT = -1;
    for (let pb = 0; pb <= tl.playbackDuration; pb += 0.25) {
      const x = tl.toTrace(pb);
      expect(x).toBeGreaterThanOrEqual(prevT);
      prevT = x;
      expect(tl.toPlayback(x)).toBeCloseTo(pb, 6);
    }
  });

  it("clamps outside the session", () => {
    expect(tl.toPlayback(-5)).toBe(0);
    expect(tl.toPlayback(9999)).toBe(tl.playbackDuration);
    expect(tl.toTrace(-5)).toBe(0);
    expect(tl.toTrace(9999)).toBe(830);
  });

  it("is the identity when nothing is idle", () => {
    const t = buildTimeline({ ...gappy(), events: gappy().events.slice(0, 6), duration: 6 });
    expect(t.cuts).toEqual([]);
    expect(t.playbackDuration).toBe(6);
    expect(t.toPlayback(4.2)).toBe(4.2);
  });

  it("packs playback times per event, monotonic", () => {
    const pb = tl.arrays.playback;
    for (let i = 1; i < pb.length; i++) expect(pb[i]).toBeGreaterThanOrEqual(pb[i - 1]);
    expect(pb[6]).toBeCloseTo(6 + IDLE_KEEP, 9);
  });

  it("compresses a generated large trace that has a long idle stretch", () => {
    const trace = generateTrace(1, "large");
    const t = buildTimeline(trace);
    expect(t.cuts.length).toBeGreaterThan(0);
    expect(t.playbackDuration).toBeLessThan(trace.duration);
  });
});

describe("visibleAt", () => {
  it("brackets exactly the live particles", () => {
    const trace = generateTrace(2, "small");
    const tl = buildTimeline(trace);
    const pb = tl.arrays.playback;
    for (const rate of [1, 4, 25, 60, 200]) {
      const span = particleLife(rate) * rate;
      for (let k = 0; k <= 40; k++) {
        const time = (trace.duration * k) / 40;
        const [lo, hi] = tl.visibleAt(time, rate);
        const now = tl.toPlayback(time);
        const alive: number[] = [];
        pb.forEach((p, i) => {
          if (p <= now && p > now - span && trace.events[i].t <= time) alive.push(i);
        });
        if (alive.length === 0) expect(lo).toBe(hi);
        else {
          expect(lo).toBe(alive[0]);
          expect(hi).toBe(alive[alive.length - 1] + 1);
        }
      }
    }
  });

  it("lets an event live 0.4 to 2 real seconds at any rate", () => {
    for (const rate of [0.5, 1, 2, 10, 25, 100, 200]) {
      const life = particleLife(rate);
      expect(life).toBeGreaterThanOrEqual(0.4);
      expect(life).toBeLessThanOrEqual(2);
    }
    expect(particleLife(1)).toBe(2);
    expect(particleLife(200)).toBe(0.4);
  });

  it("uses playback time so a cut idle stretch does not hide live events", () => {
    const tl = buildTimeline(gappy());
    // At rate 1 an event lives 2 playback s: the turn at 606 follows the return at 6 by 8 playback s.
    expect(tl.visibleAt(606, 1)).toEqual([6, 7]);
    // At rate 25 it lives 25 * 0.4 = 10 playback s, which reaches back over the 8 s cut to the events at t=5 and 6.
    const [lo, hi] = tl.visibleAt(606, 25);
    expect(hi).toBe(7);
    expect(lo).toBe(4);
  });
});
