import { describe, expect, it } from "vitest";
import { presetScenario } from "./presets";
import { scenarioFromParams, scenarioToParams, SHARE_VERSION } from "./share";
import { PRESET_IDS } from "./world-types";

const params = (s: string) => new URLSearchParams(s);
const good = scenarioToParams(presetScenario("default-lab", 1812));

describe("share", () => {
  it("round-trips every preset at several sizes", () => {
    for (const preset of PRESET_IDS) {
      for (const n of [1, 3, 5]) {
        const s = presetScenario(preset, 29, n);
        expect(scenarioFromParams(scenarioToParams(s))).toEqual(s);
      }
    }
  });

  it("survives a trip through a URL string", () => {
    const s = presetScenario("rushed-launch", 4_000_000_000, 2);
    expect(scenarioFromParams(params(scenarioToParams(s).toString()))).toEqual(s);
  });

  it("is compact and versioned", () => {
    expect(good.get("v")).toBe(String(SHARE_VERSION));
    expect(good.toString().length).toBeLessThan(260);
  });

  it("returns null for garbage", () => {
    expect(scenarioFromParams(params(""))).toBeNull();
    expect(scenarioFromParams(params("v=1"))).toBeNull();
    expect(scenarioFromParams(params("hello=world"))).toBeNull();
    expect(scenarioFromParams(params("v=1&s=abc&b=meridian.80.31.62.20.30.10.3-1-1"))).toBeNull();
  });

  const with_ = (edit: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(good);
    edit(p);
    return scenarioFromParams(p);
  };
  const firstLab = good.getAll("b")[0].split(".");
  const labWith = (i: number, v: string) => firstLab.map((x, j) => (j === i ? v : x)).join(".");

  it("returns null for another version, a missing seed or no labs", () => {
    expect(with_((p) => p.set("v", "2"))).toBeNull();
    expect(with_((p) => p.delete("s"))).toBeNull();
    expect(with_((p) => p.set("s", "99999999999"))).toBeNull();
    expect(with_((p) => p.delete("b"))).toBeNull();
  });

  it("returns null for a lab out of range, unknown or repeated", () => {
    expect(with_((p) => p.set("b", labWith(0, "nowhere")))).toBeNull();
    expect(with_((p) => p.set("b", labWith(1, "0")))).toBeNull();
    expect(with_((p) => p.set("b", labWith(1, "5000")))).toBeNull();
    expect(with_((p) => p.set("b", labWith(2, "32")))).toBeNull();
    expect(with_((p) => p.set("b", labWith(3, "101")))).toBeNull();
    expect(with_((p) => p.set("b", labWith(7, "0-0-0")))).toBeNull();
    expect(with_((p) => p.set("b", labWith(7, "1-1")))).toBeNull();
    expect(with_((p) => p.set("b", `${firstLab.join(".")}.extra`))).toBeNull();
    expect(with_((p) => p.append("b", firstLab.join(".")))).toBeNull();
    expect(with_((p) => p.set("b", labWith(1, "-5")))).toBeNull();
  });

  it("returns null for a link that names a missing lab, one lab, or an unknown kind", () => {
    expect(with_((p) => p.append("k", "c.0-9"))).toBeNull();
    expect(with_((p) => p.append("k", "c.0"))).toBeNull();
    expect(with_((p) => p.append("k", "c.1-1"))).toBeNull();
    expect(with_((p) => p.append("k", "z.0-1"))).toBeNull();
  });

  it("returns null for too many labs or links", () => {
    expect(with_((p) => ["a", "b", "c"].forEach(() => p.append("b", firstLab.join("."))))).toBeNull();
    expect(with_((p) => Array.from({ length: 13 }).forEach(() => p.append("k", "c.0-1")))).toBeNull();
  });
});
