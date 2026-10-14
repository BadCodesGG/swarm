import { describe, expect, it } from "vitest";
import { presetScenario } from "@/lib/box/presets";
import { scenarioFromParams } from "@/lib/box/share";
import {
  addLab,
  bestScore,
  firstVisitParams,
  linkLabs,
  nextInterceptLine,
  presetOf,
  recordBest,
  removeLab,
  setCast,
  setupLabel,
  spreadLine,
  stepAfter,
  spreadPoints,
  shareQuery,
  unlinkLabs,
} from "./playground";

describe("firstVisitParams", () => {
  it("adds the breakout preset to a plain visit", () => {
    expect(firstVisitParams(new URLSearchParams("")).get("preset")).toBe("breakout");
    expect(firstVisitParams(new URLSearchParams("webgl=1")).get("preset")).toBe("breakout");
  });
  it("leaves any request for a particular run alone", () => {
    for (const q of ["seed=1", "preset=air-gapped", "shot=escape", "labs=2", "b=meridian.1.1.1.1.1.1.1-1-1", "scenario=x"]) {
      expect(firstVisitParams(new URLSearchParams(q)).toString()).toBe(new URLSearchParams(q).toString());
    }
  });
});

describe("builder edits", () => {
  const three = presetScenario("default-lab");
  it("adds the next unused lab, up to five, and links nothing new", () => {
    const four = addLab(three);
    expect(four.labs.map((l) => l.id)).toEqual(["meridian", "kestrel", "halcyon", "orrery"]);
    expect(addLab(addLab(four)).labs).toHaveLength(5);
    expect(addLab(addLab(addLab(four))).labs).toHaveLength(5);
  });
  it("removes a lab with the links that reached it, never the last one", () => {
    const two = removeLab(three, "halcyon");
    expect(two.labs.map((l) => l.id)).toEqual(["meridian", "kestrel"]);
    expect(two.links.every((l) => l.labs.length >= 2 && !l.labs.includes("halcyon"))).toBe(true);
    const one = removeLab(removeLab(three, "halcyon"), "kestrel");
    expect(removeLab(one, "meridian").labs).toHaveLength(1);
  });
  it("links two labs by kind once, and unlinks them", () => {
    const base = { ...three, links: [] };
    const linked = linkLabs(base, "ci-runner", "meridian", "kestrel");
    expect(linked.links).toEqual([{ kind: "ci-runner", labs: ["meridian", "kestrel"] }]);
    expect(linkLabs(linked, "ci-runner", "kestrel", "meridian").links).toHaveLength(1);
    expect(linkLabs(base, "ci-runner", "meridian", "meridian").links).toHaveLength(0);
    expect(unlinkLabs(linked, 0).links).toHaveLength(0);
  });
  it("sets a cast only when it is valid", () => {
    const ok = setCast(three, "kestrel", { sandbagging: 0.3, hidden: { getOut: 1, persist: 1, recruit: 1 } });
    expect(ok?.labs[1].cast.sandbagging).toBe(0.3);
    expect(setCast(three, "kestrel", { sandbagging: 0.3, hidden: { getOut: 0, persist: 0, recruit: 0 } })).toBeNull();
  });
});

describe("shareQuery", () => {
  it("round-trips through the share format", () => {
    const s = removeLab(presetScenario("rushed-launch"), "halcyon");
    const back = scenarioFromParams(new URLSearchParams(shareQuery(s)));
    expect(back).toEqual(scenarioFromParams(new URLSearchParams(shareQuery(back!))));
    expect(back?.labs.map((l) => l.id)).toEqual(["meridian", "kestrel"]);
  });
});

describe("setupLabel", () => {
  it("names a preset setup and numbers the others in order", () => {
    const names: Record<string, string> = {};
    expect(setupLabel(presetScenario("breakout"), names)).toBe("Breakout");
    const custom = removeLab(presetScenario("default-lab"), "halcyon");
    expect(setupLabel(custom, names)).toBe("custom 1");
    expect(setupLabel(custom, names)).toBe("custom 1");
    expect(setupLabel(addLab(custom), names)).toBe("custom 2");
  });
});

describe("spreadPoints", () => {
  it("gives four crowded points room of their own", () => {
    const out = spreadPoints([{ x: 100, y: 100 }, { x: 104, y: 101 }, { x: 100, y: 100 }, { x: 108, y: 103 }], 30);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(Math.hypot(out[i].x - out[j].x, out[i].y - out[j].y)).toBeGreaterThanOrEqual(29.5);
  });
  it("leaves points that are already apart where they are", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(spreadPoints(pts, 30)).toEqual(pts);
  });
  it("keeps every point inside the box it is given, and still apart", () => {
    // Four markers crowding the slot's top right corner, two of them already past its edge.
    const box = { x0: 0, y0: 0, x1: 300, y1: 200 };
    const out = spreadPoints([{ x: 290, y: -6 }, { x: 296, y: 12 }, { x: 304, y: 4 }, { x: 282, y: 20 }], 40, box);
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(box.x0);
      expect(p.x).toBeLessThanOrEqual(box.x1);
      expect(p.y).toBeGreaterThanOrEqual(box.y0);
      expect(p.y).toBeLessThanOrEqual(box.y1);
    }
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(Math.hypot(out[i].x - out[j].x, out[i].y - out[j].y)).toBeGreaterThanOrEqual(39.5);
  });
});

describe("spreadLine", () => {
  it("keeps ordered positions apart and inside the bounds", () => {
    const out = spreadLine([10, 11, 12, 300], 26, 12, 290);
    for (let i = 1; i < out.length; i++) expect(out[i] - out[i - 1]).toBeGreaterThanOrEqual(26);
    expect(out[0]).toBeGreaterThanOrEqual(12);
    expect(out[3]).toBeLessThanOrEqual(290);
  });
});

describe("nextInterceptLine", () => {
  const lines = [1, 2, 3].map((n) => ({ tick: n, who: "KESTREL-7", lab: "kestrel" as const, text: `line ${n}`, fiction: true as const }));
  it("speaks the newest unspoken line, at most once per gap", () => {
    expect(nextInterceptLine(lines, 0, -10000, 100, 4000)?.text).toBe("line 3");
    expect(nextInterceptLine(lines, 0, 1000, 2000, 4000)).toBeNull();
    expect(nextInterceptLine(lines, 3, 0, 9000, 4000)).toBeNull();
  });
});

describe("best score", () => {
  const store = (): Storage => {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) } as Storage;
  };
  it("keeps the highest score and survives a storage that throws", () => {
    const s = store();
    expect(bestScore(s)).toBe(0);
    expect(recordBest(s, 40)).toBe(40);
    expect(recordBest(s, 25)).toBe(40);
    const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } } as unknown as Storage;
    expect(bestScore(broken)).toBe(0);
    expect(recordBest(broken, 30)).toBe(30);
    expect(bestScore(null)).toBe(0);
  });
});

describe("presetOf", () => {
  it("knows a preset by its settings, whatever the seed, and loses it on any change", () => {
    expect(presetOf(presetScenario("rushed-launch", 7))).toBe("rushed-launch");
    const s = presetScenario("air-gapped");
    expect(presetOf(s)).toBe("air-gapped");
    expect(presetOf({ ...s, labs: s.labs.map((l, i) => (i ? l : { ...l, config: { ...l.config, layers: { ...l.config.layers, audit: false } } })) })).toBeNull();
  });
});

describe("stepAfter", () => {
  it("moves to the next or previous step number shown", () => {
    expect(stepAfter([1, 2, 4], 2, 1)).toBe(4);
    expect(stepAfter([1, 2, 4], 4, -1)).toBe(2);
  });

  it("opens the first step going forward and the last going back when none is open", () => {
    expect(stepAfter([3, 1, 2], null, 1)).toBe(1);
    expect(stepAfter([3, 1, 2], null, -1)).toBe(3);
  });

  it("stays put at either end, and has nothing to open with no steps", () => {
    expect(stepAfter([1, 2], 2, 1)).toBe(2);
    expect(stepAfter([1, 2], 1, -1)).toBe(1);
    expect(stepAfter([], null, 1)).toBeNull();
  });
});

describe("best score per budget", () => {
  const store = (): Storage => {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) } as Storage;
  };
  it("keeps one best for each budget", () => {
    const s = store();
    recordBest(s, 70, 0.25);
    recordBest(s, 40, 0.1);
    expect(bestScore(s, 0.25)).toBe(70);
    expect(bestScore(s)).toBe(70);
    expect(bestScore(s, 0.1)).toBe(40);
    expect(bestScore(s, 0.4)).toBe(0);
    expect(recordBest(s, 30, 0.1)).toBe(40);
  });
  it("puts the budget in the share query only when it is not the default", () => {
    const sc = presetScenario("breakout", 3);
    expect(shareQuery(sc)).not.toContain("d=");
    expect(shareQuery(sc, 0.35)).toContain("d=35");
  });
});
