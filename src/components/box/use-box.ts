"use client";

import { useEffect, useState } from "react";
import type { BoxApp, BoxSnapshot } from "@/engine/box/app";
import type { BoxOverlay } from "@/engine/box/overlay";

/**
 * The engine's latest snapshot, re-rendering only when its version moves (10 Hz at most, plus escape
 * stages), and a `refresh` for an event handler that has just changed the engine: a controlled input
 * is put back to its props when the handler returns, so the new snapshot must be in by then.
 */
export function useBoxSnapshot(app: BoxApp): [BoxSnapshot, () => void] {
  const [snap, setSnap] = useState<BoxSnapshot>(() => app.stats());
  useEffect(() => {
    let raf = 0;
    let seen = -1;
    const poll = () => {
      const next = app.stats();
      if (next.version !== seen) {
        seen = next.version;
        setSnap(next);
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [app]);
  return [snap, () => setSnap(app.stats())];
}

/** The engine's overlay (marker, lab and link positions in CSS px), re-rendering when its version moves. */
export function useBoxOverlay(app: BoxApp): BoxOverlay {
  const [overlay, setOverlay] = useState<BoxOverlay>(() => app.overlay());
  useEffect(() => {
    let raf = 0;
    let seen = -1;
    const poll = () => {
      const next = app.overlay();
      if (next.version !== seen) {
        seen = next.version;
        setOverlay(next);
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [app]);
  return overlay;
}
