import { describe, expect, it } from "vitest";
import { nextRate, RATES, shownRate } from "./rates";

describe("the phone speed button", () => {
  it("offers 1x, 20x and 200x", () => {
    expect(RATES).toEqual([1, 20, 200]);
  });

  it("shows a selected rate as it is", () => {
    expect(shownRate(1)).toBe(1);
    expect(shownRate(20)).toBe(20);
    expect(shownRate(200)).toBe(200);
  });

  it("shows 20x, as the phone board does, for any rate outside the three", () => {
    expect(shownRate(4)).toBe(20);
    expect(shownRate(0.5)).toBe(20);
    expect(shownRate(500)).toBe(20);
  });

  it("cycles 1x, 20x, 200x and back, from what it shows", () => {
    expect(nextRate(1)).toBe(20);
    expect(nextRate(20)).toBe(200);
    expect(nextRate(200)).toBe(1);
    expect(nextRate(4)).toBe(200);
  });
});
