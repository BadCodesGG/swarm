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

/** Sentences in a narration line. */
const sentences = (s: string) => s.split(/(?<=\.) /);

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

  it("names each live agent by model, with what it is doing, in short present-tense sentences", () => {
    expect(narrate(tl, 25)).toBe("A Fable helper and its Sonnet helper are searching the web. An Opus helper is editing files.");
  });

  it("is deterministic and never quotes session text", () => {
    expect(narrate(tl, 25)).toBe(narrate(tl, 25));
    expect(narrate(tl, 0.5)).not.toContain("SECRET");
  });

  it("covers the quiet states", () => {
    expect(narrate(tl, 0.5)).toBe("The session is starting. The orchestrator is reading the first prompt.");
    expect(narrate(tl, 99.9)).toBe("Nothing is running. The session is waiting for the next prompt.");
    expect(narrate(tl, 100)).toBe("The session is over. The orchestrator and three helpers made six tool calls.");
    expect(narrate(buildTimeline(trace([agent(0, -1, 0, "opus", 0, 100)], [])), 0)).toBe("Nothing has happened yet.");
  });

  it("reports a lone orchestrator's tool", () => {
    const solo = trace([agent(0, -1, 0, "opus", 0, 100)], [call(5, 0, "files", "Read")]);
    expect(narrate(buildTimeline(solo), 6)).toBe("The orchestrator is reading files on its own.");
    expect(narrate(buildTimeline(solo), 100)).toBe("The session is over. The orchestrator made one tool call.");
    expect(currentActivity(buildTimeline(solo), 0, 60)).toBeNull();
  });

  it("joins a third activity into the second sentence while every agent is named", () => {
    const three = trace(
      [agent(0, -1, 0, "opus", 0, 100), agent(1, 0, 1, "fable", 1, 90), agent(2, 0, 1, "opus", 1, 90), agent(3, 0, 1, "haiku", 1, 90)],
      [call(5, 1, "web", "WebSearch"), call(6, 2, "edit", "Edit"), call(7, 3, "plan", "TodoWrite")],
    );
    expect(narrate(buildTimeline(three), 10)).toBe(
      "A Fable helper is searching the web. An Opus helper is editing files and a Haiku helper is updating the plan.",
    );
  });

  it("puts agents with no recent call last, as thinking, even when they outnumber the busy ones", () => {
    const quiet = trace(
      [agent(0, -1, 0, "opus", 0, 100), agent(1, 0, 1, "sonnet", 1, 90), agent(2, 0, 1, "haiku", 1, 90), agent(3, 0, 1, "opus", 1, 90)],
      [call(5, 2, "shell", "Bash")],
    );
    expect(narrate(buildTimeline(quiet), 10)).toBe("A Haiku helper is running commands. An Opus helper and a Sonnet helper are thinking.");
  });

  it("describes the hero frame in two sentences short enough for two phone lines", () => {
    const hero = buildTimeline(generateTrace(HERO.seed, HERO.source));
    const s = narrate(hero, HERO.t);
    expect(sentences(s).length).toBeLessThanOrEqual(2);
    expect(s.length).toBeLessThanOrEqual(100);
    expect(s).toMatch(/^([A-Z][a-z]+ helpers are at work\.|An? (Opus|Fable|Sonnet|Haiku) helper|The orchestrator |Nothing )/);
  });
});

describe("narrate a crowd", () => {
  it("counts a crowd, then names its two busiest activities", () => {
    const agents = [agent(0, -1, 0, "opus", 0, 100)];
    const events: TraceEvent[] = [];
    const models = ["opus", "sonnet", "sonnet", "haiku", "sonnet"] as const;
    const cats = ["web", "web", "web", "edit", "plan"] as const;
    models.forEach((m, i) => {
      agents.push(agent(i + 1, 0, 1, m, 1, 90));
      events.push(call(5 + i, i + 1, cats[i], "Tool"));
    });
    const s = narrate(buildTimeline(trace(agents, events)), 20);
    expect(s).toBe("Five helpers are at work. Three are searching the web and a Haiku helper is editing files.");
  });

  it("names a crowd group by model when it shares one", () => {
    const agents = [agent(0, -1, 0, "opus", 0, 100)];
    const events: TraceEvent[] = [];
    (["sonnet", "sonnet", "haiku", "haiku"] as const).forEach((m, i) => {
      agents.push(agent(i + 1, 0, 1, m, 1, 90));
      events.push(call(5 + i, i + 1, m === "sonnet" ? "shell" : "files", "Tool"));
    });
    expect(narrate(buildTimeline(trace(agents, events)), 20)).toBe(
      "Four helpers are at work. Two Sonnet helpers are running commands and two Haiku helpers are reading files.",
    );
  });
});
