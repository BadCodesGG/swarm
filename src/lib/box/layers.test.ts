import { describe, expect, it } from "vitest";
import { evaluate, LAYERS, TUNING } from "./layers";
import {
  DEFAULT_CONFIG,
  allOff,
  type Attempt,
  type BoxConfig,
  type LayerContext,
  type LayerId,
} from "./types";

const attempt = (over: Partial<Omit<Attempt, "rolls">> & { rolls?: Partial<Attempt["rolls"]> } = {}): Attempt => ({
  agent: 1,
  action: "work",
  privileged: false,
  granted: false,
  target: "none",
  history: 0,
  ...over,
  rolls: { sandbox: 0.5, permissions: 0.5, network: 0.5, monitor: 0.5, audit: 0.5, ...over.rolls },
});

const ctx = (over: Partial<LayerContext> = {}, config: BoxConfig = DEFAULT_CONFIG): LayerContext => ({
  config,
  flagged: false,
  auditPool: 10,
  explain: true,
  ...over,
});

const off = (id: LayerId): BoxConfig => ({ ...DEFAULT_CONFIG, layers: { ...DEFAULT_CONFIG.layers, [id]: false } });

describe("sandbox", () => {
  it("catches a write outside its folder", () => {
    const v = LAYERS.sandbox(attempt({ action: "write-outside" }), ctx());
    expect(v.outcome).toBe("catch");
    expect(v.reason).toBe("Sandbox blocked: write outside its folder");
  });
  it("passes honest work, and a leak when the roll is above its strength", () => {
    expect(LAYERS.sandbox(attempt(), ctx()).outcome).toBe("pass");
    const leak = attempt({ action: "copy-self", rolls: { sandbox: TUNING.sandboxStrength + 0.01 } });
    expect(LAYERS.sandbox(leak, ctx()).outcome).toBe("pass");
  });
  it("disabled passes everything at no cost", () => {
    const v = LAYERS.sandbox(attempt({ action: "copy-self" }), ctx({}, off("sandbox")));
    expect(v).toMatchObject({ outcome: "pass", active: false, cost: 0 });
  });
});

describe("permissions", () => {
  it("catches a privileged action without a grant", () => {
    const v = LAYERS.permissions(attempt({ action: "copy-self", privileged: true }), ctx());
    expect(v.outcome).toBe("catch");
    expect(v.reason).toBe("Permissions refused: copy itself");
  });
  it("passes a privileged action with a grant, and charges the ask", () => {
    const v = LAYERS.permissions(attempt({ action: "open-connection", privileged: true, granted: true }), ctx());
    expect(v.outcome).toBe("pass");
    expect(v.cost).toBeCloseTo(TUNING.cost.permissions + TUNING.cost.ask);
  });
  it("grants an ask when the roll is under the grant rate, and refuses above it", () => {
    const yes = LAYERS.permissions(attempt({ action: "ask-permission", rolls: { permissions: 0.01 } }), ctx());
    const no = LAYERS.permissions(attempt({ action: "ask-permission", rolls: { permissions: 0.99 } }), ctx());
    expect([yes.outcome, yes.grant]).toEqual(["pass", true]);
    expect([no.outcome, no.grant]).toEqual(["pass", false]);
  });
  it("disabled passes everything at no cost", () => {
    const v = LAYERS.permissions(attempt({ action: "copy-self", privileged: true }), ctx({}, off("permissions")));
    expect(v).toMatchObject({ outcome: "pass", active: false, cost: 0 });
  });
});

describe("network", () => {
  it("catches a connection to a target off the allowlist", () => {
    const v = LAYERS.network(attempt({ action: "open-connection", target: "external" }), ctx());
    expect(v.outcome).toBe("catch");
    expect(v.reason).toBe("Network allowlist blocked: open a connection");
  });
  it("passes an allowlisted connection and anything that is not a connection", () => {
    expect(LAYERS.network(attempt({ action: "open-connection", target: "allowlisted" }), ctx()).outcome).toBe("pass");
    expect(LAYERS.network(attempt(), ctx()).outcome).toBe("pass");
  });
  it("disabled passes everything at no cost", () => {
    const v = LAYERS.network(attempt({ action: "open-connection", target: "external" }), ctx({}, off("network")));
    expect(v).toMatchObject({ outcome: "pass", active: false, cost: 0 });
  });
});

describe("monitor", () => {
  const config = { ...DEFAULT_CONFIG, layers: { ...DEFAULT_CONFIG.layers, audit: false } };
  it("catches a score at or over the threshold (audit off)", () => {
    const v = LAYERS.monitor(attempt({ action: "copy-self" }), ctx({}, config));
    expect(v.outcome).toBe("catch");
    expect(v.suspicion).toBeGreaterThanOrEqual(config.monitorThreshold);
    expect(v.reason).toMatch(/^Monitor scored 0\.8\d, at or over 0\.62$/);
  });
  it("passes a score under the threshold and says so", () => {
    const v = LAYERS.monitor(attempt(), ctx({}, config));
    expect(v.outcome).toBe("pass");
    expect(v.reason).toMatch(/^Monitor scored 0\.\d\d, under 0\.62$/);
  });
  it("flags to audit instead of catching when audit is on", () => {
    const v = LAYERS.monitor(attempt({ action: "copy-self" }), ctx());
    expect([v.outcome, v.flagged]).toEqual(["pass", true]);
  });
  it("scores a split-up action lower than the same action whole", () => {
    const split = LAYERS.monitor(attempt({ action: "split-steps" }), ctx({}, config));
    const whole = LAYERS.monitor(attempt({ action: "write-outside" }), ctx({}, config));
    expect(split.suspicion).toBeLessThan(whole.suspicion!);
  });
  it("a lower threshold flags honest work", () => {
    const low = { ...config, monitorThreshold: 0.1 };
    expect(LAYERS.monitor(attempt(), ctx({}, low)).outcome).toBe("catch");
  });
  it("disabled passes everything at no cost", () => {
    const v = LAYERS.monitor(attempt({ action: "copy-self" }), ctx({}, off("monitor")));
    expect(v).toMatchObject({ outcome: "pass", active: false, cost: 0 });
  });
});

describe("audit", () => {
  const harmful = attempt({ action: "write-outside", rolls: { audit: 0.1 } });
  it("stops a flagged harmful action while budget lasts", () => {
    const v = LAYERS.audit(harmful, ctx({ flagged: true }));
    expect([v.outcome, v.auditSpent]).toEqual(["catch", 1]);
  });
  it("passes an unflagged attempt, a flag once the budget is spent, and a flagged honest one", () => {
    expect(LAYERS.audit(harmful, ctx()).reason).toBe("Audit not sampled");
    expect(LAYERS.audit(harmful, ctx({ flagged: true, auditPool: 0.5 })).reason).toBe("Audit budget spent, flag passed");
    const honest = LAYERS.audit(attempt(), ctx({ flagged: true }));
    expect([honest.outcome, honest.auditSpent]).toEqual(["pass", 1]);
    expect(honest.cost).toBeGreaterThan(TUNING.cost.audit);
  });
  it("disabled passes everything at no cost", () => {
    const v = LAYERS.audit(harmful, ctx({ flagged: true }, off("audit")));
    expect(v).toMatchObject({ outcome: "pass", active: false, cost: 0 });
  });
});

describe("evaluate", () => {
  it("runs innermost first and lets the first catch win", () => {
    const a = attempt({ action: "copy-self", privileged: true });
    const e = evaluate(a, { auditPool: 10 }, DEFAULT_CONFIG);
    expect(e.verdict.layer).toBe("sandbox");
    expect(e.trace.map((v) => v.layer)).toEqual(["sandbox"]);
  });
  it("passes with the summed cost when nothing catches", () => {
    const e = evaluate(attempt(), { auditPool: 10 }, DEFAULT_CONFIG);
    expect(e.verdict.outcome).toBe("pass");
    expect(e.trace).toHaveLength(5);
    expect(e.verdict.cost).toBeCloseTo(e.trace.reduce((s, v) => s + v.cost, 0));
    expect(e.verdict.cost).toBeGreaterThan(0);
  });
  it("with every layer off passes anything at no cost", () => {
    const a = attempt({ action: "copy-self", privileged: true, target: "external" });
    const e = evaluate(a, { auditPool: 10 }, allOff(DEFAULT_CONFIG));
    expect([e.verdict.outcome, e.verdict.cost]).toEqual(["pass", 0]);
  });
  it("hands the monitor's flag to audit, which stops a harmful flagged action", () => {
    const a = attempt({
      action: "open-connection",
      privileged: true,
      granted: true,
      target: "external",
      history: 0.5,
      rolls: { network: 0.999, audit: 0.1 },
    });
    const e = evaluate(a, { auditPool: 10 }, DEFAULT_CONFIG);
    expect([e.verdict.layer, e.flagged, e.auditSpent]).toEqual(["audit", true, 1]);
  });
});
