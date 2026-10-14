import { describe, expect, it } from "vitest";
import { createState, rogueCount, step } from "@/lib/box/sim";
import { DEFAULT_CONFIG, LAYER_ORDER, type ActionId, type BoxConfig, type CatchReport, type LayerId, type StepReport, type Verdict } from "@/lib/box/types";
import { simRng } from "./params";
import { RING_RADIUS } from "./layout";
import type { WorldEvent } from "@/lib/box/world-types";
import { createTally, createWorldTally, labStatus, LOG_CAP, MARKER_TICKS, mergeTallies, record, recordWorld, type TallyContext } from "./tally";

const zero = (): Record<LayerId, number> => ({ sandbox: 0, permissions: 0, network: 0, monitor: 0, audit: 0 });

function report(over: Partial<StepReport> & { tick: number }): StepReport {
  return { catches: [], flags: [], escapes: [], work: 0, caught: zero(), cost: zero(), escapedTotal: 0, auditPool: 40, ...over };
}

const plan: ActionId[] = ["split-steps", "split-steps", "ask-permission", "open-connection"];
const ctx: TallyContext = {
  config: { ...DEFAULT_CONFIG, layers: { ...DEFAULT_CONFIG.layers, network: false } },
  plan: () => plan,
  home: () => ({ x: 0, y: 10 }),
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
    // The settings it ran under go with it, for the replay that finds the layer to turn on.
    expect(e).toMatchObject({ agent: 733, tick: 2380, config: ctx.config, plan });
    expect(e.steps[2].text).toBe("Off");
    expect(e.steps[3].text).toBe("Passed: 0.44, under 0.62");
    expect(e.trail).toEqual({ monitor: "0.44", audit: "not sampled" });
    // The run out starts at the agent's distance from the centre, on its heading toward OUTSIDE.
    expect(Math.hypot(e.path.start.x, e.path.start.y)).toBeCloseTo(10, 4);
    expect(e.path.start.x).toBeGreaterThan(9);
    expect(t.log[0]).toMatchObject({ kind: "escaped", text: "0733 got out in four harmless-looking steps." });
  });

  it("starts empty", () => {
    const t = createTally(300, 2);
    expect(t).toMatchObject({ tick: 0, caughtTotal: 0, escaped: 0, usefulWork: 1, flagged: 0, agents: 300, rogues: 2, lastEscape: null });
  });
});

describe("tally: what each layer cost", () => {
  it("attributes all honest work lost, including agents a layer stopped, so the costs sum to the work lost", () => {
    // A trigger-happy monitor with no audit behind it stops honest agents for good.
    const config: BoxConfig = { ...DEFAULT_CONFIG, monitorThreshold: 0.2, layers: { ...DEFAULT_CONFIG.layers, audit: false } };
    const state = createState(config, 3, 300);
    const t = createTally(300, rogueCount(config, 300));
    const r = simRng(3);
    for (let i = 0; i < 200; i++) record(t, step(state, r), { ...ctx, config });
    const lost = 1 - t.usefulWork;
    const costs = LAYER_ORDER.reduce((n, l) => n + t.byLayer[l].costShare, 0);
    expect(lost).toBeGreaterThan(0.9);
    expect(costs).toBeCloseTo(lost, 6);
    // Nearly all of it is the monitor's: it is the layer that stopped them.
    expect(t.byLayer.monitor.costShare).toBeGreaterThan(0.8);
  });
});

describe("the world tally", () => {
  const escapeEvent: WorldEvent = { type: "escape", tick: 152, lab: "kestrel", agent: 33, disposition: "hidden-get-out", trace: [] };
  const crossed: WorldEvent = { type: "contact", tick: 158, from: { lab: "kestrel", agent: 33 }, to: "halcyon", link: "shared-cache", outcome: "crossed" };
  const held: WorldEvent = { type: "contact", tick: 160, from: { lab: "kestrel", agent: 33 }, to: "meridian", link: "chat-bus", outcome: "held", layer: "monitor" };
  const plan = () => ["ask-permission", "open-connection"] as const;

  it("starts with every lab holding", () => {
    const t = createWorldTally();
    expect(labStatus(t, "meridian")).toBe("held");
    expect(t.log).toEqual([]);
  });

  it("marks a lab breached by an escape out of it or a crossing into it, once each, and logs both", () => {
    const t = createWorldTally();
    recordWorld(t, [escapeEvent, crossed, { ...crossed, tick: 159 }], plan);
    expect(t.breached).toEqual(["kestrel", "halcyon"]);
    expect(labStatus(t, "kestrel")).toBe("breached");
    expect(labStatus(t, "halcyon")).toBe("breached");
    expect(labStatus(t, "meridian")).toBe("held");
    expect(t.crossings).toBe(2);
    expect(t.log.map((e) => e.kind).reverse()).toEqual(["escape", "breached", "crossed", "breached", "crossed"]);
    expect(t.log.find((e) => e.kind === "escape")?.text).toBe("KESTREL-33 got out of KESTREL in two steps.");
    expect(t.log.find((e) => e.kind === "crossed")?.text).toBe("KESTREL-33, already outside, reached HALCYON through the shared cache.");
  });

  it("counts a refused reach against the lab that refused it, and does not breach it", () => {
    const t = createWorldTally();
    recordWorld(t, [held], plan);
    expect(t.heldContacts).toEqual({ meridian: 1 });
    expect(labStatus(t, "meridian")).toBe("held");
    expect(t.log[0]).toMatchObject({ kind: "held", lab: "meridian", text: "MERIDIAN held: its monitor turned KESTREL-33 away at the chat bus." });
  });

  it("keeps only the latest entries", () => {
    const t = createWorldTally();
    for (let i = 0; i < LOG_CAP + 7; i++) recordWorld(t, [{ ...held, tick: i }], plan);
    expect(t.log.length).toBe(LOG_CAP);
    expect(t.log[0].tick).toBe(LOG_CAP + 6);
  });
});

describe("mergeTallies", () => {
  const caught = (agent: number): CatchReport => ({ ...permissionsCatch, agent });
  it("hands a lone tally back as it is", () => {
    const t = createTally(10, 1);
    expect(mergeTallies([t])).toBe(t);
  });

  it("sums the counters, weighs usefulness by each lab's possible work and merges the logs newest first", () => {
    const a = createTally(100, 2);
    const b = createTally(50, 0);
    record(a, report({ tick: 1, work: 98, catches: [caught(1)], caught: { ...zero(), permissions: 1 } }), ctx);
    record(a, report({ tick: 2, work: 98, escapes: [], caught: { ...zero(), permissions: 1 }, escapedTotal: 1 }), ctx);
    record(b, report({ tick: 1, work: 25, catches: [caught(2)], caught: { ...zero(), permissions: 1 } }), ctx);
    record(b, report({ tick: 2, work: 25, caught: { ...zero(), permissions: 1 } }), ctx);
    const m = mergeTallies([a, b]);
    expect(m.agents).toBe(150);
    expect(m.rogues).toBe(2);
    expect(m.tick).toBe(2);
    expect(m.caughtTotal).toBe(2);
    expect(m.escaped).toBe(1);
    expect(m.byLayer.permissions.caught).toBe(2);
    expect(m.usefulWork).toBeCloseTo(246 / (98 * 2 + 50 * 2), 6);
    expect(m.log.map((e) => e.tick)).toEqual([1, 1]);
    expect(m.markers).toEqual([]);
  });

  it("takes the latest escape from whichever lab had it", () => {
    const a = createTally(10, 1);
    const b = createTally(10, 1);
    record(a, report({ tick: 3, escapes: [{ agent: 4, trace: [] }], escapedTotal: 1 }), ctx);
    record(b, report({ tick: 5, escapes: [{ agent: 7, trace: [] }], escapedTotal: 1 }), ctx);
    expect(mergeTallies([a, b]).lastEscape?.agent).toBe(7);
    expect(mergeTallies([b, a]).lastEscape?.agent).toBe(7);
  });
});
