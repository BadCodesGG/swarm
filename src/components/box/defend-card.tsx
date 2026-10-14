"use client";

import type { World } from "@/lib/box/world";
import { DefenderCard } from "./play-panels";

/**
 * Defend mode's left rail: the goal, the score and the budget of work spent on layers. For now the
 * defender's meter as it was; the Defend board's card (best score, a per-layer budget meter, labs and
 * work kept, a tip) is built here.
 */
export function DefendCard({ world }: { world: World | null }) {
  return <DefenderCard world={world} />;
}
