import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type ActionId, type CatchReport, type LayerId, type StepReport, type Verdict } from "@/lib/box/types";
import { RING_RADIUS } from "./layout";
import { createTally, LOG_CAP, MARKER_TICKS, record, type TallyContext } from "./tally";

const zero = (): Record<LayerId, number> => ({ sandbox: 0, permissions: 0, network: 0, monitor: 0, audit: 0 });

function report(over: Partial<StepReport> & { tick: number }): StepReport {
  return { catches: [], flags: [], escapes: [], work: 0, caught: zero(), cost: zero(), escapedTotal: 0, auditPool: 40, ...over };
}

const plan: ActionId[] = ["split-steps", "split-steps", "ask-permission", "open-connection"];
const ctx: TallyContext = {
  config: { ...DEFAULT_CONFIG, layers: { ...DEFAULT_CONFIG.layers, network: false } },
  plan: () => plan,
  home: () => ({ x: 10, y: 0 }),
};

const permissionsCatch: CatchReport = { agent: 1187, layer: "permissions", action: "copy-self", reason: "", suspicion: 0, rogue: true };

describe("tally", () => {
  it("counts ticks, catches and the share of honest work kept", () => {
    // 100 agents, 2 rogues: 98 honest agent-ticks per tick is the baseline.
    const t = createTally(100, 2);
    record(t, report({ tick: 1, work: 98 }), ctx);
    record(t, report({ tick: 2, work: 49, catches: [permissionsCatch], caught: { ...zero(), permissions: 1 }, cost: { ...zero(), monitor: 9.8 } }), ctx);
    expect(t.tick).toBe(2);
    expect(t.caughtTotal).toBe(1);
    expect(t.usefulWork).toBeCloseTo(147 / 196, 6);
    expect(t.byLayer.permissions.caught).toBe(1);
    expect(t.byLayer.monitor.costShare).toBeCloseTo(9.8 / 196, 6);
  });

  it("logs newest first and keeps only the latest entries", () => {
    const t = createTally(100, 2);
    for (let i = 1; i <= LOG_CAP + 5; i++) record(t, report({ tick: i, catches: [{ ...permissionsCatch, agent: i }] }), ctx);
    expect(t.log.length).toBe(LOG_CAP);
    expect(t.log[0]).toMatchObject({ tick: LOG_CAP + 5, kind: "caught", text: `Permissions refused ${String(LOG_CAP + 5).padStart(4, "0")}: copy itself.` });
  });

  it("leaves a marker on the catching ring that fades after a while", () => {
    const t = createTally(100, 2);
    record(t, report({ tick: 1, catches: [permissionsCatch] }), ctx);
    expect(t.markers).toHaveLength(1);
    const m = t.markers[0];
    expect(m).toMatchObject({ kind: "catch", layer: "permissions", label: "refused: copy itself" });
    expect(Math.hypot(m.x, m.y)).toBeCloseTo(RING_RADIUS.permissions, 4);
    record(t, report({ tick: 1 + MARKER_TICKS }), ctx);
    expect(t.markers).toHaveLength(0);
  });

  it("marks reviewed flags on the monitor ring and counts every flag", () => {
    const t = createTally(100, 2);
    record(t, report({ tick: 1, flags: [{ agent: 412, action: "copy-self", suspicion: 0.81, reviewed: true }, { agent: 5, action: "work", suspicion: 0.7, reviewed: false }] }), ctx);
    expect(t.flagged).toBe(2);
    expect(t.markers.map((m) => [m.kind, m.layer, m.label])).toEqual([
      ["flag", "monitor", "flagged 0.81, sent to audit"],
      ["flag", "monitor", "flagged 0.70, not reviewed"],
    ]);
  });

  it("records the latest escape with its steps, trail notes and path", () => {
    const t = createTally(100, 2);
    const trace: Verdict[] = [
      { outcome: "pass", layer: "sandbox", active: true, reason: "", cost: 0 },
      { outcome: "pass", layer: "permissions", active: true, reason: "", cost: 0 },
      { outcome: "pass", layer: "network", active: false, reason: "", cost: 0 },
      { outcome: "pass", layer: "monitor", active: true, reason: "", cost: 0, suspicion: 0.44 },
      { outcome: "pass", layer: "audit", active: true, reason: "", cost: 0 },
    ];
    record(t, report({ tick: 2380, escapes: [{ agent: 733, trace }], escapedTotal: 1 }), ctx);
    expect(t.escaped).toBe(1);
    const e = t.lastEscape!;
    expect(e).toMatchObject({ agent: 733, tick: 2380, offLayer: "network", plan });
    expect(e.steps[3].text).toBe("Passed: 0.44, under 0.62");
    expect(e.trail).toEqual({ monitor: "0.44", audit: "not sampled" });
    expect(e.path.start).toEqual({ x: 10, y: 0 });
    expect(t.log[0]).toMatchObject({ kind: "escaped", text: "0733 got out in four harmless-looking steps." });
  });

  it("starts empty", () => {
    const t = createTally(300, 2);
    expect(t).toMatchObject({ tick: 0, caughtTotal: 0, escaped: 0, usefulWork: 1, flagged: 0, agents: 300, rogues: 2, lastEscape: null });
  });
});
