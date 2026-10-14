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
      { t: 95, agent: 0, kind: "prompt" },
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
    // Waiting on you only where the orchestrator's lane says so: the silence before your next prompt.
    expect(narrate(tl, 92)).toBe("Nothing is running. The session is waiting for the next prompt.");
    expect(narrate(tl, 99.9)).toBe("The orchestrator is thinking on its own.");
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

/** A trace of helpers under the orchestrator, each making one call: `[model, category, parent]`. */
function helpers(spec: readonly (readonly [TraceAgent["model"], TraceEvent["category"] | null, number])[]): SessionTrace {
  const agents = [agent(0, -1, 0, "opus", 0, 100)];
  const events: TraceEvent[] = [];
  spec.forEach(([m, cat, parent], i) => {
    agents.push(agent(i + 1, parent, parent === 0 ? 1 : 2, m, 1, 90));
    if (cat) events.push(call(5 + i, i + 1, cat, "Tool"));
  });
  return trace(agents, events);
}

describe("narrate a few", () => {
  it("names the two busiest activities' agents, as the design's NOW panel does, and leaves the rest", () => {
    const tr = helpers([
      ["fable", "web", 0],
      ["sonnet", "web", 1],
      ["opus", "edit", 0],
      ["haiku", "plan", 0],
      ["sonnet", null, 0],
    ]);
    expect(narrate(buildTimeline(tr), 20)).toBe("A Fable helper and its Sonnet helper are searching the web. An Opus helper is editing files.");
  });

  it("names a group by model when it shares one", () => {
    const tr = helpers([
      ["sonnet", "shell", 0],
      ["sonnet", "shell", 0],
      ["haiku", "files", 0],
      ["haiku", "files", 0],
    ]);
    expect(narrate(buildTimeline(tr), 20)).toBe("Two Sonnet helpers are running commands. Two Haiku helpers are reading files.");
  });

  it("counts a mixed group of three or more instead of naming each", () => {
    const tr = helpers([
      ["opus", "web", 0],
      ["sonnet", "web", 0],
      ["haiku", "web", 0],
      ["haiku", "edit", 0],
    ]);
    expect(narrate(buildTimeline(tr), 20)).toBe("Three helpers are searching the web. A Haiku helper is editing files.");
  });
});

describe("narrate a crowd", () => {
  it("counts a crowd of more than six, then its two busiest activities", () => {
    const tr = helpers([
      ["opus", "web", 0],
      ["sonnet", "web", 0],
      ["sonnet", "web", 0],
      ["haiku", "edit", 0],
      ["sonnet", "plan", 0],
      ["haiku", "shell", 0],
      ["haiku", "shell", 0],
    ]);
    expect(narrate(buildTimeline(tr), 20)).toBe("Seven helpers are at work. Three are searching the web and two Haiku helpers are running commands.");
  });
});
