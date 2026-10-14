import { describe, expect, it } from "vitest";
import type { AgentLane } from "@/engine/inside/lanes";
import { describeHit, hitLane, laneHeight, planLanes } from "./lane-plan";

const lane = (agent: number, over: Partial<AgentLane> = {}): AgentLane => ({
  agent,
  start: 0,
  end: 100,
  segments: [
    { kind: "think", start: 0, end: 40 },
    { kind: "tool", start: 40, end: 60, tool: "Bash" },
    { kind: "waiting-on-you", start: 60, end: 90, tool: "Bash", on: "permission" },
    { kind: "idle", start: 90, end: 100 },
  ],
  errors: [{ t: 50, tool: "Bash" }],
  retries: [{ t: 55, tool: "Bash", failedAt: 50, inferred: true }],
  compactions: [],
  pauses: [{ t: 60, duration: 30, tool: "Bash" }],
  ...over,
});

const frac = (t: number) => t / 100;
const names = (id: number) => (id === 0 ? "Orchestrator" : `Sonnet ${id}`);

describe("planLanes", () => {
  it("makes a row per lane, drops idle, and maps time to 0..1", () => {
    const plan = planLanes([lane(0), lane(1)], frac);
    expect(plan.rows).toBe(2);
    expect(plan.boxes.filter((b) => b.row === 1).map((b) => [b.kind, b.x0, b.x1])).toEqual([
      ["think", 0, 0.4],
      ["tool", 0.4, 0.6],
      ["waiting-on-you", 0.6, 0.9],
    ]);
  });

  it("carries errors, retries, compactions and permission pauses as marks", () => {
    const plan = planLanes([lane(0, { compactions: [{ t: 70, trigger: "auto", preTokens: 900_000, postTokens: 40_000, durationMs: 1 }] })], frac);
    expect(plan.marks.map((m) => [m.kind, m.x]).sort()).toEqual([
      ["compaction", 0.7],
      ["error", 0.5],
      ["pause", 0.6],
      ["retry", 0.55],
    ]);
  });
});

describe("laneHeight", () => {
  it("grows with the agents and stays within a band", () => {
    expect(laneHeight(1)).toBe(14);
    expect(laneHeight(18)).toBe(36);
    expect(laneHeight(120)).toBe(48);
  });
});

describe("hitLane and describeHit", () => {
  const plan = planLanes([lane(0), lane(1)], frac);
  it("finds a mark near the pointer first, and says what it is", () => {
    const hit = hitLane(plan, 0.5, 0.75, 1000);
    expect(hit && describeHit(hit, names)).toBe("Sonnet 1: Bash failed at 00:00:50");
  });
  it("finds the segment under the pointer", () => {
    const hit = hitLane(plan, 0.2, 0.25, 1000);
    expect(hit && describeHit(hit, names)).toBe("Orchestrator: thinking, 40s");
  });
  it("names a permission pause with its length", () => {
    const hit = hitLane(plan, 0.6, 0.25, 1000);
    expect(hit && describeHit(hit, names)).toBe("Orchestrator: waited 30s for you to allow Bash");
  });
  it("finds nothing in idle space", () => {
    expect(hitLane(plan, 0.95, 0.25, 1000)).toBeNull();
  });
});
