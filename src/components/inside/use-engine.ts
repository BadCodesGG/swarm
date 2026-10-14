"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { InsideApp } from "@/engine/inside/app";
import type { Timeline } from "@/lib/trace/timeline";

/** The selected agent id, or -1. Re-renders on the bus's `select` event. */
export function useSelection(app: InsideApp): number {
  return useSyncExternalStore(
    (notify) => app.bus.on("select", notify),
    () => app.selected(),
    () => -1,
  );
}

/** The current trace's timeline; changes when `setTrace` swaps the source. */
export function useTimeline(app: InsideApp): Timeline {
  return useSyncExternalStore(
    (notify) => app.bus.on("trace", notify),
    () => app.timeline(),
    () => app.timeline(),
  );
}

/** Live `matchMedia` result; `serverValue` while rendering on the server. */
export function useMedia(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (notify) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", notify);
      return () => m.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** The phone layout (below Tailwind's `sm`). */
export const useNarrow = () => useMedia("(max-width: 639px)");

/**
 * Polls `read` each animation frame (or every `intervalMs`) and re-renders only when `same` says the
 * value changed, so a 60 Hz engine does not mean a 60 Hz React tree. Pass a `read` that is stable
 * between renders (`useCallback`), or remount with a `key`: a new `read` restarts the poll.
 */
export function useEngineSnapshot<T>(read: () => T, same: (a: T, b: T) => boolean, intervalMs = 0): T {
  const [value, setValue] = useState<T>(read);
  const last = useRef(value);
  useEffect(() => {
    let raf = 0;
    let at = 0;
    const tick = (now: number) => {
      if (now - at >= intervalMs) {
        at = now;
        const next = read();
        if (!same(next, last.current)) {
          last.current = next;
          setValue(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [read, same, intervalMs]);
  return value;
}

export interface ClockSnap {
  /** Trace seconds. */
  t: number;
  /** 0..1 along the playback axis (idle stretches compressed). */
  frac: number;
  rate: number;
  playing: boolean;
}

const sameClock = (a: ClockSnap, b: ClockSnap) =>
  a.rate === b.rate && a.playing === b.playing && Math.floor(a.t) === Math.floor(b.t) && Math.round(a.frac * 1500) === Math.round(b.frac * 1500);

/** Time, rate and play state, changing only when a second, the playhead's pixel, the rate or play state does. */
export function useClock(app: InsideApp): ClockSnap {
  const read = useCallback((): ClockSnap => {
    const tl = app.timeline();
    const t = app.time();
    return { t, frac: tl.playbackDuration > 0 ? tl.toPlayback(t) / tl.playbackDuration : 0, rate: app.rate(), playing: app.playing() };
  }, [app]);
  return useEngineSnapshot(read, sameClock);
}

/** The selected tool station, or null. Re-renders on the bus's `station` event. */
export function useStation(app: InsideApp) {
  return useSyncExternalStore(
    (notify) => app.bus.on("station", notify),
    () => app.station(),
    () => null,
  );
}
