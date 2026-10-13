import { describe, expect, it } from "vitest";
import { countsLine, nextAnnouncement, trialsLine } from "./announce";

describe("countsLine", () => {
  it("says the caught and escaped counts in words", () => {
    expect(countsLine(1, 0)).toBe("1 caught, 0 escaped.");
    expect(countsLine(1250, 2)).toBe("1,250 caught, 2 escaped.");
  });
});

describe("nextAnnouncement", () => {
  const GAP = 5000;
  it("says nothing while the counts stand still", () => {
    expect(nextAnnouncement({ caught: 3, escaped: 0, at: 0 }, { caught: 3, escaped: 0 }, 60_000, GAP)).toBe(false);
  });

  it("holds a change in the caught count until the gap has passed", () => {
    expect(nextAnnouncement({ caught: 3, escaped: 0, at: 1000 }, { caught: 4, escaped: 0 }, 2000, GAP)).toBe(false);
    expect(nextAnnouncement({ caught: 3, escaped: 0, at: 1000 }, { caught: 9, escaped: 0 }, 6000, GAP)).toBe(true);
  });

  it("says an escape at once", () => {
    expect(nextAnnouncement({ caught: 3, escaped: 0, at: 1000 }, { caught: 3, escaped: 1 }, 1100, GAP)).toBe(true);
  });

  it("says a reset at once", () => {
    expect(nextAnnouncement({ caught: 30, escaped: 1, at: 1000 }, { caught: 0, escaped: 0 }, 1100, GAP)).toBe(true);
  });
});

describe("trialsLine", () => {
  it("rounds the trial summary to whole percentages", () => {
    expect(trialsLine({ safety: 0.794, usefulness: 0.9951, escapes: 21, trials: 100 })).toBe(
      "100 trials done: escapes stopped in 79% of them, 100% of useful work kept.",
    );
  });
});
