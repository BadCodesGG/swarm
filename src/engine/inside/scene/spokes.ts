/**
 * Radial spokes: thin lines from the focused cluster's hub out to its recent tool calls, drawn only
 * for the one cluster the camera is on, like the spokes round the hub in a prompt map. Each call
 * gets a fixed direction (a golden-spiral point on the sphere, picked by its event index), so the
 * spokes hold still while the cluster is watched; they grow in over a moment and fade as they age.
 */

import { Color, type Object3D } from "three/webgpu";
import type { Timeline } from "@/lib/trace/timeline";
import { cloudAt, newCloudState } from "../nebula-plan";
import { modelColor, type InsideUniforms } from "./common";
import { createLineBatch, type LineSpec } from "./tethers";

/** Trace seconds a call's spoke lasts. */
const SPOKE_LIFE = 45;
/** Trace seconds a spoke takes to grow out. */
const SPOKE_GROW = 1.5;
const MAX_SPOKES = 14;
const SCAN = 800;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export interface Spokes {
  /** Draws the spokes of agent `id` (or none for -1) at trace time `t`; `radius` is its cloud's radius in world units. */
  update(timeline: Timeline, t: number, id: number, radius: number): void;
  dispose(): void;
}

export function createSpokes(parent: Object3D, u: InsideUniforms): Spokes {
  const batch = createLineBatch(parent, u, MAX_SPOKES, 42);
  const hub = newCloudState();
  const colour = new Color();
  const spec: LineSpec = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, bow: 0, widthPx: 1, dashPx: 0, reveal: 1, color: colour, alpha: 0.4 };
  return {
    update(timeline, t, id, radius) {
      batch.begin();
      if (id >= 0 && radius > 0) {
        const { trace } = timeline;
        cloudAt(trace, id, t, hub);
        modelColor(trace.agents[id].model, colour);
        let n = 0;
        const hi = timeline.indexAt(t);
        for (let i = hi - 1; i >= 0 && i >= hi - SCAN && n < MAX_SPOKES; i--) {
          const e = trace.events[i];
          if (t - e.t > SPOKE_LIFE) break;
          if (e.agent !== id || (e.kind !== "call" && e.kind !== "spawn")) continue;
          const age = t - e.t;
          // A golden-spiral direction on the sphere, fixed by the event's index.
          const z = 1 - 2 * ((i * 0.618034) % 1);
          const ring = Math.sqrt(Math.max(0, 1 - z * z));
          const a = i * GOLDEN;
          const len = radius * (0.9 + 0.5 * ((i * 0.37) % 1));
          spec.ax = hub.x;
          spec.ay = hub.y;
          spec.az = hub.z;
          spec.bx = hub.x + Math.cos(a) * ring * len;
          spec.by = hub.y + z * len;
          spec.bz = hub.z + Math.sin(a) * ring * len;
          spec.reveal = Math.min(1, Math.max(age / SPOKE_GROW, 0.001));
          spec.alpha = 0.5 * (1 - age / SPOKE_LIFE);
          batch.push(spec);
          n++;
        }
      }
      batch.end();
    },
    dispose() {
      batch.dispose();
    },
  };
}
