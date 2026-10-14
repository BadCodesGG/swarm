import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import { agent, trace as literal, usage } from "@/lib/trace/test-trace";
import { buildRecap } from "./recap";

describe("buildRecap", () => {
  it("counts spawns, peak parallel, failures, compactions and tokens by model", () => {
    const t = literal(
      [
        { t: 1, agent: 0, kind: "turn", usage: { ...usage, input: 1000, output: 0 } },
        { t: 5, agent: 0, kind: "spawn", child: 1 },
        { t: 5, agent: 0, kind: "spawn", child: 2 },
        { t: 6, agent: 0, kind: "spawn", child: 3, isError: true },
        { t: 7, agent: 1, kind: "turn", usage: { ...usage, input: 50, output: 0 } },
        { t: 8, agent: 1, kind: "call", category: "shell", tool: "Bash" },
        { t: 9, agent: 1, kind: "result", category: "shell", tool: "Bash", call: 5, isError: true },
        { t: 20, agent: 0, kind: "compact", compact: { trigger: "auto", preTokens: 9, postTokens: 1, durationMs: 1 } },
      ],
      [agent(0), agent(1, { spawnT: 5, returnT: 15 }), agent(2, { spawnT: 5, returnT: 10 }), agent(3, { spawnT: 6, returnT: 8 })],
    );
    const r = buildRecap(t);
    expect(r).toMatchObject({ agentsSpawned: 3, peakParallel: 3, failedCalls: 2, compactions: 1 });
    expect(r.tokensByModel).toMatchObject({ opus: 1000, sonnet: 50, haiku: 0 });
  });

  it("names the longest wait and what it waited on", () => {
    const t = literal([
      { t: 10, agent: 0, kind: "call", category: "shell", tool: "Bash" },
      { t: 15, agent: 0, kind: "result", category: "shell", tool: "Bash", call: 0, permission: "user" },
      { t: 20, agent: 0, kind: "call", category: "edit", tool: "Edit" },
      { t: 60, agent: 0, kind: "result", category: "edit", tool: "Edit", call: 2, permission: "user" },
    ]);
    const r = buildRecap(t);
    expect(r.longestWait).toMatchObject({ duration: 40, t: 20, on: "permission", tool: "Edit", agent: 0 });
    expect(r.longestWait!.text).toBe("Orchestrator waited on you to allow Edit");
    expect(r.time.waiting).toBe(45);
    expect(r.time.tool).toBe(0);
  });

  it("can name a wait on your next prompt", () => {
    const t = literal([
      { t: 2, agent: 0, kind: "call", category: "shell", tool: "Bash" },
      { t: 3, agent: 0, kind: "result", category: "shell", tool: "Bash", call: 0 },
      { t: 70, agent: 0, kind: "prompt" },
    ]);
    expect(buildRecap(t).longestWait).toMatchObject({ on: "prompt", duration: 67, text: "Orchestrator waited on your next prompt" });
  });

  it("sums think, tool and waiting time", () => {
    const t = literal([
      { t: 10, agent: 0, kind: "turn", usage, thinkMs: 4000 },
      { t: 12, agent: 0, kind: "call", category: "shell", tool: "Bash" },
      { t: 15, agent: 0, kind: "result", category: "shell", tool: "Bash", call: 1 },
    ]);
    expect(buildRecap(t).time).toEqual({ think: 4, tool: 3, waiting: 0 });
  });

  it("degrades to zeros and null on an empty trace, no subagents, or an old upload", () => {
    for (const t of [literal([]), literal([{ t: 1, agent: 0, kind: "call", tool: "Bash" }])]) {
      expect(buildRecap(t)).toEqual({
        agentsSpawned: 0,
        peakParallel: 0,
        tokensByModel: { opus: 0, fable: 0, sonnet: 0, haiku: 0, other: 0 },
        longestWait: null,
        failedCalls: 0,
        compactions: 0,
        time: { think: 0, tool: 0, waiting: 0 },
      });
    }
  });

  it("recaps a large sample", () => {
    const g = generateTrace(6, "large");
    const r = buildRecap(g);
    expect(r.agentsSpawned).toBe(g.agents.length - 1);
    expect(r.peakParallel).toBeGreaterThan(1);
    expect(r.compactions).toBe(1);
    expect(r.time.think + r.time.tool).toBeGreaterThan(0);
    expect(Object.values(r.tokensByModel).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});
