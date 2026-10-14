import { describe, expect, it } from "vitest";
import { compareBranch, forkBranch, outcomeOf, restoreWorld, snapshotWorld } from "./branch";
import { createWorld, runWorld, setLayer } from "./world";
import { ALL_ON, pair } from "./world-fixtures";

const live = (seed = 4) => {
  const w = createWorld(pair(seed, ALL_ON));
  runWorld(w, 40);
  setLayer(w, "kestrel", "monitor", false);
  runWorld(w, 20);
  return w;
};

describe("snapshot and restore", () => {
  it("restores the world at its tick, event for event, and it runs on identically", () => {
    const w = live();
    const snap = snapshotWorld(w);
    expect(snap.tick).toBe(60);
    const back = restoreWorld(snap);
    expect(back.log).toEqual(w.log);
    runWorld(w, 50);
    runWorld(back, 50);
    expect(back.log).toEqual(w.log);
    expect(back.work).toBe(w.work);
  });

  it("survives a JSON trip", () => {
    const w = live();
    const snap = JSON.parse(JSON.stringify(snapshotWorld(w)));
    expect(restoreWorld(snap).log).toEqual(w.log);
  });

  it("a snapshot is a copy: later flips do not leak into it", () => {
    const w = live();
    const snap = snapshotWorld(w);
    setLayer(w, "meridian", "audit", true);
    expect(snap.flips).toHaveLength(1);
  });
});

describe("forkBranch", () => {
  it("flips one layer at the snapshot tick and leaves the original alone", () => {
    const snap = snapshotWorld(live());
    const branch = forkBranch(snap, { lab: "kestrel", layer: "network", on: false });
    expect(branch.tick).toBe(snap.tick);
    expect(branch.labs[1].state.config.layers.network).toBe(false);
    expect(branch.flips.at(-1)).toEqual({ tick: 60, lab: "kestrel", layer: "network", on: false });
    expect(snap.flips).toHaveLength(1);
    expect(restoreWorld(snap).labs[1].state.config.layers.network).toBe(true);
  });

  it("rejects a lab the world does not have", () => {
    expect(() => forkBranch(snapshotWorld(live()), { lab: "vesper", layer: "audit", on: false })).toThrow(/no lab/);
  });
});

describe("compareBranch", () => {
  it("a change that does nothing gives the same outcome; one that lets a lab fall changes it", () => {
    const snap = snapshotWorld(createWorld(pair(2, ALL_ON)));
    const same = compareBranch(snap, { lab: "kestrel", layer: "sandbox", on: true }, 150);
    expect(same.branch).toEqual(same.base);
    let worse = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = snapshotWorld(createWorld(pair(seed, ALL_ON)));
      const r = compareBranch(s, { lab: "kestrel", layer: "sandbox", on: false }, 150);
      expect(r.branch.escapes).toBe(r.base.escapes);
      if (r.branch.crossings > r.base.crossings) worse++;
      expect(r.branch.crossings).toBeGreaterThanOrEqual(r.base.crossings);
    }
    expect(worse).toBeGreaterThan(0);
  });

  it("outcomeOf counts what the log holds", () => {
    const w = live(6);
    const o = outcomeOf(w);
    expect(o.caught).toBe(w.log.filter((e) => e.type === "caught").length);
    expect(o.work).toBe(w.work);
  });
});
