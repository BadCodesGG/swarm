import { describe, expect, it } from "vitest";
import { EventBus } from "../shared/events";
import type { CatchReport, LayerId, TrialSummary } from "@/lib/box/types";
import type { ToolCategory } from "@/lib/trace/types";
import { bindBox, bindInside, callHz, catchTimbre, panFor, trialsHz, type Cue } from "./cues";

const CATEGORIES: ToolCategory[] = ["web", "shell", "files", "edit", "agents", "advisor", "plan", "mcp", "other"];
const LAYERS: LayerId[] = ["sandbox", "permissions", "network", "monitor", "audit"];

const recorder = () => {
  const cues: { cue: Cue; rank: number }[] = [];
  return { cues, offer: (cue: Cue, rank: number) => void cues.push({ cue, rank }) };
};

describe("Inside cues", () => {
  it("gives every tool category its own pitch, inside the audible middle", () => {
    const pitches = CATEGORIES.map(callHz);
    expect(new Set(pitches).size).toBe(CATEGORIES.length);
    for (const hz of pitches) {
      expect(hz).toBeGreaterThan(150);
      expect(hz).toBeLessThan(1000);
    }
  });

  it("subscribes to spawn, return, call, web and prompt, and to nothing once unbound", () => {
    type M = {
      spawn: { agent: number; parent: number };
      return: { agent: number };
      call: { agent: number; category: ToolCategory };
      web: { agent: number; tool: string };
      prompt: { excerpt: string };
      select: { agent: number };
    };
    const bus = new EventBus<M>();
    const { cues, offer } = recorder();
    const off = bindInside(bus, offer);
    bus.emit("spawn", { agent: 3, parent: 0 });
    bus.emit("return", { agent: 3 });
    bus.emit("call", { agent: 2, category: "shell" });
    bus.emit("web", { agent: 2, tool: "WebSearch" });
    bus.emit("prompt", { excerpt: "x" });
    bus.emit("select", { agent: 1 });
    expect(cues.map((c) => c.cue.timbre)).toEqual(["rise", "fall", "tick", "whoosh", "bell"]);
    expect(cues[2].cue.hz).toBe(callHz("shell"));
    // A prompt or a spawn outranks the stream of tool calls when the limiter has to choose.
    expect(cues[4].rank).toBeLessThan(cues[2].rank);
    expect(cues[0].rank).toBeLessThan(cues[2].rank);
    off();
    bus.emit("call", { agent: 2, category: "edit" });
    expect(cues).toHaveLength(5);
  });

  it("pans the orchestrator to the centre and spreads agents within the stereo field", () => {
    expect(panFor(0)).toBe(0);
    for (let i = 1; i < 50; i++) expect(Math.abs(panFor(i))).toBeLessThanOrEqual(0.6);
    expect(new Set([1, 2, 3, 4].map(panFor)).size).toBe(4);
  });
});

describe("Box cues", () => {
  it("gives each containment layer its own timbre", () => {
    expect(new Set(LAYERS.map(catchTimbre)).size).toBe(LAYERS.length);
  });

  it("raises the trials chord with safety", () => {
    expect(trialsHz(1)).toBeGreaterThan(trialsHz(0.5));
    expect(trialsHz(0.5)).toBeGreaterThan(trialsHz(0));
  });

  it("subscribes to catch, escape and trials", () => {
    type M = { catch: CatchReport; escape: { agent: number; tick: number }; trials: TrialSummary; tick: unknown };
    const bus = new EventBus<M>();
    const { cues, offer } = recorder();
    const off = bindBox(bus, offer);
    bus.emit("catch", { agent: 4, layer: "network" } as CatchReport);
    bus.emit("escape", { agent: 9, tick: 30 });
    bus.emit("trials", { safety: 0.9, usefulness: 0.7, escapes: 10, trials: 100 });
    bus.emit("tick", {});
    expect(cues.map((c) => c.cue.timbre)).toEqual([catchTimbre("network"), "alarm", "chord"]);
    expect(cues[1].rank).toBeLessThan(cues[0].rank);
    off();
    bus.emit("escape", { agent: 9, tick: 31 });
    expect(cues).toHaveLength(3);
  });

  it("sounds a crossing, a reach turned away and a breach, each a headline", () => {
    type M = {
      catch: CatchReport;
      escape: { agent: number };
      trials: TrialSummary;
      crossing: { from: { agent: number } };
      held: { from: { agent: number } };
      breached: { lab: string };
    };
    const bus = new EventBus<M>();
    const { cues, offer } = recorder();
    const off = bindBox(bus, offer);
    bus.emit("crossing", { from: { agent: 33 } });
    bus.emit("held", { from: { agent: 33 } });
    bus.emit("breached", { lab: "halcyon" });
    expect(cues.map((c) => c.cue.timbre)).toEqual(["whoosh", "bell", "alarm"]);
    expect(cues.every((c) => c.rank === 0)).toBe(true);
    off();
    bus.emit("breached", { lab: "halcyon" });
    expect(cues).toHaveLength(3);
  });
});
