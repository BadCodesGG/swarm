import { describe, expect, it } from "vitest";
import { forkFlips } from "./fork";
import type { Flip } from "./world-types";

const flip = (tick: number, lab: Flip["lab"], layer: Flip["layer"], on: boolean): Flip => ({ tick, lab, layer, on });

describe("forkFlips", () => {
  it("keeps the flips up to the fork and adds the change at its tick", () => {
    const flips = [flip(10, "kestrel", "monitor", false), flip(40, "halcyon", "sandbox", false)];
    expect(forkFlips(flips, 40, { lab: "kestrel", layer: "network", on: true })).toEqual([
      flip(10, "kestrel", "monitor", false),
      flip(40, "halcyon", "sandbox", false),
      flip(40, "kestrel", "network", true),
    ]);
  });

  it("drops every flip after the fork", () => {
    const flips = [flip(5, "meridian", "audit", false), flip(90, "kestrel", "network", true), flip(120, "halcyon", "monitor", true)];
    expect(forkFlips(flips, 60, { lab: "halcyon", layer: "monitor", on: true })).toEqual([flip(5, "meridian", "audit", false), flip(60, "halcyon", "monitor", true)]);
  });

  it("replaces a flip of the same layer in the same lab at the same tick", () => {
    const flips = [flip(30, "kestrel", "network", false), flip(30, "halcyon", "network", false)];
    expect(forkFlips(flips, 30, { lab: "kestrel", layer: "network", on: true })).toEqual([flip(30, "halcyon", "network", false), flip(30, "kestrel", "network", true)]);
  });

  it("sorts by tick whatever order the log came in", () => {
    const flips = [flip(20, "kestrel", "sandbox", false), flip(3, "meridian", "permissions", false)];
    expect(forkFlips(flips, 25, { lab: "meridian", layer: "monitor", on: true }).map((f) => f.tick)).toEqual([3, 20, 25]);
  });

  it("leaves the log it was given alone", () => {
    const flips = [flip(50, "kestrel", "network", false)];
    forkFlips(flips, 10, { lab: "kestrel", layer: "network", on: true });
    expect(flips).toEqual([flip(50, "kestrel", "network", false)]);
  });
});
