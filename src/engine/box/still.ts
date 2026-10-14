/**
 * The Box under reduced motion (or with no WebGPU and no WebGL 2): a `BoxApp` with no renderer and
 * no three. The scene slot shows a still frame of the escape, drawn on a 2D canvas, while the HUD
 * stays live: the layer switches configure, and "Run 100 trials" runs and plots off the main
 * thread exactly as in the live scene. Play is a request for motion, so it enters the live scene.
 */

import { breakoutSteps } from "@/lib/box/breakout";
import { interceptLines } from "@/lib/box/intercept";
import { rogueCount } from "@/lib/box/sim";
import type { BoxConfig } from "@/lib/box/types";
import { createWorld, labOf, stepWorld, type World } from "@/lib/box/world";
import { LAB_NAME, type Scenario } from "@/lib/box/world-types";
import { startBoxAudio } from "../audio/box";
import { registerDebug } from "../shared/debug";
import { EventBus } from "../shared/events";
import { TIERS } from "../shared/quality";
import type { BoxApp, BoxEvents, BoxSnapshot, Frame, WorldSnapshot } from "./app";
import type { BoxOverlay } from "./overlay";
import { loneLab, parseBoxParams, parseWorldParams, SHOT_CONFIG } from "./params";
import { createTally, createWorldTally, labStatus, recordWorld, type Tally } from "./tally";
import { labFrames, linkShapes } from "./world-layout";

/** The design frame every Box scene is laid out in, scene px. */
export const DESIGN = { width: 760, height: 560 } as const;

/** Where the 760x560 design frame lands inside `frame`: centred, as large as fits (the live camera's fit). */
export function fitDesign(frame: Frame): Frame {
  const scale = Math.max(0, Math.min(frame.width / DESIGN.width, frame.height / DESIGN.height));
  const width = DESIGN.width * scale;
  const height = DESIGN.height * scale;
  return { x: frame.x + (frame.width - width) / 2, y: frame.y + (frame.height - height) / 2, width, height };
}

export interface StillBoxOptions {
  params: URLSearchParams;
  /** Leave the still for the live scene. */
  enter(): void;
  /** Draws the still into the scene slot, or clears it (null). */
  paint(frame: Frame | null): void;
}

/** Where the world still lives: the breakout, run to the breach of its second lab, drawn by `scripts/stills.mjs`. */
export const WORLD_STILL = "/stills/box-world.jpg";
const WORLD_STILL_MAX_TICKS = 3000;

/** A scenario run to the first crossing (or its cap), for the numbers the still's HUD shows. */
function ranWorld(scenario: Scenario): World {
  const w = createWorld(scenario, false);
  while (w.tick < WORLD_STILL_MAX_TICKS && !w.log.some((e) => e.type === "contact" && e.outcome === "crossed")) stepWorld(w);
  return w;
}

const emptyOverlay = (): BoxOverlay => ({
  version: 0,
  tick: 0,
  story: 0,
  frame: { x: 0, y: 0, width: 1, height: 1 },
  map: false,
  labs: [],
  links: [],
  markers: [],
  camera: { mode: "director", reduced: true, focus: null, pose: { x: 0, y: 0, w: DESIGN.width, h: DESIGN.height }, scale: 1 },
  outside: null,
});

/** The DOM-free part of the still Box: state, snapshot, bus and debug entry. */
export function createStillBox({ params, enter, paint }: StillBoxOptions): BoxApp {
  const parsed = parseBoxParams(params);
  // The trials never use the crowd size; the counters only need a plausible one.
  const count = TIERS.lite.crowdSize;
  const bus = new EventBus<BoxEvents>();
  const audio = startBoxAudio(bus);
  // The still is the escape shot (or the breakout, when the page asks for a world), so the HUD over
  // it starts on that shot's settings.
  let scenario: Scenario | null = parseWorldParams(params).scenario;
  let config: BoxConfig = scenario ? scenario.labs[0].config : SHOT_CONFIG;
  let seed = scenario ? scenario.seed : parsed.seed;
  const agentsOf = () => (scenario ? scenario.labs[0].agents : count);
  let tally: Tally = createTally(agentsOf(), rogueCount(config, agentsOf()));
  let ran: World | null = scenario ? ranWorld(scenario) : null;
  let selected: number | null = null;
  let version = 0;
  let trials = 0;
  const offTrials = bus.on("trials", () => {
    trials++;
    debug.trials = trials;
  });

  const worldSnapshot = (): WorldSnapshot => {
    const sc = scenario ?? loneLab(config, seed, count);
    const w = ran;
    const wt = createWorldTally();
    if (w) recordWorld(wt, w.log, (lab, agent) => labOf(w, lab).state.plans[agent] ?? []);
    return {
      scenario: sc,
      tick: w?.tick ?? 0,
      story: w?.tick ?? 0,
      labs: sc.labs.map((spec, i) => ({
        id: spec.id,
        name: LAB_NAME[spec.id],
        status: labStatus(wt, spec.id),
        held: wt.heldContacts[spec.id] ?? 0,
        config: i === 0 ? config : spec.config,
        agents: spec.agents,
        rogues: rogueCount(spec.config, spec.agents),
        caught: 0,
        escaped: 0,
      })),
      links: linkShapes(sc.links, labFrames(sc.labs.map((l) => l.id))).map((s) => ({ index: s.index, kind: s.kind, name: s.name, labs: s.labs })),
      steps: w ? breakoutSteps(sc, [], w.tick) : [],
      log: wt.log,
      intercept: w ? interceptLines(w) : [],
      selected,
    };
  };

  const make = (): BoxSnapshot => ({
    version: ++version,
    seed,
    config,
    playing: false,
    shot: false,
    isWebGPU: false,
    crowdMode: "cpu",
    tally,
    escapeStage: 0,
    world: worldSnapshot(),
  });
  let snapshot = make();

  const debug = {
    still: true,
    settled: true,
    seed,
    config,
    trials,
    labs: [] as unknown[],
    links: [] as unknown[],
    steps: snapshot.world.steps as unknown[],
    markers: [] as unknown[],
    camera: { mode: "director", reduced: true } as unknown,
  };
  const unregister = registerDebug("box", debug);
  const refresh = () => {
    snapshot = make();
    debug.steps = snapshot.world.steps;
  };

  const app: BoxApp = {
    bus,
    isWebGPU: false,
    configure(next) {
      config = next;
      debug.config = next;
      refresh();
      bus.emit("config", next);
    },
    setLayer(lab, layer, on) {
      if (!scenario) {
        if (lab === "meridian") app.configure({ ...config, layers: { ...config.layers, [layer]: on } });
        return;
      }
      scenario = { ...scenario, labs: scenario.labs.map((spec) => (spec.id === lab ? { ...spec, config: { ...spec.config, layers: { ...spec.config.layers, [layer]: on } } } : spec)) };
      if (scenario.labs[0].id === lab) app.configure(scenario.labs[0].config);
      else refresh();
    },
    reset(next) {
      seed = next;
      debug.seed = next;
      tally = createTally(agentsOf(), rogueCount(config, agentsOf()));
      if (scenario) {
        scenario = { ...scenario, seed: next };
        ran = ranWorld(scenario);
      }
      refresh();
      bus.emit("reset", { seed: next });
    },
    loadScenario(next) {
      scenario = next;
      config = next.labs[0].config;
      seed = next.seed;
      ran = ranWorld(next);
      refresh();
      bus.emit("reset", { seed: next.seed });
    },
    stats: () => snapshot,
    play: enter,
    pause() {},
    replayEscape() {},
    setFrame: (frame) => paint(frame),
    overlay: emptyOverlay,
    camera: { mode: () => "director", director() {}, focus() {}, overview() {} },
    selectStep(n) {
      selected = n;
      refresh();
      bus.emit("step", { n });
    },
    showOverlay() {},
    dispose() {
      offTrials();
      unregister();
      audio.dispose();
      bus.clear();
      paint(null);
    },
  };
  return app;
}

/** Share of each side faded out, so the still's own backdrop melts into the page instead of showing as a box. */
const FEATHER = 0.03;

/** Fades the drawn rectangle's edges to transparent; the outermost shell sits just inside the margin. */
function feather(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.save();
  g.globalCompositeOperation = "destination-out";
  const edges: [number, number, number, number, number, number, number, number][] = [
    [x, y, x + w * FEATHER, y, x, y, w * FEATHER, h],
    [x + w, y, x + w * (1 - FEATHER), y, x + w * (1 - FEATHER), y, w * FEATHER, h],
    [x, y, x, y + h * FEATHER, x, y, w, h * FEATHER],
    [x, y + h, x, y + h * (1 - FEATHER), x, y + h * (1 - FEATHER), w, h * FEATHER],
  ];
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of edges) {
    const grad = g.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(rx, ry, rw, rh);
  }
  g.restore();
}

/** Loads the still and draws it into whatever scene slot the HUD reports, at device resolution. */
export async function startBoxStill(canvas: HTMLCanvasElement, { src, params, enter }: { src: string; params: URLSearchParams; enter(): void }): Promise<BoxApp> {
  // A world (a preset or a shared scenario) has its own still: three labs, not one box.
  const image = new Image();
  image.src = parseWorldParams(params).scenario ? WORLD_STILL : src;
  // A missing still leaves the slot empty; the controls and the trials still work.
  const loaded = await image.decode().then(
    () => true,
    () => false,
  );
  const g = canvas.getContext("2d");
  let frame: Frame | null = null;
  const draw = () => {
    if (!g) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    g.clearRect(0, 0, w, h);
    if (!frame || !loaded) return;
    const r = fitDesign(frame);
    g.drawImage(image, r.x * dpr, r.y * dpr, r.width * dpr, r.height * dpr);
    feather(g, r.x * dpr, r.y * dpr, r.width * dpr, r.height * dpr);
  };
  const observer = new ResizeObserver(draw);
  observer.observe(canvas);
  const app = createStillBox({
    params,
    enter,
    paint(next) {
      if (next && frame && next.x === frame.x && next.y === frame.y && next.width === frame.width && next.height === frame.height) return;
      frame = next;
      draw();
    },
  });
  const dispose = app.dispose;
  app.dispose = () => {
    observer.disconnect();
    dispose();
  };
  return app;
}
