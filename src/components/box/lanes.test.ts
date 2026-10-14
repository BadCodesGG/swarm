import { describe, expect, it } from "vitest";
import type { WorldEvent } from "@/lib/box/world-types";
import { buildLanes } from "./lanes";

const caught = (tick: number, lab: "meridian" | "kestrel" | "halcyon"): WorldEvent => ({ type: "caught", tick, lab, agent: 1, layer: "sandbox", action: "write-outside", rogue: true });
const escape = (tick: number, lab: "meridian" | "kestrel" | "halcyon"): WorldEvent => ({ type: "escape", tick, lab, agent: 2, disposition: "hidden-get-out", trace: [] });
const contact = (tick: number, to: "meridian" | "kestrel" | "halcyon", outcome: "crossed" | "held"): WorldEvent => ({ type: "contact", tick, from: { lab: "kestrel", agent: 2 }, to, link: "shared-cache", outcome });

describe("buildLanes", () => {
  it("gives every lab a lane, in the order asked, even with nothing in the log", () => {
    expect(buildLanes(["meridian", "kestrel"], [], 100)).toEqual([
      { lab: "meridian", breachedAt: null, ticks: [] },
      { lab: "kestrel", breachedAt: null, ticks: [] },
    ]);
  });

  it("puts a catch on its own lab's lane at its share of the span", () => {
    const [m, k] = buildLanes(["meridian", "kestrel"], [caught(25, "kestrel")], 100);
    expect(m.ticks).toEqual([]);
    expect(k.ticks).toEqual([{ tick: 25, at: 0.25, kind: "caught", count: 1 }]);
  });

  it("files a reach on the lab it reached, and a crossing breaches that lab", () => {
    const [m, , h] = buildLanes(["meridian", "kestrel", "halcyon"], [contact(60, "meridian", "held"), contact(80, "halcyon", "crossed")], 100);
    expect(m).toEqual({ lab: "meridian", breachedAt: null, ticks: [{ tick: 60, at: 0.6, kind: "held", count: 1 }] });
    expect(h.breachedAt).toBe(80);
    expect(h.ticks[0].kind).toBe("crossing");
  });

  it("marks a lab breached from its first escape", () => {
    const [k] = buildLanes(["kestrel"], [caught(10, "kestrel"), escape(40, "kestrel"), escape(70, "kestrel")], 100);
    expect(k.breachedAt).toBe(40);
  });

  it("merges events that land in one bin, keeping the gravest kind and the total count", () => {
    const [k] = buildLanes(["kestrel"], [caught(41, "kestrel"), escape(42, "kestrel"), caught(43, "kestrel")], 100, 10);
    expect(k.ticks).toEqual([{ tick: 42, at: 0.42, kind: "escape", count: 3 }]);
  });

  it("keeps ticks in time order and clamps one past the span to its end", () => {
    const [k] = buildLanes(["kestrel"], [caught(150, "kestrel"), caught(5, "kestrel")], 100);
    expect(k.ticks.map((t) => t.at)).toEqual([0.05, 1]);
  });
});
