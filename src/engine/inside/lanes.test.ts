import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import { buildTimeline } from "@/lib/trace/timeline";
import { agent, trace as literal } from "@/lib/trace/test-trace";
import type { TraceEvent } from "@/lib/trace/types";
import { axisTicks, barHeight, buildAgentLanes, buildLanes, HUMAN_GAP_MIN, lanesOf, RETRY_WINDOW, waitingOnYouAt } from "./lanes";

describe("lanes", () => {
  const trace = generateTrace(1, "medium");
  const tl = buildTimeline(trace);
  const lanes = buildLanes(tl);

  it("bins every event exactly once", () => {
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(lanes.prompts).toHaveLength(120);
    expect(sum(lanes.prompts)).toBe(trace.events.filter((e) => e.kind === "prompt").length);
    expect(sum(lanes.agents)).toBe(trace.events.filter((e) => e.kind === "spawn").length);
    expect(sum(lanes.tools)).toBe(trace.events.filter((e) => e.kind === "call" || e.kind === "spawn").length);
  });

  it("colours an agent bin by its spawned child's model", () => {
    const e = trace.events.find((x) => x.kind === "spawn")!;
    const bin = Math.min(119, Math.floor((tl.toPlayback(e.t) / tl.playbackDuration) * 120));
    expect(lanes.agents[bin]).toBeGreaterThan(0);
    expect(trace.agents.map((a) => a.model)).toContain(lanes.agentModel[bin]);
  });

  it("sizes bars", () => {
    expect(barHeight(0, 10, 20)).toBe(1);
    expect(barHeight(1, 100, 20)).toBe(3);
    expect(barHeight(10, 10, 20)).toBe(20);
  });

  it("places axis ticks in order inside the track", () => {
    const ticks = axisTicks(tl);
    expect(ticks[0]).toEqual({ at: 0, label: "00:00" });
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].at).toBeGreaterThan(ticks[i - 1].at);
    expect(ticks[ticks.length - 1].at).toBeLessThanOrEqual(1);
    expect(ticks.length).toBeLessThanOrEqual(7);
  });
});

const call = (t: number, tool = "Bash", agentId = 0): TraceEvent => ({ t, agent: agentId, kind: "call", category: "shell", tool });
const result = (t: number, callIdx: number, over: Partial<TraceEvent> = {}): TraceEvent => ({ t, agent: 0, kind: "result", category: "shell", tool: "Bash", call: callIdx, ...over });

describe("buildAgentLanes", () => {
  it("splits a lane into think, tool, waiting-on-you and idle, contiguous over the lane", () => {
    const t = literal([
      { t: 5, agent: 0, kind: "turn", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, thinkMs: 2000 },
      call(6),
      result(10, 1, { permission: "rule" }),
      call(20),
      result(30, 3, { permission: "user" }),
    ]);
    const [lane] = buildAgentLanes(t);
    expect(lane.segments.map((s) => [s.kind, s.start, s.end])).toEqual([
      ["idle", 0, 3],
      ["think", 3, 5],
      ["idle", 5, 6],
      ["tool", 6, 10],
      ["idle", 10, 20],
      ["waiting-on-you", 20, 30],
      ["idle", 30, 100],
    ]);
    expect(lane.pauses).toEqual([{ t: 20, duration: 10, tool: "Bash" }]);
  });

  it("treats a user-permission result as waiting and any other permission as a tool", () => {
    for (const [permission, kind] of [["user", "waiting-on-you"], ["rule", "tool"], ["auto", "tool"], ["other", "tool"], [undefined, "tool"]] as const) {
      const [lane] = buildAgentLanes(literal([call(10), result(20, 0, { permission })]));
      expect(lane.segments.find((s) => s.start === 10)!.kind).toBe(kind);
    }
  });

  it("marks the silence before a human prompt as waiting on you, but not a short one", () => {
    const t = literal([call(1), result(2, 0), { t: 50, agent: 0, kind: "prompt" }, call(51), result(52, 3), { t: 52 + HUMAN_GAP_MIN - 1, agent: 0, kind: "prompt" }]);
    const waits = buildAgentLanes(t)[0].segments.filter((s) => s.kind === "waiting-on-you");
    expect(waits).toEqual([{ kind: "waiting-on-you", start: 2, end: 50, on: "prompt", tool: undefined }]);
  });

  it("never lets the first prompt wait on you", () => {
    const [lane] = buildAgentLanes(literal([{ t: 40, agent: 0, kind: "prompt" }]));
    expect(lane.segments.every((s) => s.kind === "idle")).toBe(true);
  });

  it("ticks errors, infers a retry inside the window, and not outside it", () => {
    const t = literal([
      call(1), result(2, 0, { isError: true }),
      call(4), result(5, 2),
      call(30), result(31, 4, { isError: true }),
      call(31 + RETRY_WINDOW + 1),
      call(40, "Read"),
    ]);
    const [lane] = buildAgentLanes(t);
    expect(lane.errors).toEqual([{ t: 2, tool: "Bash" }, { t: 31, tool: "Bash" }]);
    expect(lane.retries).toEqual([{ t: 4, tool: "Bash", failedAt: 2, inferred: true }]);
  });

  it("does not call a different tool or a different agent a retry", () => {
    const t = literal(
      [call(1), result(2, 0, { isError: true }), call(3, "Read"), call(3.5, "Bash", 1)],
      [agent(0), agent(1)],
    );
    expect(buildAgentLanes(t).flatMap((l) => l.retries)).toEqual([]);
  });

  it("puts compactions on the orchestrator lane", () => {
    const t = literal([{ t: 40, agent: 0, kind: "compact", compact: { trigger: "auto", preTokens: 900, postTokens: 90, durationMs: 4000 } }]);
    const lanes = buildAgentLanes(t);
    expect(lanes[0].compactions).toEqual([{ t: 40, trigger: "auto", preTokens: 900, postTokens: 90, durationMs: 4000 }]);
  });

  it("gives a subagent a lane from its spawn to its return", () => {
    const t = literal([call(12, "Read", 1), result(14, 0, { agent: 1 })], [agent(0), agent(1, { spawnT: 10, returnT: 20 })]);
    const lane = buildAgentLanes(t)[1];
    expect([lane.start, lane.end]).toEqual([10, 20]);
    expect(lane.segments[0].start).toBe(10);
    expect(lane.segments[lane.segments.length - 1].end).toBe(20);
  });

  it("degrades on an empty trace, no subagents, and an old trace with no new fields", () => {
    expect(buildAgentLanes(literal([]))[0].segments).toEqual([{ kind: "idle", start: 0, end: 100 }]);
    expect(buildAgentLanes(literal([call(1), result(2, 0)]))[0]).toMatchObject({ errors: [], retries: [], pauses: [], compactions: [] });
    expect(buildAgentLanes(literal([], []))).toEqual([]);
  });

  it("says who is waiting on you at a moment: the orchestrator before your next prompt, an agent in a permission wait", () => {
    const t = literal(
      [call(1), result(2, 0), call(12, "Read", 1), result(18, 2, { agent: 1, permission: "user" }), { t: 50, agent: 0, kind: "prompt" }, call(51), result(52, 5)],
      [agent(0), agent(1, { spawnT: 10, returnT: 20 })],
    );
    expect(waitingOnYouAt(t, 0, 1.5)).toBe(false);
    // The helper is still out until 18: the session is not waiting on you while something runs.
    expect(waitingOnYouAt(t, 0, 15)).toBe(false);
    expect(waitingOnYouAt(t, 0, 18)).toBe(true);
    expect(waitingOnYouAt(t, 0, 49.9)).toBe(true);
    expect(waitingOnYouAt(t, 0, 50)).toBe(false);
    expect(waitingOnYouAt(t, 0, 60)).toBe(false);
    expect(waitingOnYouAt(t, 1, 11)).toBe(false);
    expect(waitingOnYouAt(t, 1, 15)).toBe(true);
    expect(waitingOnYouAt(t, 1, 19)).toBe(false);
    expect(waitingOnYouAt(t, 9, 15)).toBe(false);
  });

  it("builds the lanes once per trace", () => {
    const t = literal([call(1), result(2, 0)]);
    expect(lanesOf(t)).toBe(lanesOf(t));
    expect(lanesOf(t)).toEqual(buildAgentLanes(t));
  });

  it("covers every lane of a sample with contiguous segments", () => {
    const trace = generateTrace(1, "large");
    for (const lane of buildAgentLanes(trace)) {
      expect(lane.segments[0].start).toBe(lane.start);
      expect(lane.segments[lane.segments.length - 1].end).toBe(lane.end);
      for (let i = 1; i < lane.segments.length; i++) expect(lane.segments[i].start).toBe(lane.segments[i - 1].end);
    }
    const kinds = new Set(buildAgentLanes(trace)[0].segments.map((s) => s.kind));
    expect(kinds.has("tool")).toBe(true);
    expect(buildAgentLanes(trace)[0].compactions).toHaveLength(trace.events.filter((e) => e.kind === "compact").length);
  });
});
