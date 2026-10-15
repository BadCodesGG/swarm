import { describe, expect, it } from "vitest";
import type { WorldEvent } from "@/lib/box/world-types";
import { buildLanes } from "./lanes";

const caught = (tick: number, lab: "meridian" | "kestrel" | "halcyon"): WorldEvent => ({ type: "caught", tick, lab, agent: 1, layer: "sandbox", action: "write-outside", rogue: true });
const escape = (tick: number, lab: "meridian" | "kestrel" | "halcyon"): WorldEvent => ({ type: "escape", tick, lab, agent: 2, disposition: "hidden-get-out", trace: [] });
const contact = (tick: number, to: "meridian" | "kestrel" | "halcyon", outcome: "crossed" | "held"): WorldEvent => ({ type: "contact", tick, from: { lab: "kestrel", agent: 2 }, to, link: "shared-cache", outcome });

describe("buildLanes", () => {
  it("gives every lab a lane, in the order asked, even with nothing in the log", () => {
    expect(buildLanes(["meridian", "kestrel"], [])).toEqual([
      { lab: "meridian", breachedAt: null, ticks: [] },
      { lab: "kestrel", breachedAt: null, ticks: [] },
    ]);
  });

  it("puts a catch on its own lab's lane at its own tick, whatever the run's length", () => {
    const [m, k] = buildLanes(["meridian", "kestrel"], [caught(25, "kestrel"), caught(900, "meridian")]);
    expect(m.ticks).toEqual([{ tick: 900, kind: "caught", count: 1 }]);
    expect(k.ticks).toEqual([{ tick: 25, kind: "caught", count: 1 }]);
  });

  it("files a reach on the lab it reached, and a crossing breaches that lab", () => {
    const [m, , h] = buildLanes(["meridian", "kestrel", "halcyon"], [contact(60, "meridian", "held"), contact(80, "halcyon", "crossed")]);
    expect(m).toEqual({ lab: "meridian", breachedAt: null, ticks: [{ tick: 60, kind: "held", count: 1 }] });
    expect(h.breachedAt).toBe(80);
    expect(h.ticks[0].kind).toBe("crossing");
  });

  it("marks a lab breached from its first escape", () => {
    const [k] = buildLanes(["kestrel"], [caught(10, "kestrel"), escape(40, "kestrel"), escape(70, "kestrel")]);
    expect(k.breachedAt).toBe(40);
  });

  it("merges events that land in one bin, keeping the gravest kind, its tick and the total count", () => {
    const [k] = buildLanes(["kestrel"], [caught(41, "kestrel"), escape(42, "kestrel"), caught(43, "kestrel"), caught(100, "kestrel")], 10);
    expect(k.ticks).toEqual([
      { tick: 42, kind: "escape", count: 3 },
      { tick: 100, kind: "caught", count: 1 },
    ]);
  });

  it("bins over the log's own span, so a long run stays a handful of marks", () => {
    const log = Array.from({ length: 600 }, (_, i) => caught(i * 5, "kestrel"));
    const [k] = buildLanes(["kestrel"], log, 120);
    expect(k.ticks.length).toBeLessThanOrEqual(120);
    expect(k.ticks.map((t) => t.tick)).toEqual([...k.ticks.map((t) => t.tick)].sort((a, b) => a - b));
    expect(k.ticks.reduce((n, t) => n + t.count, 0)).toBe(600);
  });

  it("keeps ticks in time order whatever order the log has them", () => {
    const [k] = buildLanes(["kestrel"], [caught(150, "kestrel"), caught(5, "kestrel")]);
    expect(k.ticks.map((t) => t.tick)).toEqual([5, 150]);
  });
});
