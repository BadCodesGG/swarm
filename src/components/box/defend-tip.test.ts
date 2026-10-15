import { describe, expect, it } from "vitest";
import { presetScenario } from "@/lib/box/presets";
import { createWorld, runWorld } from "@/lib/box/world";
import { cheapestStop, labsKept, latestEscape, layerRates } from "./defend-tip";

const run = (preset: "everything-off" | "breakout" | "default-lab", ticks = 400) => {
  const w = createWorld(presetScenario(preset, 1812), false);
  runWorld(w, ticks);
  return w;
};

describe("latestEscape", () => {
  it("is null while everything holds and names the last escape otherwise", () => {
    expect(latestEscape(run("default-lab", 50))).toBeNull();
    const w = run("everything-off", 600);
    const escapes = w.log.filter((e) => e.type === "escape");
    expect(escapes.length).toBeGreaterThan(0);
    const last = escapes[escapes.length - 1];
    expect(latestEscape(w)?.target).toEqual({ type: "escape", lab: last.lab, agent: last.agent });
  });
});

describe("cheapestStop", () => {
  const rates = { sandbox: 0.03, permissions: 0.1, network: null, monitor: 0.04, audit: 0.02 };
  it("picks the cheapest of the layers that would have stopped it", () => {
    expect(cheapestStop(["permissions", "monitor"], rates)).toBe("monitor");
    expect(cheapestStop(["permissions", "audit", "sandbox"], rates)).toBe("audit");
  });
  it("ranks a layer of unknown cost last, and the innermost first on a tie", () => {
    expect(cheapestStop(["network", "permissions"], rates)).toBe("permissions");
    expect(cheapestStop(["network"], rates)).toBe("network");
    expect(cheapestStop(["sandbox", "network"], { ...rates, sandbox: null })).toBe("sandbox");
  });
  it("is null with nothing to turn on", () => {
    expect(cheapestStop([], rates)).toBeNull();
  });
});

describe("layerRates and labsKept", () => {
  it("rates only the layers some lab runs", () => {
    const off = layerRates(run("everything-off"));
    expect(Object.values(off).every((r) => r === null)).toBe(true);
    const on = layerRates(run("default-lab"));
    expect(Object.values(on).every((r) => r !== null && r > 0)).toBe(true);
  });
  it("counts labs with no escape", () => {
    const k = labsKept(run("everything-off", 600));
    expect(k.total).toBe(k.kept + Object.values(k.held).filter((h) => !h).length);
    expect(k.kept).toBeLessThan(k.total);
    expect(labsKept(run("default-lab", 10))).toMatchObject({ kept: 3, total: 3 });
  });
});
