"use client";

import { useEffect, useState } from "react";
import type { BoxApp, BoxSnapshot } from "@/engine/box/app";

/** The engine's latest snapshot, re-rendering only when its version moves (10 Hz at most, plus escape stages). */
export function useBoxSnapshot(app: BoxApp): BoxSnapshot {
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
  return snap;
}
