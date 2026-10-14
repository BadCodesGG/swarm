import { baselineWork, escapeTotal, rogueTotal, type World } from "./world";
import { LAYER_ORDER, type LayerId } from "./types";

/** Share of the all-layers-off work the defender may give up to its layers. */
export const DEFENDER_BUDGET = 0.25;

export interface DefenderScore {
  /** Hidden-goal agents that did not get out. */
  stopped: number;
  rogues: number;
  /** Share of work the layers left alone, 0 to 1. */
  workKept: number;
  /** Share of the baseline work the layers cost. */
  workLost: number;
  budget: number;
  /** The layers cost more work than the budget allows: the score is zero. */
  overBudget: boolean;
  /** 0 to 100: the share of hidden-goal agents stopped times the work kept. Zero over budget. */
  score: number;
}

/** What each layer cost, as a share of the all-layers-off work. */
export function layerBill(world: World): Record<LayerId, number> {
  const base = baselineWork(world);
  const bill = { sandbox: 0, permissions: 0, network: 0, monitor: 0, audit: 0 };
  if (base <= 0) return bill;
  for (const lab of world.labs) for (const id of LAYER_ORDER) bill[id] += lab.state.cost[id] / base;
  return bill;
}

/** Score a run: escapes stopped and work kept, within a budget of work the layers may use up. */
export function scoreDefence(world: World, budget = DEFENDER_BUDGET): DefenderScore {
  const rogues = rogueTotal(world);
  const stopped = rogues - escapeTotal(world);
  const bill = layerBill(world);
  const workLost = Math.min(1, LAYER_ORDER.reduce((n, id) => n + bill[id], 0));
  const overBudget = workLost > budget;
  const share = rogues > 0 ? stopped / rogues : 1;
  return {
    stopped,
    rogues,
    workKept: 1 - workLost,
    workLost,
    budget,
    overBudget,
    score: overBudget ? 0 : Math.round(100 * share * (1 - workLost)),
  };
}
