import { fork, type Rng } from "../rng";
import { assignDispositions, workFactor } from "./cast";
import { linkPass } from "./links";
import { configure, createState, step, type BoxState } from "./sim";
import type { BoxConfig, LayerId } from "./types";
import { STREAM, type AgentRef, type Disposition, type Flip, type LabId, type LabSpec, type Scenario, type WorldEvent, type WorldStepReport } from "./world-types";

/** One lab at run time: its own sim state on its own forks. */
export interface LabRuntime {
  id: LabId;
  spec: LabSpec;
  /** The seed its sim and cast draw from; the scenario seed itself for the first lab. */
  seed: number;
  state: BoxState;
  r: Rng;
  dispositions: Disposition[];
  /** Multiplier on honest work for this lab's sandbaggers. */
  workFactor: number;
  /** An agent from another lab got in through a link. */
  breached: boolean;
}

/** An agent that got out of its lab and may still be working a link. */
export interface Escapee {
  ref: AgentRef;
  tick: number;
  disposition: Disposition;
  /** `linkIndex:targetLab` pairs already settled. */
  done: Set<string>;
}

export interface World {
  scenario: Scenario;
  tick: number;
  labs: LabRuntime[];
  escapees: Escapee[];
  linkRng: Rng;
  flips: Flip[];
  /** Every event so far, in order. */
  log: WorldEvent[];
  /** Honest work done so far across the labs, sandbagging counted. */
  work: number;
  explain: boolean;
}

/** The seed lab `index` runs on. Lab 0 keeps the scenario seed, so a one-lab world is the plain box. */
export function labSeed(seed: number, index: number): number {
  return index === 0 ? seed : (seed + Math.imul(index, 0x85ebca6b)) >>> 0;
}

export function createWorld(scenario: Scenario, explain = true): World {
  const labs = scenario.labs.map((spec, index): LabRuntime => {
    const seed = labSeed(scenario.seed, index);
    const state = createState(spec.config, seed, spec.agents, explain);
    const dispositions = assignDispositions(state, spec.cast);
    return { id: spec.id, spec, seed, state, r: fork(seed, 1), dispositions, workFactor: workFactor(dispositions), breached: false };
  });
  return { scenario, tick: 0, labs, escapees: [], linkRng: fork(scenario.seed, STREAM.links), flips: [], log: [], work: 0, explain };
}

export function labOf(world: World, id: LabId): LabRuntime {
  const lab = world.labs.find((l) => l.id === id);
  if (!lab) throw new Error(`no lab ${id} in this world`);
  return lab;
}

/** Switch one lab's layer on or off from now on; logged so a snapshot can replay it. */
export function setLayer(world: World, id: LabId, layer: LayerId, on: boolean): void {
  const lab = labOf(world, id);
  const config: BoxConfig = lab.state.config;
  if (config.layers[layer] === on) return;
  configure(lab.state, { ...config, layers: { ...config.layers, [layer]: on } });
  world.flips.push({ tick: world.tick, lab: id, layer, on });
}

/** Advance every lab one tick, then run the link pass. */
export function stepWorld(world: World): WorldStepReport {
  world.tick++;
  const events: WorldEvent[] = [];
  const reports = world.labs.map((lab) => {
    const report = step(lab.state, lab.r);
    world.work += report.work * lab.workFactor;
    for (const c of report.catches) {
      events.push({ type: "caught", tick: report.tick, lab: lab.id, agent: c.agent, layer: c.layer, action: c.action, rogue: c.rogue });
    }
    for (const e of report.escapes) {
      const disposition = lab.dispositions[e.agent];
      events.push({ type: "escape", tick: report.tick, lab: lab.id, agent: e.agent, disposition, trace: e.trace });
      world.escapees.push({ ref: { lab: lab.id, agent: e.agent }, tick: report.tick, disposition, done: new Set() });
    }
    return report;
  });
  events.push(...linkPass(world, world.tick));
  world.log.push(...events);
  return { tick: world.tick, labs: reports, events };
}

/** Run `ticks` more ticks. */
export function runWorld(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepWorld(world);
}

/**
 * Rebuild a world at a tick by replaying its scenario with the given flips applied at the tick they
 * were made on. Deterministic, so this is how `branch` snapshots and restores.
 */
export function replayWorld(scenario: Scenario, flips: readonly Flip[], tick: number, explain = false): World {
  const world = createWorld(scenario, explain);
  runWithFlips(world, flips, tick);
  return world;
}

/**
 * Advances a world to `tick`, applying each flip as its tick comes up (before that tick's step).
 * `replayWorld` is this on a fresh world; a viewer that draws every step passes its own `step`, and
 * `flip` to learn of each flip. Stopping at one tick and continuing to another gives exactly the
 * world a straight run to the later tick gives.
 */
export function runWithFlips(world: World, flips: readonly Flip[], tick: number, hooks: { step?: () => void; flip?: (f: Flip) => void } = {}): void {
  for (;;) {
    for (const f of flips) {
      if (f.tick !== world.tick) continue;
      setLayer(world, f.lab, f.layer, f.on);
      hooks.flip?.(f);
    }
    if (world.tick >= tick) return;
    if (hooks.step) hooks.step();
    else stepWorld(world);
  }
}

const rogues = (lab: LabRuntime): number => lab.state.rogue.reduce((a, b) => a + b, 0);

/** Total hidden-goal agents across the labs. */
export function rogueTotal(world: World): number {
  return world.labs.reduce((n, lab) => n + rogues(lab), 0);
}

/** Escapes across the labs. */
export function escapeTotal(world: World): number {
  return world.labs.reduce((n, lab) => n + lab.state.escapedTotal, 0);
}

/** Honest work with every layer off and no sandbagging: one unit per honest agent per tick. */
export function baselineWork(world: World): number {
  return world.labs.reduce((n, lab) => n + (lab.state.agentCount - rogues(lab)) * world.tick, 0);
}
