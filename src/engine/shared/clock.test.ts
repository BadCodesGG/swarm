import { describe, expect, it } from "vitest";
import { FIXED_STEP, MAX_DELTA, createClock, isScripted } from "./clock";

describe("createClock", () => {
  it("measures delta from the injected time source, 0 on the first tick", () => {
    let t = 1000;
    const clock = createClock({ now: () => t });
    expect(clock.tick()).toBe(0);
    t += 16;
    expect(clock.tick()).toBeCloseTo(0.016);
    t += 500;
    expect(clock.tick()).toBe(MAX_DELTA);
  });

  it("never goes negative if the time source steps back", () => {
    let t = 1000;
    const clock = createClock({ now: () => t });
    clock.tick();
    t -= 10;
    expect(clock.tick()).toBe(0);
  });

  it("returns exactly 1/60 every tick when fixed, whatever the time source says", () => {
    let t = 0;
    const clock = createClock({ fixed: true, now: () => (t += 123) });
    expect(clock.tick()).toBe(FIXED_STEP);
    expect(clock.tick()).toBe(FIXED_STEP);
    expect(FIXED_STEP).toBeCloseTo(1 / 60);
  });
});

describe("isScripted", () => {
  it("is true only when the URL has ?shot=", () => {
    expect(isScripted("?shot=hero")).toBe(true);
    expect(isScripted("?shot=")).toBe(true);
    expect(isScripted("?webgl=1")).toBe(false);
    expect(isScripted("")).toBe(false);
  });
});
