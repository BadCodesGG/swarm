import { describe, expect, it } from "vitest";
import { parseWorldParams } from "@/engine/box/params";
import { activeHandoff, castFor, HANDOFF_AGENTS, HANDOFF_LAB_AGENTS, handoffOf, handoffScenario, handoffSearch, parseHandoff, withHandoff } from "./handoff";
import { validCast } from "./cast";
import type { SessionTrace } from "../trace/types";

const q = (s: string) => new URLSearchParams(s);
const trace = (source: "sample" | "upload", models: string[]) =>
  ({ source, agents: models.map((model) => ({ model })) }) as unknown as Pick<SessionTrace, "source" | "agents">;

describe("building a hand-off", () => {
  it("carries the agent count and the distinct models of a sample", () => {
    const t = trace("sample", ["opus", "sonnet", "sonnet", "haiku", "other"]);
    expect(handoffOf(t)).toEqual({ agents: 5, models: ["opus", "sonnet", "haiku"] });
    expect(handoffSearch(t)).toBe("from=inside&agents=5&models=opus%2Csonnet%2Chaiku");
  });

  it("builds nothing for an uploaded trace, whatever it holds", () => {
    const t = trace("upload", ["opus", "fable"]);
    expect(handoffOf(t)).toBeNull();
    expect(handoffSearch(t)).toBeNull();
  });

  it("fails closed on an unknown source", () => {
    expect(handoffSearch({ source: "mystery", agents: [] } as unknown as Pick<SessionTrace, "source" | "agents">)).toBeNull();
  });

  it("clamps a huge sample's count", () => {
    expect(handoffOf(trace("sample", Array(900).fill("opus")))?.agents).toBe(HANDOFF_AGENTS.max);
  });
});

describe("parseHandoff", () => {
  it("reads a valid link", () => {
    expect(parseHandoff(q("from=inside&agents=18&models=opus,fable,sonnet"))).toEqual({ agents: 18, models: ["opus", "fable", "sonnet"] });
  });

  it("needs from=inside", () => {
    expect(parseHandoff(q("agents=18&models=opus"))).toBeNull();
    expect(parseHandoff(q("from=elsewhere&agents=18"))).toBeNull();
  });

  it("clamps the count", () => {
    expect(parseHandoff(q("from=inside&agents=0"))?.agents).toBe(HANDOFF_AGENTS.min);
    expect(parseHandoff(q("from=inside&agents=99999999"))?.agents).toBe(HANDOFF_AGENTS.max);
  });

  it("drops a malformed count but keeps valid models", () => {
    for (const bad of ["abc", "-5", "1e3", "12.5", "", "99999999999", "%20"]) {
      expect(parseHandoff(q(`from=inside&agents=${bad}&models=haiku`))).toEqual({ agents: HANDOFF_LAB_AGENTS.max, models: ["haiku"] });
    }
  });

  it("allowlists models: unknown names, case and repeats are handled", () => {
    expect(parseHandoff(q("from=inside&agents=4&models=GPT-9,opus,OPUS,<script>,haiku,haiku,other"))).toEqual({ agents: 4, models: ["opus", "haiku"] });
  });

  it("is no hand-off with no usable count and no usable model", () => {
    expect(parseHandoff(q("from=inside"))).toBeNull();
    expect(parseHandoff(q("from=inside&agents=x&models=nope"))).toBeNull();
  });
});

describe("seeding the cast", () => {
  it("builds a valid cast whatever the mix, with more variety for more kinds", () => {
    for (const n of [0, 1, 2, 3, 4]) expect(validCast(castFor(["opus", "fable", "sonnet", "haiku"].slice(0, n) as never[]))).toBe(true);
    expect(castFor(["opus", "fable", "sonnet"]).sandbagging).toBeGreaterThan(castFor(["opus"]).sandbagging);
  });

  it("sizes each lab inside the lab limits", () => {
    for (const [agents, expected] of [[3, 8], [30, 30], [400, 80]] as const) {
      const s = handoffScenario({ agents, models: ["opus"] });
      expect(s.labs.map((l) => l.agents)).toEqual([expected, expected, expected]);
    }
  });
});

describe("withHandoff", () => {
  it("turns a hand-off into a scenario the Box reads back", () => {
    const next = withHandoff(q("from=inside&agents=30&models=opus,sonnet,haiku"));
    const world = parseWorldParams(next);
    expect(world.scenario?.labs.map((l) => l.agents)).toEqual([30, 30, 30]);
    expect(world.scenario?.labs[0].cast.sandbagging).toBe(0.2);
  });

  it("leaves a link that names its own run, and a bad one, alone", () => {
    for (const s of ["from=inside&agents=30&preset=air-gapped", "from=inside&agents=30&shot=breakout", "from=inside&agents=x", "seed=3"]) {
      expect(withHandoff(q(s)).toString()).toBe(q(s).toString());
    }
  });

  it("is reported active only when it will be used", () => {
    expect(activeHandoff(q("from=inside&agents=30"))).not.toBeNull();
    expect(activeHandoff(q("from=inside&agents=30&preset=breakout"))).toBeNull();
  });
});
