import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "./shortcuts";

describe("SHORTCUTS", () => {
  it("lists each act with the ? key and no empty rows", () => {
    for (const act of ["inside", "box"] as const) {
      const rows = SHORTCUTS[act];
      expect(rows.some((r) => r.keys.includes("?"))).toBe(true);
      for (const r of rows) {
        expect(r.keys.length).toBeGreaterThan(0);
        expect(r.does).not.toContain(String.fromCharCode(0x2014));
      }
    }
  });

  it("names the speeds Act 1 has", () => {
    const speeds = SHORTCUTS.inside.find((r) => r.keys[0] === "1");
    expect(speeds?.keys).toEqual(["1", "2", "3"]);
    expect(speeds?.does).toBe("Playback speed: 1x, 20x, 200x");
  });
});
