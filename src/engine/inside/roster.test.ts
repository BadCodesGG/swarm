import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import { agent, trace as literal, usage } from "@/lib/trace/test-trace";
import { buildTimeline } from "@/lib/trace/timeline";
import { agentName, rosterAt } from "./roster";

const events = [
  { t: 1, agent: 0, kind: "turn" as const, usage: { ...usage, input: 500, output: 0 } },
  { t: 10, agent: 0, kind: "spawn" as const, category: "agents" as const, tool: "Agent", child: 1, excerpt: "look at the parser" },
  { t: 11, agent: 0, kind: "spawn" as const, category: "agents" as const, tool: "Agent", child: 2, excerpt: "x", isError: true },
  { t: 12, agent: 1, kind: "turn" as const, usage: { ...usage, input: 40, output: 0 } },
  { t: 30, agent: 0, kind: "return" as const, child: 1, call: 1, excerpt: "found it" },
];
const agents = [agent(0), agent(1, { spawnT: 10, returnT: 30 }), agent(2, { spawnT: 11, returnT: 11 })];

describe("rosterAt", () => {
  const tl = buildTimeline(literal(events, agents));

  it("reports model, brief, tokens, active time, parent and children", () => {
    const [orch, helper] = rosterAt(tl, 20);
    expect(orch).toMatchObject({ id: 0, model: "opus", tokens: 500, activeTime: 20, status: "working", parent: -1, children: [1, 2] });
    expect(helper).toMatchObject({ id: 1, excerpt: "look at the parser", tokens: 40, activeTime: 10, status: "working", parent: 0, children: [] });
  });

  it("moves through waiting, working, done and failed", () => {
    expect(rosterAt(tl, 5).map((r) => r.status)).toEqual(["working", "waiting", "waiting"]);
    expect(rosterAt(tl, 20).map((r) => r.status)).toEqual(["working", "working", "failed"]);
    expect(rosterAt(tl, 40).map((r) => r.status)).toEqual(["working", "done", "failed"]);
    expect(rosterAt(tl, 100)[0].status).toBe("done");
  });

  it("says the orchestrator is waiting on you between your prompts, and a helper during a permission wait", () => {
    const t = literal(
      [
        { t: 1, agent: 0, kind: "call", category: "shell", tool: "Bash" },
        { t: 2, agent: 0, kind: "result", category: "shell", tool: "Bash", call: 0 },
        { t: 10, agent: 0, kind: "spawn", category: "agents", tool: "Agent", child: 1 },
        { t: 12, agent: 1, kind: "call", category: "files", tool: "Read" },
        { t: 18, agent: 1, kind: "result", category: "files", tool: "Read", call: 3, permission: "user" },
        { t: 20, agent: 0, kind: "return", child: 1, call: 2 },
        { t: 50, agent: 0, kind: "prompt" },
      ],
      [agent(0), agent(1, { spawnT: 10, returnT: 20 })],
    );
    const tl2 = buildTimeline(t);
    expect(rosterAt(tl2, 15).map((r) => r.status)).toEqual(["working", "waiting-on-you"]);
    expect(rosterAt(tl2, 30).map((r) => r.status)).toEqual(["waiting-on-you", "done"]);
    expect(rosterAt(tl2, 55).map((r) => r.status)).toEqual(["working", "done"]);
  });

  it("stops the active clock at the return, and starts it at the spawn", () => {
    expect(rosterAt(tl, 99)[1].activeTime).toBe(20);
    expect(rosterAt(tl, 5)[1].activeTime).toBe(0);
  });

  it("degrades without briefs: empty excerpt, never a throw", () => {
    const old = buildTimeline(literal([{ t: 10, agent: 0, kind: "spawn", child: 1 }], [agent(0), agent(1, { spawnT: 10 })]));
    expect(rosterAt(old, 20)[1].excerpt).toBe("");
  });

  it("handles an empty trace and one without subagents", () => {
    expect(rosterAt(buildTimeline(literal([])), 0)).toHaveLength(1);
    expect(rosterAt(buildTimeline(literal([], [])), 0)).toEqual([]);
  });

  it("lists every agent of a sample, children matching parents", () => {
    const t = generateTrace(5, "medium");
    const r = rosterAt(buildTimeline(t), t.duration);
    expect(r).toHaveLength(t.agents.length);
    for (const e of r) for (const c of e.children) expect(t.agents[c].parent).toBe(e.id);
    expect(r.filter((e) => e.id > 0).every((e) => e.excerpt.length > 0)).toBe(true);
  });
});

describe("agentName", () => {
  it("never echoes session text", () => {
    const t = literal([], [agent(0), agent(1, { label: "<img onerror=x>" })]);
    expect(agentName(t, 0)).toBe("Orchestrator");
    expect(agentName(t, 1)).toBe("Sonnet 1");
    expect(agentName(t, 9)).toBe("Agent 9");
  });
});
