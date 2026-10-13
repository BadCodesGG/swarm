import { describe, expect, it } from "vitest";
import { buildTimeline } from "@/lib/trace/timeline";
import { TRACE_LIMITS, type SessionTrace, type TraceAgent, type TraceEvent } from "@/lib/trace/types";
import { agentPose, featuredAgent, newPose, returnPose } from "./layout";
import { narrate } from "./narrate";

const U = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };

/**
 * The worst a crafted upload can be within the caps: 2,000 agents in one spawn chain (each the child
 * of the one before), all live, and the rest of the 200,000 events crammed into the last 30 seconds
 * by the orchestrator, so every helper's "what is it doing" looks back through all of them.
 */
function capTrace(): SessionTrace {
  const n = TRACE_LIMITS.agents;
  const agents: TraceAgent[] = Array.from({ length: n }, (_, id) => ({
    id, parent: id - 1, depth: id, model: "sonnet", modelId: "m", agentType: "general", label: `agent ${id}`,
    spawnT: id === 0 ? 0 : id * 0.01, returnT: 200, returned: false, background: false, usage: U, toolCalls: 0, childMissing: false,
  }));
  const events: TraceEvent[] = [{ t: 0, agent: 0, kind: "prompt" }];
  for (let id = 1; id < n; id++) events.push({ t: id * 0.01, agent: id - 1, kind: "spawn", category: "agents", tool: "Agent", child: id });
  const rest = TRACE_LIMITS.events - events.length;
  for (let k = 0; k < rest; k++) events.push({ t: 100 + (29 * k) / rest, agent: 0, kind: "call", category: "shell", tool: "Bash" });
  return { version: 1, source: "upload", label: "cap", duration: 200, agents, events, truncated: false };
}

const time = (fn: () => void) => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

describe("a cap-sized trace stays responsive", () => {
  const trace = capTrace();
  const tl = buildTimeline(trace);

  it("narrates one poll in well under a frame budget's worth of the old cost", () => {
    narrate(tl, 129); // the first call may build per-trace indexes
    const ms = time(() => narrate(tl, 129.5));
    // The backward scan took 350 to 890 ms here.
    expect(ms).toBeLessThan(60);
  });

  it("poses every agent for a frame's three passes (agents, tethers, pick) quickly", () => {
    const p = newPose();
    const pass = (t: number) => {
      for (let id = 0; id < trace.agents.length; id++) agentPose(trace, id, t, p);
    };
    pass(129);
    const ms = time(() => {
      for (let k = 0; k < 3; k++) pass(129.5);
      featuredAgent(trace, 129.5);
    });
    // Recursing to the root cost about 142 ms a pass.
    expect(ms).toBeLessThan(60);
  });

  it("draws a frame of trails for a chain that has just returned without re-posing the chain per agent", () => {
    // Every helper returned in the last few seconds, one after another, so each leaves a trail.
    const returned: SessionTrace = { ...trace, agents: trace.agents.map((a) => (a.id === 0 ? a : { ...a, returned: true, returnT: 150 + a.id * 0.001 })) };
    const p = newPose();
    const frame = (t: number) => {
      // As the tethers do: the trail's end (where it orbited), then the live pose.
      for (let id = 1; id < returned.agents.length; id++) {
        returnPose(returned, id, p);
        agentPose(returned, id, t, p);
      }
    };
    frame(152);
    const ms = time(() => frame(152.5));
    expect(ms).toBeLessThan(60);
  });

  it("puts the trail's end where the agent was when it returned", () => {
    const small: SessionTrace = { ...trace, agents: trace.agents.slice(0, 4).map((a) => (a.id === 0 ? a : { ...a, returned: true, returnT: 150 + a.id })) };
    const a = newPose();
    const b = newPose();
    returnPose(small, 3, a);
    agentPose(small, 3, 153, b);
    expect([a.x, a.y, a.z]).toEqual([b.x, b.y, b.z]);
  });
});
