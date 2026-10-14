import { describe, expect, it } from "vitest";
import { presetScenario } from "@/lib/box/presets";
import type { LabSpec, Scenario } from "@/lib/box/world-types";
import { setupDiff } from "./setup-diff";

const breakout = () => presetScenario("breakout");
const editLab = (s: Scenario, id: LabSpec["id"], edit: (l: LabSpec) => LabSpec): Scenario => ({ ...s, labs: s.labs.map((l) => (l.id === id ? edit(l) : l)) });

describe("setupDiff", () => {
  it("finds nothing different in Breakout itself", () => {
    expect(setupDiff(breakout())).toEqual([]);
  });

  it("names a layer switched on or off in a lab", () => {
    const s = editLab(breakout(), "kestrel", (l) => ({ ...l, config: { ...l.config, layers: { ...l.config.layers, network: true, sandbox: false } } }));
    expect(setupDiff(s)).toEqual([{ lab: "kestrel", name: "KESTREL", status: "changed", changes: ["Sandbox off", "Network allowlist on"] }]);
  });

  it("names a moved monitor threshold and audit budget with what they were", () => {
    const s = editLab(breakout(), "kestrel", (l) => ({ ...l, config: { ...l.config, monitorThreshold: 0.7, auditBudget: 0.05 } }));
    expect(setupDiff(s)[0].changes).toEqual(["Monitor flags above 0.70, was 0.90", "Human audit reviews 5% of actions, was 0.5%"]);
  });

  it("lists a lab Breakout does not have, and one it has that is gone", () => {
    const base = breakout();
    const s: Scenario = { ...base, labs: [...base.labs.filter((l) => l.id !== "halcyon"), { ...base.labs[0], id: "orrery" }] };
    expect(setupDiff(s)).toEqual([
      { lab: "orrery", name: "ORRERY", status: "added", changes: ["Not in Breakout"] },
      { lab: "halcyon", name: "HALCYON", status: "removed", changes: ["Removed"] },
    ]);
  });
});
