import { describe, expect, it } from "vitest";
import { TRACE_LIMITS, type SessionTrace, type TraceAgent, type Usage } from "./types";
import { validateTrace } from "./validate";

const U: Usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };

function agent(over: Partial<TraceAgent>): TraceAgent {
  return {
    id: 0,
    parent: -1,
    depth: 0,
    model: "opus",
    modelId: "claude-opus-sample",
    agentType: "main",
    label: "agent",
    spawnT: 0,
    returnT: 100,
    returned: false,
    background: false,
    usage: U,
    toolCalls: 0,
    childMissing: false,
    ...over,
  };
}

/** Orchestrator plus one child that runs 10..40 and makes one call. */
function valid(): SessionTrace {
  return {
    version: 1,
    source: "sample",
    label: "fixture",
    duration: 100,
    agents: [agent({}), agent({ id: 1, parent: 0, depth: 1, spawnT: 10, returnT: 40, returned: true })],
    events: [
      { t: 0, agent: 0, kind: "prompt", excerpt: "build it" },
      { t: 10, agent: 0, kind: "spawn", category: "agents", tool: "Agent", child: 1 },
      { t: 12, agent: 1, kind: "turn", usage: U, excerpt: "looking" },
      { t: 13, agent: 1, kind: "call", category: "files", tool: "Read" },
      { t: 14, agent: 1, kind: "result", category: "files", tool: "Read", call: 3 },
      { t: 40, agent: 0, kind: "return", child: 1, call: 1, excerpt: "done" },
      { t: 50, agent: 0, kind: "turn", usage: U },
    ],
    truncated: false,
  };
}

function broken(edit: (t: SessionTrace) => void): string[] {
  const t = valid();
  edit(t);
  return validateTrace(t);
}

describe("validateTrace", () => {
  it("accepts a valid hand-built trace", () => {
    expect(validateTrace(valid())).toEqual([]);
  });

  it.each<[string, (t: SessionTrace) => void, RegExp]>([
    ["version", (t) => ((t as { version: number }).version = 2), /version/],
    ["unsorted events", (t) => (t.events[4].t = 5), /not sorted/],
    ["event t beyond duration", (t) => (t.events[6].t = 101), /outside \[0, duration\]/],
    ["event agent id missing", (t) => (t.events[2].agent = 9), /does not exist/],
    ["agent id mismatch", (t) => (t.agents[1].id = 5), /has id/],
    ["agent 0 parent", (t) => (t.agents[0].parent = 0), /parent -1/],
    ["parent not earlier", (t) => (t.agents[1].parent = 1), /earlier agent/],
    ["depth", (t) => (t.agents[1].depth = 3), /depth/],
    ["child event before spawnT", (t) => (t.events[2].t = 9), /outside \[spawnT, returnT\]|not sorted/],
    ["child event after returnT", (t) => (t.agents[1].returnT = 13), /outside \[spawnT, returnT\]/],
    ["return without spawn", (t) => (t.events[5].call = 0), /no matching earlier spawn/],
    ["return to missing child", (t) => (t.events[5].child = 7), /does not exist/],
    ["result without call", (t) => (t.events[4].call = 1), /no matching earlier call/],
    ["result linked to another agent's call", (t) => (t.events[4].agent = 0), /no matching earlier call|outside/],
    ["call has two results", (t) => t.events.splice(5, 0, { t: 14.5, agent: 1, kind: "result", call: 3 }), /more than one result/],
    ["agent never spawned", (t) => t.events.splice(1, 1), /no spawn event|no matching earlier spawn/],
    ["returned agent with no return", (t) => t.events.splice(5, 1), /no return event/],
    ["unreturned agent not at duration", (t) => (t.agents[1].returned = false), /never returned/],
    ["spawn off spawnT", (t) => (t.agents[1].spawnT = 11), /not at agent 1 spawnT|outside/],
    ["excerpt over 280", (t) => (t.events[2].excerpt = "x".repeat(281)), /excerpt/],
    ["prompt over 2000", (t) => (t.events[0].excerpt = "x".repeat(2001)), /excerpt/],
    ["spawn brief over 280", (t) => (t.events[1].excerpt = "x".repeat(281)), /excerpt/],
    ["negative result size", (t) => (t.events[4].size = -1), /size/],
    ["non-finite result size", (t) => (t.events[4].size = Number.NaN), /size/],
    ["negative think time", (t) => (t.events[2].thinkMs = -5), /thinkMs/],
    ["unknown permission source", (t) => ((t.events[4] as { permission?: string }).permission = "root"), /permission/],
    ["compact without data", (t) => t.events.splice(6, 0, { t: 45, agent: 0, kind: "compact" }), /known trigger/],
    ["compact with a bad number", (t) => t.events.splice(6, 0, { t: 45, agent: 0, kind: "compact", compact: { trigger: "auto", preTokens: -1, postTokens: 0, durationMs: 0 } }), /negative or invalid/],
    ["compact with an unknown trigger", (t) => t.events.splice(6, 0, { t: 45, agent: 0, kind: "compact", compact: { trigger: "never" as "auto", preTokens: 1, postTokens: 0, durationMs: 0 } }), /known trigger/],
    ["compact data on a turn", (t) => (t.events[6].compact = { trigger: "auto", preTokens: 1, postTokens: 0, durationMs: 0 }), /not a compact event/],
    ["label over 80", (t) => (t.agents[1].label = "x".repeat(81)), /label/],
    ["no agents", (t) => (t.agents = []), /no agents/],
  ])("rejects: %s", (_name, edit, re) => {
    const msgs = broken(edit);
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.join("\n")).toMatch(re);
  });

  it("accepts the brief, permission, size, think time, failed-launch and compact fields", () => {
    const t = valid();
    t.events[1].excerpt = "x".repeat(TRACE_LIMITS.excerpt);
    t.events[1].isError = true;
    t.events[2].thinkMs = 869;
    t.events[4].permission = "user";
    t.events[4].size = 1200;
    t.events.splice(6, 0, { t: 45, agent: 0, kind: "compact", compact: { trigger: "manual", preTokens: 688982, postTokens: 15074, durationMs: 68972 } });
    expect(validateTrace(t)).toEqual([]);
  });

  it("rejects too many events and too many agents", () => {
    const t = valid();
    t.events = Array.from({ length: TRACE_LIMITS.events + 1 }, () => ({ t: 1, agent: 0, kind: "turn" as const }));
    expect(validateTrace(t).join("\n")).toMatch(/events exceeds the cap/);

    const u = valid();
    u.agents = Array.from({ length: TRACE_LIMITS.agents + 1 }, (_, i) =>
      agent({ id: i, parent: i === 0 ? -1 : 0, depth: i === 0 ? 0 : 1 }),
    );
    expect(validateTrace(u).join("\n")).toMatch(/agents exceeds the cap/);
  });
});
