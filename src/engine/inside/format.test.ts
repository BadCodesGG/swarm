import { describe, expect, it } from "vitest";
import { clock, compact, idleCutLabel, runClock, shortClock } from "./format";

describe("format", () => {
  it("formats clocks", () => {
    expect(clock(0)).toBe("00:00:00");
    expect(clock(2472)).toBe("00:41:12");
    expect(clock(5070.9)).toBe("01:24:30");
    expect(shortClock(2472)).toBe("41:12");
    expect(shortClock(5070)).toBe("1:24:30");
    expect(runClock(252)).toBe("4:12");
  });

  it("survives bad input", () => {
    expect(clock(Number.NaN)).toBe("00:00:00");
    expect(clock(-5)).toBe("00:00:00");
    expect(compact(Number.NaN)).toBe("0");
  });

  it("compacts counts", () => {
    expect(compact(318)).toBe("318");
    expect(compact(96_400)).toBe("96.4k");
    expect(compact(412_000)).toBe("412k");
    expect(compact(2_410_000)).toBe("2.41M");
    expect(compact(999_900)).toBe("1.00M");
  });

  it("labels an idle cut", () => {
    expect(idleCutLabel(720)).toBe("12 idle min cut");
    expect(idleCutLabel(40)).toBe("40 idle s cut");
  });
});
