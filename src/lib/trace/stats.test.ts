import { describe, expect, it } from "vitest";
import type { Quantiles } from "../rng";
import { createTraceBuilder } from "./build";
import { fixtureFiles, feed } from "./__fixtures__/read";
import { generateTrace } from "./generate";
import { assertCleanStats, CALIBRATION, collectStats, serializeStats, type CalibrationStats } from "./stats";
import type { SessionTrace, TraceAgent, TraceEvent } from "./types";

const usage = { input: 10, output: 20, cacheRead: 30, cacheWrite: 0 };

function agent(over: Partial<TraceAgent> & { id: number }): TraceAgent {
  return {
    parent: -1,
    depth: 0,
    model: "opus",
    modelId: "claude-opus-x",
    agentType: "main",
    label: "",
    spawnT: 0,
    returnT: 100,
    returned: false,
    background: false,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    toolCalls: 0,
    childMissing: false,
    ...over,
  };
}

function trace(agents: TraceAgent[], events: TraceEvent[]): SessionTrace {
  return { version: 1, source: "upload", label: "t", duration: 100, agents, events, truncated: false };
}

const monotone = (q: Quantiles) => {
  const v = [q.p10, q.p25, q.p50, q.p75, q.p90, q.p99];
  return v.every((x, i) => x > 0 && (i === 0 || x >= v[i - 1]));
};

function allQuantiles(stats: CalibrationStats): Quantiles[] {
  return [
    stats.gaps.burst,
    stats.gaps.idle,
    stats.humanGap,
    ...Object.values(stats.latency),
    stats.childDuration,
    stats.childToolCalls,
    ...Object.values(stats.usage).flatMap((u) => Object.values(u)),
  ];
}

const sums = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe("collectStats on a hand-built trace", () => {
  // Turn A makes two calls before either result returns; turn B makes none, 5 s after A's last result.
  const t = trace(
    [agent({ id: 0 }), agent({ id: 1, parent: 0, depth: 1, agentType: "Explore", model: "haiku", background: true, toolCalls: 3, spawnT: 1, returnT: 21, returned: true })],
    [
      { t: 0, agent: 0, kind: "turn", usage },
      { t: 0.1, agent: 0, kind: "call", category: "other", tool: "mcp__secret-server__do_it" },
      { t: 0.2, agent: 0, kind: "call", category: "shell", tool: "Bash" },
      { t: 1, agent: 0, kind: "result", category: "other", tool: "mcp__secret-server__do_it", call: 1, isError: true },
      { t: 2, agent: 0, kind: "result", category: "shell", tool: "Bash", call: 2 },
      { t: 7, agent: 0, kind: "turn", usage },
    ],
  );
  const stats = collectStats([t]);

  it("counts what it read", () => {
    expect(stats.read).toEqual({ sessions: 1, agents: 2, turns: 2, calls: 2 });
  });

  it("histograms calls per turn and finds the parallel pair", () => {
    expect(stats.callsPerTurn[0]).toBe(0.5);
    expect(stats.callsPerTurn[2]).toBe(0.5);
    expect(stats.parallelCallProb).toBe(1);
  });

  it("reads the turn gap as burst and the one error", () => {
    expect(stats.errorRate).toBe(0.5);
    expect(stats.gaps.continueBurst).toBeGreaterThan(0);
  });

  it("collapses tool and agent type names to categories, and leaks neither", () => {
    expect(stats.agentTypeMix.explore).toBe(1);
    expect(stats.backgroundFraction).toBe(1);
    expect(stats.modelMix["1"].haiku).toBe(1);
    const json = JSON.stringify(stats);
    expect(json).not.toMatch(/secret|Explore|Bash|mcp__/);
    assertCleanStats(stats);
  });

  it("splits a gap of 30 seconds or more into the idle state", () => {
    const events: TraceEvent[] = [];
    for (let i = 0; i < 40; i++) events.push({ t: i * 50, agent: 0, kind: "turn", usage });
    const s = collectStats([trace([agent({ id: 0 })], events)]);
    expect(s.gaps.continueIdle).toBe(1);
    expect(s.gaps.idle.p50).toBe(50);
  });
});

describe("collectStats on real-shaped data", () => {
  it("reads the scrubbed fixture into clean stats", () => {
    const b = createTraceBuilder();
    feed(b, fixtureFiles());
    const r = b.finish();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stats = collectStats([r.trace]);
    expect(stats.read.sessions).toBe(1);
    expect(stats.read.agents).toBe(r.trace.agents.length);
    expect(stats.read.turns).toBeGreaterThan(0);
    assertCleanStats(stats);
    expect(sums(stats.callsPerTurn)).toBeCloseTo(1, 2);
  });

  it("recovers the distributions a generator was given", () => {
    const given: CalibrationStats = { ...CALIBRATION, errorRate: 0.4, web: { share: 0.2, search: 0.7 } };
    const traces = [1, 2, 3, 4, 5].map((s) => generateTrace(s, "large", given));
    const stats = collectStats(traces);
    expect(stats.errorRate).toBeGreaterThan(0.37);
    expect(stats.errorRate).toBeLessThan(0.43);
    expect(stats.web.share).toBeGreaterThan(0.15);
    expect(stats.web.share).toBeLessThan(0.25);
    expect(stats.web.search).toBeGreaterThan(0.6);
    expect(stats.web.search).toBeLessThan(0.8);
    expect(stats.core.mix.shell).toBeGreaterThan(0.55);
    assertCleanStats(stats);
  });

  it("is complete and well formed with nothing read", () => {
    const stats = collectStats([]);
    assertCleanStats(stats);
    expect(stats.read.sessions).toBe(0);
    allQuantiles(stats).forEach((q) => expect(monotone(q)).toBe(true));
    for (const h of [stats.callsPerTurn, stats.spawnsPerTurn, stats.groupSize, stats.advisor.position]) {
      expect(sums(h)).toBeCloseTo(1, 1);
    }
  });
});

describe("CALIBRATION", () => {
  it("is the committed output of the calibration script, and clean", () => {
    expect(CALIBRATION.version).toBe(1);
    expect(CALIBRATION.read.sessions).toBeGreaterThan(0);
    assertCleanStats(CALIBRATION);
  });

  it("has the same shape collectStats produces", () => {
    const shape = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(() => 0) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : 0;
    expect(Object.keys(CALIBRATION).sort()).toEqual(Object.keys(collectStats([])).sort());
    expect(shape(CALIBRATION)).toEqual(shape(collectStats([])));
  });

  it("holds valid quantiles and probabilities", () => {
    allQuantiles(CALIBRATION).forEach((q) => expect(monotone(q)).toBe(true));
    for (const p of [CALIBRATION.errorRate, CALIBRATION.parallelCallProb, CALIBRATION.childSpawnProb, CALIBRATION.backgroundFraction, CALIBRATION.advisor.rate, CALIBRATION.web.share, CALIBRATION.web.search]) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    for (const d of Object.values(CALIBRATION.modelMix)) expect(sums(Object.values(d))).toBeCloseTo(1, 2);
    expect(sums(Object.values(CALIBRATION.agentTypeMix))).toBeCloseTo(1, 2);
  });
});

describe("the refusal to write", () => {
  const clean = collectStats([]);
  const poisoned = (f: (s: Record<string, unknown>) => void): CalibrationStats => {
    const copy = JSON.parse(JSON.stringify(clean)) as Record<string, unknown>;
    f(copy);
    return copy as unknown as CalibrationStats;
  };

  it("serializes clean stats to JSON that parses back", () => {
    expect(JSON.parse(serializeStats(clean))).toEqual(clean);
    expect(JSON.parse(serializeStats(CALIBRATION))).toEqual(CALIBRATION);
  });

  it("refuses a string that is not a known category key", () => {
    const bad = poisoned((s) => (s.agentTypeMix = { ...(s.agentTypeMix as object), general: "mcp__github__create_issue" }));
    expect(() => serializeStats(bad)).toThrow(/not a known category key/);
    expect(() => serializeStats(bad)).not.toThrow(/github/);
  });

  it("refuses a path, an id and a name smuggled in as a value", () => {
    for (const leak of ["C:/Users/someone/project", "toolu_01ABCDEF", "my-plugin:reviewer"]) {
      expect(() => assertCleanStats(poisoned((s) => (s.errorRate = leak))), leak).toThrow(/known category key/);
    }
  });

  it("accepts a known category as a string value", () => {
    expect(() => assertCleanStats(poisoned((s) => (s.errorRate = "shell")))).not.toThrow();
  });

  it("refuses an unknown key, such as an MCP server name", () => {
    const bad = poisoned((s) => ((s.latency as Record<string, unknown>)["mcp__github"] = clean.latency.mcp));
    expect(() => serializeStats(bad)).toThrow(/not a known category or field/);
  });

  it("refuses non-finite, negative and non-numeric values", () => {
    expect(() => assertCleanStats(poisoned((s) => (s.errorRate = NaN)))).toThrow();
    expect(() => assertCleanStats(poisoned((s) => (s.errorRate = -1)))).toThrow();
    expect(() => assertCleanStats(poisoned((s) => (s.errorRate = true)))).toThrow();
    expect(() => assertCleanStats(poisoned((s) => (s.errorRate = null)))).toThrow();
  });
});
