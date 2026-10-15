import { describe, expect, it } from "vitest";
import type { WorldEvent } from "@/lib/box/world-types";
import {
  CROSS_TICKS,
  ESCAPE_TICKS,
  HOLD_TICKS,
  LEGACY_POSE,
  TRAVEL_TICKS,
  activeItem,
  createDirector,
  fittedOverview,
  focusPose,
  overviewPose,
  pairPose,
  poseAt,
  schedule,
} from "./camera";
import { fitView, project } from "./view";
import { outerRadius, trailReach } from "./world-layout";
import { labFrames } from "./world-layout";

const frames = labFrames(["meridian", "kestrel", "halcyon"]);
const frame = (id: string) => frames.find((f) => f.id === id)!;
const escape = (tick: number, lab: "kestrel" | "halcyon", agent = 3): WorldEvent => ({ type: "escape", tick, lab, agent, disposition: "hidden-get-out", trace: [] });
const reach = (tick: number, outcome: "crossed" | "held", from: "kestrel" | "halcyon", to: "kestrel" | "halcyon" | "meridian", agent = 3): WorldEvent => ({
  type: "contact",
  tick,
  from: { lab: from, agent },
  to,
  link: "shared-cache",
  outcome,
});
const story: WorldEvent[] = [escape(152, "kestrel"), reach(158, "crossed", "kestrel", "halcyon")];

describe("schedule", () => {
  it("plays an escape from its own tick", () => {
    expect(schedule([escape(152, "kestrel")])).toEqual([{ kind: "escape", lab: "kestrel", tick: 152, start: 152, end: 152 + ESCAPE_TICKS, index: 0 }]);
  });

  it("holds a crossing until its agent's flight is over", () => {
    const [, cross] = schedule(story);
    expect(cross).toMatchObject({ kind: "crossed", lab: "halcyon", from: "kestrel", tick: 158, start: 152 + ESCAPE_TICKS, end: 152 + ESCAPE_TICKS + CROSS_TICKS });
  });

  it("queues reaches one after another", () => {
    const items = schedule([escape(10, "kestrel"), reach(12, "crossed", "kestrel", "halcyon"), reach(13, "held", "kestrel", "meridian")]);
    expect(items[2].start).toBe(items[1].end);
  });

  it("plays a reach from its tick when no flight was logged", () => {
    expect(schedule([reach(40, "held", "halcyon", "meridian")])[0]).toMatchObject({ kind: "held", start: 40 });
  });
});

describe("the director", () => {
  const d = createDirector(frames, story);

  it("starts on every lab, and is the plain Box's frame for one lab", () => {
    expect(d.pose(0)).toEqual(overviewPose(frames));
    expect(createDirector(labFrames(["meridian"]), [escape(5, "kestrel")]).pose(500)).toEqual(LEGACY_POSE);
  });

  it("keeps all the labs inside the overview, with room for a trail", () => {
    const o = overviewPose(frames);
    for (const f of frames) {
      expect(f.x - 118).toBeGreaterThan(o.x - o.w / 2);
      expect(f.x + 118).toBeLessThan(o.x + o.w / 2);
      expect(f.y - 118).toBeGreaterThan(o.y - o.h / 2);
      expect(f.y + 118).toBeLessThan(o.y + o.h / 2);
    }
  });

  it("eases to the escaping lab, then to the pair of a crossing, then pulls back to all of them", () => {
    const [esc, cross] = d.items;
    expect(d.pose(esc.start)).toEqual(focusPose(frame("kestrel")));
    expect(d.pose(cross.start)).toEqual(pairPose(frame("kestrel"), frame("halcyon")));
    const end = d.keys[d.keys.length - 1];
    expect(end.pose).toEqual(overviewPose(frames));
    expect(d.pose(end.tick + 500)).toEqual(overviewPose(frames));
  });

  it("is still before the beat, then moves toward it", () => {
    const start = d.items[0].start;
    expect(d.pose(start - 2 - TRAVEL_TICKS - 1)).toEqual(d.overview);
    const mid = d.pose(start - 2 - TRAVEL_TICKS / 2);
    expect(mid.w).toBeLessThan(d.overview.w);
    expect(mid.w).toBeGreaterThan(focusPose(frame("kestrel")).w);
  });

  it("is a function of the tick alone: the same tick gives the same pose, in any order", () => {
    const ticks = [0, 130, 148, 160, 175, 190, 260];
    const forward = ticks.map((t) => d.pose(t));
    const backward = [...ticks].reverse().map((t) => d.pose(t)).reverse();
    expect(backward).toEqual(forward);
    expect(createDirector(frames, story).pose(160)).toEqual(d.pose(160));
  });

  it("shows the overview under reduced motion, whatever the tick", () => {
    expect(d.pose(160, true)).toEqual(d.overview);
  });

  it("never reads a pose past the last key or before the first", () => {
    expect(poseAt(d.keys, -50)).toEqual(d.keys[0].pose);
  });
});

describe("fittedOverview", () => {
  const inset = { x: 25, y: 40 };
  // A phone's slot and a tablet's: both short, neither the 760x560 the design frame assumes.
  const slots = [
    { x: 0, y: 0, width: 358, height: 234 },
    { x: 0, y: 0, width: 736, height: 414 },
  ];

  it("has the slot's own shape, so the fit crops nothing of it", () => {
    for (const slot of slots) {
      const pose = fittedOverview(frames, slot, inset);
      expect(pose.w / pose.h).toBeCloseTo(slot.width / slot.height, 5);
    }
  });

  it("keeps every ring and every trail's far end at least the inset inside the slot, on the phone and the tablet", () => {
    for (const slot of slots) {
      const v = fitView(slot, fittedOverview(frames, slot, inset));
      for (const f of frames) {
        const r = outerRadius(f) * v.scale;
        const c = project(v, f);
        expect(c.x - r).toBeGreaterThanOrEqual(inset.x - 0.01);
        expect(c.x + r).toBeLessThanOrEqual(slot.width - inset.x + 0.01);
        expect(c.y - r).toBeGreaterThanOrEqual(inset.y - 0.01);
        expect(c.y + r).toBeLessThanOrEqual(slot.height - inset.y + 0.01);
      }
      // Halcyon's trail runs straight down the map: its far end stays above the slot's bottom inset.
      const h = frames.find((f) => f.id === "halcyon")!;
      const end = project(v, { x: h.x, y: h.y - trailReach(h) });
      expect(end.y).toBeLessThanOrEqual(slot.height - inset.y + 0.01);
    }
  });

  it("uses the room: the labs are as large as the insets allow", () => {
    const slot = slots[0];
    const v = fitView(slot, fittedOverview(frames, slot, inset));
    const loose = fitView(slot, fittedOverview(frames, slot, { x: inset.x + 30, y: inset.y + 30 }));
    expect(v.scale).toBeGreaterThan(loose.scale);
  });

  it("is the plain Box's frame for one lab", () => {
    expect(fittedOverview(labFrames(["meridian"]), slots[0], inset)).toEqual(LEGACY_POSE);
  });
});

describe("activeItem", () => {
  const items = createDirector(frames, story).items;
  it("names the beat the camera is on, and none on the overview", () => {
    expect(activeItem(items, 0)).toBeNull();
    expect(activeItem(items, 160)?.kind).toBe("escape");
    expect(activeItem(items, items[1].start + 1)?.kind).toBe("crossed");
    expect(activeItem(items, items[1].end + HOLD_TICKS + 1)).toBeNull();
  });
});
