import { describe, expect, it } from "vitest";
import { buildTimeline } from "@/lib/trace/timeline";
import type { SessionTrace } from "@/lib/trace/types";
import { clampRate, createFrameSync, createPlayback, MAX_RATE, MIN_RATE } from "./playback";

/** Events at 0 and 500 s: the 500 s gap is cut to 8 playback seconds, so playback runs 18 s. */
function gapTrace(): SessionTrace {
  return {
    version: 1,
    source: "sample",
    label: "gap",
    duration: 510,
    agents: [
      {
        id: 0,
        parent: -1,
        depth: 0,
        model: "opus",
        modelId: "m",
        agentType: "main",
        label: "Orchestrator",
        spawnT: 0,
        returnT: 510,
        returned: false,
        background: false,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        toolCalls: 0,
        childMissing: false,
      },
    ],
    events: [
      { t: 0, agent: 0, kind: "prompt" },
      { t: 500, agent: 0, kind: "prompt" },
    ],
    truncated: false,
  };
}

const identity = { duration: 100, toPlayback: (t: number) => t, toTrace: (p: number) => p };

describe("clampRate", () => {
  it("keeps the rate between 1 and 200", () => {
    expect(clampRate(0.2)).toBe(MIN_RATE);
    expect(clampRate(500)).toBe(MAX_RATE);
    expect(clampRate(37)).toBe(37);
    expect(clampRate(Number.NaN)).toBe(1);
  });
});

describe("createPlayback", () => {
  it("advances by real seconds times the rate while playing, and not while paused", () => {
    const p = createPlayback(identity, { rate: 4 });
    p.advance(1);
    expect(p.time()).toBe(0);
    p.play();
    p.advance(1.5);
    expect(p.time()).toBe(6);
    p.pause();
    p.advance(10);
    expect(p.time()).toBe(6);
  });

  it("plays through an idle cut in its compressed playback time", () => {
    const timeline = buildTimeline(gapTrace());
    const p = createPlayback(timeline, { playing: true });
    p.advance(4);
    expect(p.time()).toBeCloseTo(250, 6);
    p.advance(4);
    expect(p.time()).toBeCloseTo(500, 6);
  });

  it("stops at the end, and play from the end starts over", () => {
    const p = createPlayback(identity, { t: 95, rate: 10, playing: true });
    p.advance(1);
    expect(p.time()).toBe(100);
    expect(p.playing()).toBe(false);
    p.play();
    expect(p.time()).toBe(0);
    expect(p.playing()).toBe(true);
  });

  it("clamps seeks and rates", () => {
    const p = createPlayback(identity);
    p.seek(-5);
    expect(p.time()).toBe(0);
    p.seek(1e9);
    expect(p.time()).toBe(100);
    p.setRate(1000);
    expect(p.rate()).toBe(200);
  });

  it("starts over on a new trace", () => {
    const p = createPlayback(identity, { t: 50 });
    p.setMap({ duration: 30, toPlayback: (t) => t, toTrace: (x) => x });
    expect(p.time()).toBe(0);
  });
});

describe("createFrameSync", () => {
  it("rebuilds on the first frame, then emits through ordinary play however far a frame jumps", () => {
    const sync = createFrameSync();
    expect(sync.next(0)).toBe("rebuild");
    expect(sync.next(0.5)).toBe("emit");
    // Across an idle cut, or one long frame at 200x: still ordinary play, so its sounds play.
    expect(sync.next(900)).toBe("emit");
    expect(sync.next(950)).toBe("emit");
  });

  it("rebuilds after an explicit rewrite (a seek, a rate, a trace, a quality step), however small the jump", () => {
    const sync = createFrameSync();
    sync.next(100);
    sync.rewrite();
    expect(sync.next(110)).toBe("rebuild");
    expect(sync.next(111)).toBe("emit");
  });

  it("rebuilds when time runs backwards, as a replay from the end does", () => {
    const sync = createFrameSync();
    sync.next(100);
    expect(sync.next(0)).toBe("rebuild");
    expect(sync.next(1)).toBe("emit");
  });
});
