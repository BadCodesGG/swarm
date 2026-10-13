import { describe, expect, it } from "vitest";
import { createCrowdState, integrate, MAX_SPEED, snap, STRIDE } from "./integrate";

const ACTIVE = 0;
const ESCAPED = 2;

function one(x: number, y: number, tx: number, ty: number) {
  const state = createCrowdState(1);
  state[0] = x;
  state[1] = y;
  const targets = new Float32Array([tx, ty, 1, 0]);
  const status = new Uint8Array([ACTIVE]);
  return { state, targets, status };
}

describe("integrate", () => {
  it("steers an agent onto its target and holds it there", () => {
    const { state, targets, status } = one(0, 0, 10, -4);
    for (let i = 0; i < 180; i++) integrate(state, targets, status, 1, 1 / 60);
    expect(state[0]).toBeCloseTo(10, 2);
    expect(state[1]).toBeCloseTo(-4, 2);
    expect(Math.hypot(state[2], state[3])).toBeLessThan(0.01);
  });

  it("does not overshoot the target by more than a hair", () => {
    const { state, targets, status } = one(0, 0, 20, 0);
    let furthest = 0;
    for (let i = 0; i < 240; i++) {
      integrate(state, targets, status, 1, 1 / 60);
      furthest = Math.max(furthest, state[0]);
    }
    expect(furthest).toBeLessThan(20.1);
  });

  it("gives the same positions however a span of time is split into frames", () => {
    const a = one(0, 0, 30, 12);
    const b = one(0, 0, 30, 12);
    integrate(a.state, a.targets, a.status, 1, 0.1);
    for (let i = 0; i < 6; i++) integrate(b.state, b.targets, b.status, 1, 1 / 60);
    for (let k = 0; k < STRIDE; k++) expect(a.state[k]).toBeCloseTo(b.state[k], 5);
  });

  it("caps the speed toward a far target", () => {
    const { state, targets, status } = one(0, 0, 5000, 0);
    for (let i = 0; i < 60; i++) {
      integrate(state, targets, status, 1, 1 / 60);
      expect(Math.hypot(state[2], state[3])).toBeLessThanOrEqual(MAX_SPEED + 1e-3);
    }
  });

  it("leaves an escaped agent where it is", () => {
    const { state, targets, status } = one(3, 4, 50, 50);
    status[0] = ESCAPED;
    integrate(state, targets, status, 1, 0.5);
    expect([state[0], state[1]]).toEqual([3, 4]);
  });

  it("moves each agent toward its own target", () => {
    const state = createCrowdState(2);
    const targets = new Float32Array([10, 0, 1, 0, -10, 0, 1, 0]);
    const status = new Uint8Array(2);
    for (let i = 0; i < 120; i++) integrate(state, targets, status, 2, 1 / 60);
    expect(state[0]).toBeGreaterThan(9);
    expect(state[STRIDE]).toBeLessThan(-9);
  });

  it("does nothing for a zero or negative step", () => {
    const { state, targets, status } = one(1, 2, 9, 9);
    integrate(state, targets, status, 1, 0);
    integrate(state, targets, status, 1, -1);
    expect([state[0], state[1], state[2], state[3]]).toEqual([1, 2, 0, 0]);
  });
});

describe("snap", () => {
  it("puts every agent on its target at rest", () => {
    const { state, targets } = one(0, 0, 7, -2);
    state[2] = 5;
    snap(state, targets, 1);
    expect([state[0], state[1], state[2], state[3]]).toEqual([7, -2, 0, 0]);
  });
});
