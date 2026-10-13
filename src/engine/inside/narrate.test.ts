import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import { buildTimeline } from "@/lib/trace/timeline";
import type { SessionTrace, TraceAgent, TraceEvent } from "@/lib/trace/types";
import { HERO } from "./params";
import { currentActivity, narrate } from "./narrate";

const U = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };

function agent(id: number, parent: number, depth: number, model: TraceAgent["model"], spawnT: number, returnT: number): TraceAgent {
  return {
    id, parent, depth, model, modelId: "m", agentType: "general", label: `agent ${id}`, spawnT, returnT,
    returned: id !== 0, background: false, usage: U, toolCalls: 0, childMissing: false,
  };
}

function trace(agents: TraceAgent[], events: TraceEvent[], duration = 100): SessionTrace {
  return { version: 1, source: "sample", label: "t", duration, agents, events, truncated: false };
}

const call = (t: number, a: number, category: TraceEvent["category"], tool: string): TraceEvent => ({ t, agent: a, kind: "call", category, tool });

describe("narrate", () => {
  const tr = trace(
    [agent(0, -1, 0, "opus", 0, 100), agent(1, 0, 1, "fable", 10, 90), agent(2, 1, 2, "sonnet", 12, 80), agent(3, 0, 1, "opus", 10, 90)],
    [
      { t: 0, agent: 0, kind: "prompt", excerpt: "SECRET PROMPT TEXT" },
      { t: 10, agent: 0, kind: "spawn", category: "agents", tool: "Agent", child: 1 },
      { t: 10.1, agent: 0, kind: "spawn", category: "agents", tool: "Agent", child: 3 },
      { t: 12, agent: 1, kind: "spawn", category: "agents", tool: "Agent", child: 2 },
      call(20, 1, "web", "WebSearch"),
      call(21, 2, "web", "WebSearch"),
      call(22, 3, "edit", "Edit"),
    ],
  );
  const tl = buildTimeline(tr);

  it("names live agents by model and what each is doing", () => {
    const s = narrate(tl, 25);
    expect(s).toBe(
      "The orchestrator is running two helpers: one Opus and one Fable, and one of them started a Sonnet helper. A Fable helper and a Sonnet helper are searching the web and an Opus helper is editing files.",
    );
  });

  it("is deterministic and never quotes session text", () => {
    expect(narrate(tl, 25)).toBe(narrate(tl, 25));
    expect(narrate(tl, 0.5)).not.toContain("SECRET");
  });

  it("covers the quiet states", () => {
    expect(narrate(tl, 0.5)).toBe("The session is just starting. The orchestrator is reading the first prompt.");
    expect(narrate(tl, 99.9)).toMatch(/^Nothing is running right now|^The orchestrator is running/);
    expect(narrate(tl, 100)).toMatch(/^The session is over\./);
  });

  it("reports a lone orchestrator's tool", () => {
    const solo = trace([agent(0, -1, 0, "opus", 0, 100)], [call(5, 0, "files", "Read")]);
    expect(narrate(buildTimeline(solo), 6)).toBe("The orchestrator is working alone, reading and searching files.");
    expect(currentActivity(buildTimeline(solo), 0, 60)).toBeNull();
  });

  it("describes the hero frame in one or two sentences", () => {
    const hero = buildTimeline(generateTrace(HERO.seed, HERO.source));
    const s = narrate(hero, HERO.t);
    expect(s.split(/(?<=\.) /).length).toBeLessThanOrEqual(2);
    expect(s).toMatch(/^(The orchestrator |[A-Z][a-z]+ helpers are running)/);
  });
});

describe("narrate a crowd", () => {
  it("counts a crowd by model and activity instead of naming each", () => {
    const agents = [agent(0, -1, 0, "opus", 0, 100)];
    const events: TraceEvent[] = [];
    const models = ["opus", "sonnet", "sonnet", "haiku"] as const;
    models.forEach((m, i) => {
      agents.push(agent(i + 1, 0, 1, m, 1, 90));
      events.push(call(5 + i, i + 1, i < 3 ? "web" : "edit", i < 3 ? "WebSearch" : "Edit"));
    });
    const s = narrate(buildTimeline(trace(agents, events)), 20);
    expect(s).toBe("Four helpers are running: two Sonnet, one Opus and one Haiku. Three are searching the web and one is editing files.");
  });
});
