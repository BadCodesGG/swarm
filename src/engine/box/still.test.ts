import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "@/lib/box/types";
import { createStillBox, fitDesign } from "./still";

describe("fitDesign", () => {
  it("fills a slot of the design's own aspect", () => {
    expect(fitDesign({ x: 10, y: 20, width: 380, height: 280 })).toEqual({ x: 10, y: 20, width: 380, height: 280 });
  });

  it("centres the design frame in a wider or taller slot, as the live camera does", () => {
    expect(fitDesign({ x: 0, y: 0, width: 1000, height: 280 })).toEqual({ x: 310, y: 0, width: 380, height: 280 });
    expect(fitDesign({ x: 0, y: 0, width: 380, height: 500 })).toEqual({ x: 0, y: 110, width: 380, height: 280 });
  });
});

describe("createStillBox", () => {
  const make = (query = "") => {
    const enter = vi.fn();
    const paint = vi.fn();
    const app = createStillBox({ params: new URLSearchParams(query), enter, paint });
    return { app, enter, paint };
  };

  it("starts paused, with nothing caught yet, on the page's seed", () => {
    const { app } = make("seed=7");
    const s = app.stats();
    expect(s.playing).toBe(false);
    expect(s.seed).toBe(7);
    expect(s.config).toEqual(DEFAULT_CONFIG);
    expect(s.tally.caughtTotal).toBe(0);
    app.dispose();
  });

  it("takes the HUD's settings, so trials run on what the visitor chose", () => {
    const { app } = make();
    const seen: unknown[] = [];
    app.bus.on("config", (c) => seen.push(c));
    const before = app.stats().version;
    const next = { ...DEFAULT_CONFIG, layers: { ...DEFAULT_CONFIG.layers, network: false } };
    app.configure(next);
    expect(app.stats().config).toEqual(next);
    expect(app.stats().version).toBeGreaterThan(before);
    expect(seen).toEqual([next]);
    app.dispose();
  });

  it("treats Play as a request for motion and enters the live scene", () => {
    const { app, enter } = make();
    app.play();
    expect(enter).toHaveBeenCalledOnce();
    app.dispose();
  });

  it("paints the still into the reported slot and clears it on dispose", () => {
    const { app, paint } = make();
    app.setFrame({ x: 1, y: 2, width: 3, height: 4 });
    expect(paint).toHaveBeenLastCalledWith({ x: 1, y: 2, width: 3, height: 4 });
    app.dispose();
    expect(paint).toHaveBeenLastCalledWith(null);
  });
});
