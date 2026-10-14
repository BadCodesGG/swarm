"use client";

import { useEffect, useState } from "react";
import { replayWorld, type World } from "@/lib/box/world";
import type { Flip, Scenario } from "@/lib/box/world-types";

/**
 * The world rebuilt at `tick` from its scenario and the visitor's flips (exact: same inputs, same
 * world). `bucket` rounds the tick down so a live run rebuilds every `bucket` ticks, not every frame.
 */
export function useWorldAt(scenario: Scenario, flips: readonly Flip[], tick: number, bucket = 1, enabled = true): World | null {
  const [world, setWorld] = useState<World | null>(null);
  const at = Math.floor(tick / bucket) * bucket;
  useEffect(() => {
    if (!enabled) return;
    const id = window.setTimeout(() => setWorld(replayWorld(scenario, flips, at)), 0);
    return () => window.clearTimeout(id);
  }, [scenario, flips, at, enabled]);
  return world;
}
