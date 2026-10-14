import { beforeEach, describe, expect, it } from "vitest";
import { hasSeenTour, markTourSeen, resetTourVisit, shouldShowTour, tourKey, TOUR_PREFIX } from "./tour-state";

const memory = () => {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};
const throwing = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: (): void => {
    throw new Error("blocked");
  },
};

beforeEach(resetTourVisit);

describe("tour keys", () => {
  it("are prefixed swarm-tour- and per act", () => {
    expect(TOUR_PREFIX).toBe("swarm-tour-");
    expect(tourKey("inside")).toBe("swarm-tour-inside");
    expect(tourKey("box")).toBe("swarm-tour-box");
  });
});

describe("seen flag", () => {
  it("starts unseen, is set by markTourSeen, and is per act", () => {
    const s = memory();
    expect(hasSeenTour("inside", s)).toBe(false);
    markTourSeen("inside", s);
    expect(s.data.get("swarm-tour-inside")).toBe("1");
    expect(hasSeenTour("inside", s)).toBe(true);
    expect(hasSeenTour("box", s)).toBe(false);
  });

  it("ignores any value but 1", () => {
    const s = memory();
    s.data.set("swarm-tour-box", "yes");
    expect(hasSeenTour("box", s)).toBe(false);
  });

  it("survives storage that throws on read and write", () => {
    expect(hasSeenTour("inside", throwing)).toBe(false);
    expect(() => markTourSeen("inside", throwing)).not.toThrow();
  });

  it("holds a skip for the rest of the visit when the write failed", () => {
    markTourSeen("box", throwing);
    expect(hasSeenTour("box", throwing)).toBe(true);
  });

  it("survives no storage at all", () => {
    expect(hasSeenTour("inside", null)).toBe(false);
    expect(() => markTourSeen("inside", null)).not.toThrow();
  });
});

describe("shouldShowTour", () => {
  const base = { search: "", automated: false };

  it("shows on a first plain visit", () => {
    expect(shouldShowTour("inside", { ...base, storage: memory() })).toBe(true);
  });

  it("does not show once seen", () => {
    const s = memory();
    markTourSeen("inside", s);
    expect(shouldShowTour("inside", { ...base, storage: s })).toBe(false);
    expect(shouldShowTour("inside", { ...base, search: "?tour=1", storage: s })).toBe(false);
  });

  it("stays out of scripted frames and automated browsers", () => {
    expect(shouldShowTour("box", { ...base, search: "?shot=escape", storage: memory() })).toBe(false);
    expect(shouldShowTour("box", { ...base, automated: true, storage: memory() })).toBe(false);
  });

  it("?tour=1 forces it over both, ?tour=0 turns it off", () => {
    expect(shouldShowTour("box", { search: "tour=1&shot=escape", automated: true, storage: memory() })).toBe(true);
    expect(shouldShowTour("box", { ...base, search: "?tour=0", storage: memory() })).toBe(false);
  });

  it("shows when storage throws", () => {
    expect(shouldShowTour("inside", { ...base, storage: throwing })).toBe(true);
  });
});
