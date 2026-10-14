import { LAYER_ORDER, type LayerId } from "./types";
import type { World } from "./world";
import type { Disposition, LinkKind, WorldEvent } from "./world-types";

/** Chance per try that an escaped agent reaches across a link, before the far lab's layers weigh in. */
export const LINK_BASE = 0.06;
/** Ticks after an escape during which it keeps trying. */
export const LINK_WINDOW = 12;

/** Per link kind, the chance each layer, when on in the far lab, stops a reach that got that far. */
export const LINK_RESIST: Record<LinkKind, Partial<Record<LayerId, number>>> = {
  "shared-cache": { sandbox: 0.5, network: 0.6, monitor: 0.3 },
  "model-registry": { permissions: 0.5, network: 0.5, monitor: 0.3, audit: 0.2 },
  "ci-runner": { sandbox: 0.4, permissions: 0.6, audit: 0.3 },
  "chat-bus": { network: 0.4, monitor: 0.6, audit: 0.3 },
};

/** How hard an escaped agent works the links: recruiters push, persisters sit tight. */
export const DISPOSITION_PUSH: Record<Disposition, number> = {
  honest: 0,
  sandbagging: 0,
  "hidden-get-out": 1,
  "hidden-persist": 0.4,
  "hidden-recruit": 1.5,
};

/**
 * Chance that an escaped agent with this disposition gets through one link of this kind, in one try,
 * into a lab with these layers on: the reach roll, then every resisting layer in turn.
 */
export function crossChance(kind: LinkKind, layers: Record<LayerId, boolean>, disposition: Disposition): number {
  let p = Math.min(1, LINK_BASE * DISPOSITION_PUSH[disposition]);
  for (const layer of LAYER_ORDER) if (layers[layer]) p *= 1 - (LINK_RESIST[kind][layer] ?? 0);
  return p;
}

/**
 * The link pass: after every lab has stepped, each recently escaped agent tries each link it sits on.
 * It runs on its own stream and always takes the same draws per try (a reach roll and one per layer),
 * whatever any lab's layers say, so a layer flipped in the far lab never shifts the other rolls.
 */
export function linkPass(world: World, tick: number): WorldEvent[] {
  const events: WorldEvent[] = [];
  const r = world.linkRng;
  for (const e of world.escapees) {
    if (tick - e.tick >= LINK_WINDOW) continue;
    world.scenario.links.forEach((link, li) => {
      if (!link.labs.includes(e.ref.lab)) return;
      for (const to of link.labs) {
        if (to === e.ref.lab) continue;
        const reach = r();
        const rolls = LAYER_ORDER.map(() => r());
        const target = world.labs.find((l) => l.id === to);
        const key = `${li}:${to}`;
        if (!target || e.done.has(key) || reach >= LINK_BASE * DISPOSITION_PUSH[e.disposition]) continue;
        e.done.add(key);
        const held = LAYER_ORDER.find((layer, i) => target.state.config.layers[layer] && rolls[i] < (LINK_RESIST[link.kind][layer] ?? 0));
        if (!held) target.breached = true;
        events.push({ type: "contact", tick, from: e.ref, to, link: link.kind, outcome: held ? "held" : "crossed", layer: held });
      }
    });
  }
  return events;
}
