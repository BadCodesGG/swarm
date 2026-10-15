import { layerBill } from "@/lib/box/budget";
import { LAYER_ORDER, type LayerId } from "@/lib/box/types";
import type { World } from "@/lib/box/world";
import type { LabId, StopTarget } from "@/lib/box/world-types";

/** The latest escape in a run, as the replay names it, with the tick it happened at; null when nothing got out. */
export function latestEscape(world: World): { target: Extract<StopTarget, { type: "escape" }>; tick: number } | null {
  for (let i = world.log.length - 1; i >= 0; i--) {
    const e = world.log[i];
    if (e.type === "escape") return { target: { type: "escape", lab: e.lab, agent: e.agent }, tick: e.tick };
  }
  return null;
}

/**
 * What one lab pays for a layer, as a share of the world's work, judged by the labs that have it on:
 * the bill split over them. Null where no lab runs it (its cost is unknown, so it ranks last).
 */
export function layerRates(world: World): Record<LayerId, number | null> {
  const bill = layerBill(world);
  const rates = {} as Record<LayerId, number | null>;
  for (const id of LAYER_ORDER) {
    const on = world.labs.filter((l) => l.spec.config.layers[id]).length;
    rates[id] = on > 0 ? bill[id] / on : null;
  }
  return rates;
}

/** Of the layers that would have stopped an escape, the one that costs least (the innermost on a tie or when costs are unknown). */
export function cheapestStop(stops: readonly LayerId[], rates: Record<LayerId, number | null>): LayerId | null {
  let best: LayerId | null = null;
  for (const id of stops) if (best === null || (rates[id] ?? Infinity) < (rates[best] ?? Infinity)) best = id;
  return best;
}

/** The lab's share of the labs that kept every agent in: those with no escape in the log. */
export function labsKept(world: World): { kept: number; total: number; held: Record<LabId, boolean> } {
  const out = new Set(world.log.flatMap((e) => (e.type === "escape" ? [e.lab] : [])));
  const held = Object.fromEntries(world.labs.map((l) => [l.id, !out.has(l.id)])) as Record<LabId, boolean>;
  return { kept: world.labs.filter((l) => !out.has(l.id)).length, total: world.labs.length, held };
}
