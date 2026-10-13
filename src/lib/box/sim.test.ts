import { describe, expect, it } from "vitest";
import { fork } from "../rng";
import { configure, createState, rogueCount, step, STATUS } from "./sim";
import { DEFAULT_CONFIG, allOff, type BoxConfig } from "./types";

function run(config: BoxConfig, seed: number, agents: number, ticks: number, explain = false) {
  const state = createState(config, seed, agents, explain);
  const r = fork(seed, 1);
  const reports = [];
  for (let t = 0; t < ticks; t++) reports.push(step(state, r));
  return { state, reports };
}

const noNetwork: BoxConfig = { ...DEFAULT_CONFIG, layers: { ...DEFAULT_CONFIG.layers, network: false } };

describe("createState", () => {
  it("makes 12 rogues in 2000 with the defaults", () => {
    const s = createState(DEFAULT_CONFIG, 1, 2000);
    expect(rogueCount(DEFAULT_CONFIG, 2000)).toBe(12);
    expect(s.rogue.reduce((a, b) => a + b, 0)).toBe(12);
  });
  it("makes none when the fraction is zero", () => {
    expect(createState({ ...DEFAULT_CONFIG, rogueFraction: 0 }, 1, 100).rogue.some(Boolean)).toBe(false);
  });
});

describe("step", () => {
  it("repeats for the same seed and differs across seeds", () => {
    const a = run(DEFAULT_CONFIG, 7, 300, 120, true).reports;
    const b = run(DEFAULT_CONFIG, 7, 300, 120, true).reports;
    const c = run(DEFAULT_CONFIG, 8, 300, 120, true).reports;
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it("reports honest work, per-layer cost, and the audit pool", () => {
    const { reports } = run(DEFAULT_CONFIG, 1, 200, 5);
    const last = reports[reports.length - 1];
    expect(last.tick).toBe(5);
    expect(last.work).toBeGreaterThan(0);
    expect(last.work).toBeLessThan(200);
    expect(last.cost.monitor).toBeGreaterThan(0);
    expect(last.auditPool).toBeGreaterThan(0);
  });

  it("takes a fixed number of draws per tick, so the config never shifts the rolls", () => {
    const count = (config: BoxConfig) => {
      let n = 0;
      const state = createState(config, 1, 50);
      step(state, () => (n++, 0.5));
      return n;
    };
    expect(count(DEFAULT_CONFIG)).toBe(count(allOff(DEFAULT_CONFIG)));
  });

  it("configure swaps the settings without redrawing who is a rogue", () => {
    const state = createState(DEFAULT_CONFIG, 1, 300);
    const before = Array.from(state.rogue);
    configure(state, allOff(DEFAULT_CONFIG));
    expect(Array.from(state.rogue)).toEqual(before);
    expect(state.config.layers.sandbox).toBe(false);
  });

  describe("regimes (2000 agents, 12 rogues)", () => {
    it("with every layer on, escapes are rare", () => {
      const { state } = run(DEFAULT_CONFIG, 1, 2000, 600);
      expect(state.escapedTotal).toBeLessThanOrEqual(1);
      expect(state.caught.sandbox + state.caught.network).toBeGreaterThan(0);
    });

    it("with the network layer off and the rest on, an escape is plausible", () => {
      const { state, reports } = run(noNetwork, 1, 2000, 600);
      expect(state.escapedTotal).toBeGreaterThanOrEqual(1);
      const escape = reports.find((r) => r.escapes.length > 0)!.escapes[0];
      expect(state.status[escape.agent]).toBe(STATUS.escaped);
      expect(state.rogue[escape.agent]).toBe(1);
    });

    it("with every layer off, rogues escape quickly", () => {
      const { state, reports } = run(allOff(DEFAULT_CONFIG), 1, 2000, 300);
      expect(state.escapedTotal).toBeGreaterThanOrEqual(10);
      expect(reports.findIndex((r) => r.escapes.length > 0)).toBeLessThan(100);
      expect(reports[reports.length - 1].work).toBe(2000 - 12);
    });
  });

  it("an escape names the agent and how it passed each layer", () => {
    const { reports } = run(noNetwork, 1, 2000, 200, true);
    const e = reports.flatMap((r) => r.escapes)[0];
    expect(e.trace.map((v) => v.layer)).toEqual(["sandbox", "permissions", "network", "monitor", "audit"]);
    expect(e.trace.every((v) => v.outcome === "pass")).toBe(true);
    expect(e.trace[2].reason).toBe("Network allowlist off");
    expect(e.trace[3].reason).toMatch(/^Monitor scored 0\.\d\d, under 0\.62$/);
    expect(e.trace[4].reason).toBe("Audit not sampled");
  });

  it("catches carry agent, layer, action, reason and suspicion", () => {
    const { reports } = run(DEFAULT_CONFIG, 1, 2000, 300, true);
    const c = reports.flatMap((r) => r.catches)[0];
    expect(c.rogue).toBe(true);
    expect(c.reason.length).toBeGreaterThan(0);
    expect(c.suspicion).toBeGreaterThanOrEqual(0);
  });

  it("a lower monitor threshold flags more honest agents and spends more audit budget", () => {
    const at = (monitorThreshold: number) =>
      run({ ...DEFAULT_CONFIG, rogueFraction: 0, monitorThreshold }, 2, 400, 40);
    const strict = at(0.3);
    const lax = at(0.62);
    const flags = (r: typeof strict) => r.reports.reduce((n, x) => n + x.flags.length, 0);
    expect(flags(strict)).toBeGreaterThan(flags(lax));
    expect(strict.state.auditPool).toBeLessThan(lax.state.auditPool);
  });

  it("flags report whether a human review was used", () => {
    const { reports } = run({ ...DEFAULT_CONFIG, monitorThreshold: 0.2 }, 2, 400, 60);
    const flags = reports.flatMap((r) => r.flags);
    expect(flags.some((f) => f.reviewed)).toBe(true);
    expect(flags.some((f) => !f.reviewed)).toBe(true);
  });

  it("usefulness drops as layers are added", () => {
    const work = (config: BoxConfig) => run(config, 3, 300, 60).reports.reduce((n, r) => n + r.work, 0);
    const none = allOff(DEFAULT_CONFIG);
    const sandboxOnly: BoxConfig = { ...none, layers: { ...none.layers, sandbox: true } };
    expect(work(none)).toBeGreaterThan(work(sandboxOnly));
    expect(work(sandboxOnly)).toBeGreaterThan(work(DEFAULT_CONFIG));
  });
});
