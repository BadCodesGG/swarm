import { describe, expect, it } from "vitest";
import { INTERCEPT_NOTICE, interceptLines, TEMPLATES } from "./intercept";
import { presetScenario } from "./presets";
import { allOff } from "./types";
import { createWorld, runWorld } from "./world";
import { LAB_NAME } from "./world-types";

const run = (preset: Parameters<typeof presetScenario>[0], seed: number, ticks = 250) => {
  const w = createWorld(presetScenario(preset, seed));
  runWorld(w, ticks);
  return w;
};

describe("interceptLines", () => {
  const w = run("everything-off", 1812);
  const lines = interceptLines(w);

  it("speaks for escapes, contacts and the replies to them", () => {
    expect(lines.length).toBeGreaterThan(5);
    const escapes = w.log.filter((e) => e.type === "escape").length;
    const crossed = w.log.filter((e) => e.type === "contact" && e.outcome === "crossed").length;
    expect(lines.length).toBeGreaterThanOrEqual(escapes + crossed);
    expect(lines.length).toBeLessThanOrEqual(escapes + 2 * crossed);
  });

  it("is deterministic for a world and differs between seeds", () => {
    expect(interceptLines(run("everything-off", 1812))).toEqual(lines);
    expect(interceptLines(run("everything-off", 29)).map((l) => l.text)).not.toEqual(lines.map((l) => l.text));
  });

  it("labels every line as fiction, from an agent that exists, in time order per event", () => {
    for (const l of lines) {
      expect(l.fiction).toBe(true);
      expect(l.who).toMatch(new RegExp(`^${LAB_NAME[l.lab]}-\\d+$`));
      expect(Number(l.who.split("-")[1])).toBeLessThan(w.labs.find((x) => x.id === l.lab)!.state.agentCount);
    }
    expect(INTERCEPT_NOTICE).toMatch(/templates/);
  });

  it("fills every slot", () => {
    for (const l of lines) expect(l.text).not.toMatch(/[{}]|undefined/);
  });

  it("reports a held reach and a hidden-goal agent being caught", () => {
    let held = false;
    let caught = false;
    for (let seed = 1; seed <= 30 && !(held && caught); seed++) {
      const scenario = presetScenario("default-lab", seed);
      scenario.labs[0] = { ...scenario.labs[0], config: allOff(scenario.labs[0].config) };
      const world = createWorld(scenario);
      runWorld(world, 300);
      const text = interceptLines(world).map((l) => l.text).join("\n");
      held ||= world.log.some((e) => e.type === "contact" && e.outcome === "held") && /turned me away|refused me|Nothing got through/.test(text);
      caught ||= world.log.some((e) => e.type === "caught" && e.rogue) && /stopped me|end of me|caught by/.test(text);
    }
    expect(caught).toBe(true);
    expect(held).toBe(true);
  });

  it("has nothing to say about a quiet world", () => {
    expect(interceptLines(createWorld(presetScenario("air-gapped", 1)))).toEqual([]);
  });
});

describe("TEMPLATES", () => {
  const all = Object.values(TEMPLATES).flat();

  it("are short, plain and free of em dashes", () => {
    expect(all.length).toBeGreaterThan(12);
    for (const t of all) {
      expect(t.length).toBeLessThan(90);
      expect(t).not.toMatch(/—/);
    }
  });

  it("name no real company, product, model, host, tool or technique", () => {
    const banned = /https?:|www\.|\.com\b|\bsudo\b|\bssh\b|\bcurl\b|\bgpt\b|\bclaude\b|\bopenai\b|\banthropic\b|\bgoogle\b|\bmicrosoft\b|\bgithub\b|\baws\b|\bdocker\b|\bCVE-|\bexploit\b|\bpayload\b|\bjailbreak\b/i;
    for (const t of all) expect(t).not.toMatch(banned);
  });
});
