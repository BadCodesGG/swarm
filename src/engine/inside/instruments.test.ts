import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import { agent, trace as literal, usage } from "@/lib/trace/test-trace";
import { buildTimeline } from "@/lib/trace/timeline";
import type { TraceEvent } from "@/lib/trace/types";
import { buildInstruments, CONTEXT_WINDOW } from "./instruments";

const mk = (events: TraceEvent[], agents = [agent(0)]) => buildInstruments(buildTimeline(literal(events, agents)));

describe("instruments on a sample", () => {
  const trace = generateTrace(4, "medium");
  const tl = buildTimeline(trace);
  const inst = buildInstruments(tl);

  it("agrees with the timeline's counters", () => {
    for (const t of [0, trace.duration / 3, trace.duration]) {
      const c = tl.countersAt(t);
      expect(inst.agentsAt(t)).toEqual({ spawned: c.agentsSpawned, active: c.agentsActive });
      const mix = inst.toolMixAt(t);
      expect(Object.values(mix).reduce((a, b) => a + b, 0)).toBe(c.toolCalls);
      expect(Object.values(inst.modelMixAt(t)).reduce((a, b) => a + b, 0)).toBe(c.tokens);
    }
  });

  it("is monotone in the cumulative series and bounded in the gauge", () => {
    let prev = 0;
    for (let k = 0; k <= 20; k++) {
      const t = (k / 20) * trace.duration;
      const spent = Object.values(inst.modelMixAt(t)).reduce((a, b) => a + b, 0);
      expect(spent).toBeGreaterThanOrEqual(prev);
      prev = spent;
      const g = inst.contextAt(t);
      expect(g.fraction).toBeGreaterThanOrEqual(0);
      expect(g.fraction).toBeLessThanOrEqual(1);
    }
  });

  it("drops the gauge at the compaction", () => {
    const big = generateTrace(4, "large");
    const inst = buildInstruments(buildTimeline(big));
    const c = big.events.find((e) => e.kind === "compact")!;
    expect(inst.contextAt(c.t).tokens).toBe(c.compact!.postTokens);
    expect(inst.contextAt(c.t - 0.001).tokens).toBeGreaterThan(c.compact!.postTokens);
  });

  it("samples a token-rate series of the asked length", () => {
    const s = inst.tokensPerMinuteSeries(30);
    expect(s).toHaveLength(30);
    expect(s.every((v) => v >= 0 && Number.isFinite(v))).toBe(true);
    expect(s.some((v) => v > 0)).toBe(true);
    expect(inst.tokensPerMinuteSeries(1)).toHaveLength(1);
    expect(inst.tokensPerMinuteSeries(0)).toEqual([]);
  });

  it("returns the last N log lines oldest first, with no raw excerpts", () => {
    const log = inst.logAt(trace.duration, 6);
    expect(log).toHaveLength(6);
    for (let i = 1; i < log.length; i++) expect(log[i].t).toBeGreaterThanOrEqual(log[i - 1].t);
    const quotes = new Set(trace.events.flatMap((e) => (e.excerpt ? [e.excerpt] : [])));
    for (const l of inst.logAt(trace.duration, 50)) for (const q of quotes) expect(l.text).not.toContain(q);
  });

  it("caches per timeline", () => {
    expect(buildInstruments(tl)).toBe(inst);
  });
});

describe("instruments on literals", () => {
  it("computes the rate over a rolling minute", () => {
    const turns: TraceEvent[] = [10, 70].map((t) => ({ t, agent: 0, kind: "turn", usage: { input: 600, output: 0, cacheRead: 0, cacheWrite: 0 } }));
    const inst = mk(turns);
    expect(inst.tokensPerMinuteAt(10)).toBe(600 * 60 / 10);
    expect(inst.tokensPerMinuteAt(75)).toBe(600); // only the second turn sits in (15, 75]
    expect(inst.tokensPerMinuteAt(0)).toBe(0);
  });

  it("reads the gauge from input + cacheRead + cacheWrite, against the nominal window", () => {
    const inst = mk([
      { t: 5, agent: 0, kind: "turn", usage: { input: 100_000, output: 5000, cacheRead: 200_000, cacheWrite: 50_000 } },
      { t: 50, agent: 0, kind: "compact", compact: { trigger: "manual", preTokens: 350_000, postTokens: 20_000, durationMs: 1000 } },
      { t: 60, agent: 0, kind: "turn", usage: { input: 30_000, output: 1, cacheRead: 0, cacheWrite: 0 } },
    ]);
    expect(inst.contextAt(1)).toEqual({ tokens: 0, fraction: 0 });
    expect(inst.contextAt(5).tokens).toBe(350_000);
    expect(inst.contextAt(5).fraction).toBe(350_000 / CONTEXT_WINDOW);
    expect(inst.contextAt(55).tokens).toBe(20_000);
    expect(inst.contextAt(61).tokens).toBe(30_000);
  });

  it("clamps the gauge to 1, and ignores subagent turns", () => {
    const inst = mk(
      [
        { t: 1, agent: 0, kind: "turn", usage: { ...usage, input: CONTEXT_WINDOW * 3 } },
        { t: 2, agent: 1, kind: "turn", usage: { ...usage, input: 5 } },
      ],
      [agent(0), agent(1)],
    );
    expect(inst.contextAt(3).fraction).toBe(1);
    expect(inst.contextAt(3).tokens).toBe(CONTEXT_WINDOW * 3);
  });

  it("splits model tokens by the turn's agent", () => {
    const inst = mk(
      [
        { t: 1, agent: 0, kind: "turn", usage: { ...usage, input: 1000, output: 0 } },
        { t: 2, agent: 1, kind: "turn", usage: { ...usage, input: 10, output: 0 } },
      ],
      [agent(0), agent(1)],
    );
    expect(inst.modelMixAt(3)).toMatchObject({ opus: 1000, sonnet: 10, haiku: 0 });
  });

  it("writes short human log lines from names, tools and numbers", () => {
    const inst = mk(
      [
        { t: 1, agent: 0, kind: "prompt", excerpt: "SECRET" },
        { t: 2, agent: 0, kind: "call", category: "shell", tool: "Bash" },
        { t: 3, agent: 0, kind: "result", category: "shell", tool: "Bash", call: 1, isError: true },
        { t: 4, agent: 0, kind: "spawn", category: "agents", tool: "Agent", child: 1, excerpt: "SECRET" },
        { t: 5, agent: 0, kind: "result", category: "shell", tool: "Bash", call: 1 },
        { t: 6, agent: 0, kind: "return", child: 1, call: 3, excerpt: "SECRET" },
        { t: 7, agent: 0, kind: "compact", compact: { trigger: "auto", preTokens: 842_000, postTokens: 12_000, durationMs: 1 } },
      ],
      [agent(0), agent(1)],
    );
    expect(inst.logAt(10).map((l) => l.text)).toEqual([
      "You sent a prompt",
      "Orchestrator called Bash",
      "Bash failed for Orchestrator",
      "Orchestrator started Sonnet 1",
      "Sonnet 1 reported back to Orchestrator",
      "Context compacted: 842k to 12.0k tokens",
    ]);
    expect(inst.logAt(10, 2)).toHaveLength(2);
    expect(inst.logAt(0)).toEqual([]);
  });

  it("is all zeros on an empty trace and on one with no compaction or usage", () => {
    const inst = mk([]);
    expect(inst.agentsAt(5)).toEqual({ spawned: 0, active: 1 });
    expect(Object.values(inst.toolMixAt(5)).every((n) => n === 0)).toBe(true);
    expect(inst.tokensPerMinuteAt(5)).toBe(0);
    expect(inst.contextAt(5)).toEqual({ tokens: 0, fraction: 0 });
    expect(inst.logAt(5)).toEqual([]);
  });
});
