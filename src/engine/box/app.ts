/**
 * Act 2, The Box: `startBox` builds the renderer and the scene once and runs a world of labs from
 * `lib/box` on a fixed 10 Hz decision tick. A world is one lab (the plain Box, drawn as it always
 * was) or several on one map: each lab's shells, its crowd, the links between them as conduits, the
 * escape trails, and numbered markers where each breakout step happened.
 *
 * Each tick `stepWorld` decides, each lab's tally folds its report into what the HUD shows, and the
 * app writes each agent's target and colour; each frame the crowd (GPU compute or the CPU worker)
 * moves the agents toward their targets. Everything that is animated (an escape's run, a crossing's
 * pulse, the camera) is a function of the story tick, the sim tick plus the part of the next that
 * has played, so replaying or scrubbing it never disagrees with itself.
 *
 * The scene is flat and face on, seen through an orthographic camera in scene units (px of the
 * 760x560 design frame for a lone lab). The page reports the scene slot with `setFrame`, and the
 * camera fits its pose in that slot (`view.ts`), so DOM text positioned from `overlay()` sits
 * exactly on what it names.
 *
 * `?shot=escape` runs on the fixed clock: the network layer off, the sim run straight to the tick of
 * the first escape, the crowd snapped to its targets and the escapee parked past the cracked shell.
 * `?shot=breakout` does the same for the breakout preset, to the breach of its second lab.
 */

import { OrthographicCamera, Scene } from "three/webgpu";
import { breakoutSteps } from "@/lib/box/breakout";
import { interceptLines } from "@/lib/box/intercept";
import { configure as configureState, rogueCount, STATUS } from "@/lib/box/sim";
import { LAYER_ORDER, type BoxConfig, type CatchReport, type LayerId, type StepReport, type TrialSummary } from "@/lib/box/types";
import { LINK_WINDOW } from "@/lib/box/links";
import { createWorld, labOf, runWithFlips, setLayer as setWorldLayer, stepWorld, type LabRuntime, type World } from "@/lib/box/world";
import { LAB_NAME, type AgentRef, type BreakoutStep, type Flip, type InterceptLine, type LabId, type LinkKind, type Scenario, type WorldEvent } from "@/lib/box/world-types";
import type { ExperienceApp, StartOptions } from "@/components/experience";
import { createClock, isScripted } from "../shared/clock";
import { registerDebug } from "../shared/debug";
import { EventBus } from "../shared/events";
import { createPost } from "../shared/post";
import { adaptQuality, budgetOptions, maxPixelRatio, qualityOverride, resolveQuality, TIERS } from "../shared/quality";
import { startBoxAudio } from "../audio/box";
import { createRenderer } from "../shared/renderer";
import { activeItem, createDirector, focusPose, mixPose, overviewPose, type Director, type Pose, type StoryItem } from "./camera";
import { createCrowd } from "./crowd";
import { TARGET_STRIDE } from "./crowd/integrate";
import { homes, ringPoint, wander, type EscapePath, type Point } from "./layout";
import type { BoxOverlay, CameraControl, CameraMode, LabView, LinkView, MarkerView, SceneRect } from "./overlay";
import { mountOverlay, type OverlayDom } from "./overlay-dom";
import { loneLab, parseBoxParams, parseWorldParams, SHOT_ESCAPE } from "./params";
import { createAgents } from "./scene/agents";
import { createBackdrop } from "./scene/backdrop";
import { createUniforms, hex } from "./scene/common";
import { createInternet, type Internet } from "./scene/internet";
import { createLinks } from "./scene/links";
import { createMarkers } from "./scene/markers";
import { createPins } from "./scene/pins";
import { createShells, type Shells } from "./scene/shells";
import { HELD_STOP, breachTicks, escapeProgress, markerSlots, markerTick, reachLanded, reachProgress, settledTick } from "./story";
import {
  createTally,
  createWorldTally,
  labStatus,
  labTotals,
  MARKER_TICKS,
  mergeTallies,
  record,
  recordWorld,
  type Marker,
  type Tally,
  type TallyContext,
  type EscapeRecord,
  type LabStatus,
  type WorldLogEntry,
} from "./tally";
import { fitView, pan, project, zoomAbout, type Frame, type View } from "./view";
import { exitHeading, labFrames, linkShapes, outerRadius, pointAlong, routePoints, worldEscapePath, type LabFrame, type LinkShape } from "./world-layout";

export type { Frame } from "./view";

/** Where each escape sub-step sits between the broken outer ring and the trail's far end, as a fraction. */
const BEAT_AT = [0.06, 0.31, 0.56, 0.8] as const;
/** World units each sub-step's button sits off the trail, alternating sides so the four never touch. */
const BEAT_OFF = 40;

export interface BoxEvents {
  tick: StepReport;
  catch: CatchReport;
  escape: { agent: number; tick: number; lab: LabId };
  reset: { seed: number };
  config: BoxConfig;
  trials: TrialSummary;
  /** An escaped agent got into another lab through a link. */
  crossing: { tick: number; from: AgentRef; to: LabId; link: LinkKind };
  /** A reach into another lab was turned away, by `layer` when it is known. */
  held: { tick: number; from: AgentRef; to: LabId; link: LinkKind; layer?: LayerId };
  /** A lab is breached for the first time: an agent got out of it, or one got in. */
  breached: { tick: number; lab: LabId; via: "escape" | "crossing" };
  /** The page selected a numbered step (null clears it). */
  step: { n: number | null };
}

export interface WorldLabSnapshot {
  id: LabId;
  name: string;
  /** The simulation's truth: breached once an agent has got out of it or into it. */
  status: LabStatus;
  held: number;
  config: BoxConfig;
  agents: number;
  rogues: number;
  caught: number;
  escaped: number;
  flagged: number;
}

/** The world as the HUD reads it; a new object whenever `version` moves. */
export interface WorldSnapshot {
  scenario: Scenario;
  tick: number;
  /** The story's clock: where the animation has got to, in ticks. */
  story: number;
  labs: WorldLabSnapshot[];
  links: { index: number; kind: LinkKind; name: string; labs: LabId[] }[];
  /** The numbered breakout steps so far, once their replays have run. */
  steps: BreakoutStep[];
  /** Escapes, crossings, refused reaches and breaches, newest first. */
  log: WorldLogEntry[];
  /** The templated, fictional dialogue the world has produced. */
  intercept: InterceptLine[];
  /** The step the page selected. */
  selected: number | null;
}

/** What the HUD reads; a new object whenever `version` moves. */
export interface BoxSnapshot {
  version: number;
  seed: number;
  /** The first lab's settings: the plain Box's. */
  config: BoxConfig;
  playing: boolean;
  shot: boolean;
  isWebGPU: boolean;
  crowdMode: "gpu" | "cpu";
  /** The counters summed over the labs (a lone lab's own tally), and the latest escape. */
  tally: Readonly<Tally>;
  /** Shells the latest escapee has crossed so far (0 to 5); 5 once it is past the outer one. */
  escapeStage: number;
  world: WorldSnapshot;
}

export interface BoxApp extends ExperienceApp {
  bus: EventBus<BoxEvents>;
  isWebGPU: boolean;
  /** Sets the first lab's settings (the plain Box's switches). */
  configure(config: BoxConfig): void;
  /** Switches one layer of one lab on or off from now on. */
  setLayer(lab: LabId, layer: LayerId, on: boolean): void;
  /** Starts the same world again on a new seed, keeping every lab's current settings. */
  reset(seed: number): void;
  /**
   * Starts a new world from a scenario. With `flips` (a recorded run's layer switches) it replays the
   * world to `tick` (the last flip's tick when not given) with them applied, then runs on live.
   */
  loadScenario(scenario: Scenario, from?: { flips?: readonly Flip[]; tick?: number }): void;
  /**
   * Shows the world as it was at `tick` (0 to the head), rebuilt by deterministic replay with the
   * flip log: the scene, trails, markers, tallies and overlay all show that moment. The run stops
   * advancing while a past moment is shown. `live()` goes back to the head.
   */
  seek(tick: number): void;
  /** Back to the head of the run, as if it had never stopped, and playing again if it was. */
  live(): void;
  /** Every layer switch made so far, in order: the whole log, also while a past moment is shown. */
  flips(): Flip[];
  /**
   * Sets one lab's monitor threshold (0 to 1) or audit budget (0 to 0.2, the share of actions
   * reviewed). The setting holds for the whole run, so the world is re-derived from tick 0 to the
   * moment shown with it (layer switches kept); a past moment stays shown.
   */
  setThreshold(lab: LabId, key: "monitorThreshold" | "auditBudget", value: number): void;
  stats(): BoxSnapshot;
  play(): void;
  pause(): void;
  /** Runs the latest escape's flight again. */
  replayEscape(): void;
  /**
   * Where the scene goes. A `{x, y, w, h}` rect (CSS px of the page) sizes and places the canvas to
   * exactly that rect and renders, fits and projects into it (overlay positions are page positions);
   * null gives the canvas back. The older `{x, y, width, height}` frame only places the map inside
   * a canvas that keeps covering the page.
   */
  setFrame(frame: Frame | SceneRect | null): void;
  /** The map's positions on the canvas, projected through the camera; rebuilt each frame. */
  overlay(): BoxOverlay;
  camera: CameraControl;
  /** Marks a numbered step as the one the page shows (null clears it); the camera stays where it is. */
  selectStep(n: number | null): void;
  /** Shows or hides the engine's own map text and marker buttons (the page may draw its own). */
  showOverlay(visible: boolean): void;
}

/** Seconds per decision tick (10 Hz, Decision 11) and the most ticks one frame may catch up. */
const TICK_S = 0.1;
const MAX_TICKS_PER_FRAME = 5;
/** Pull on a caught agent as it walks to its ring. */
const CAUGHT_GAIN = 0.5;
/** A caught agent's dot fades to this once its marker has gone. */
const CAUGHT_REST_ALPHA = 0.35;
const SHOT_MAX_TICKS = 3000;
/** Agents a world can draw at most; a lone lab draws the tier's crowd. */
const WORLD_CAPACITY = 480;
/** Escape trails kept on the map at once. */
const TRAIL_POOL = 6;
/** A dot's radius on the map, scene units. */
const MAP_DOT = 1.05;
/** Seconds a flight of the camera takes when the visitor sends it somewhere. */
const FLY_S = 0.9;

const PALE = hex(0xd6e4ff);
const PINK = hex(0xff4d7d);

/** One lab as the scene keeps it. */
interface LabScene {
  runtime: LabRuntime;
  frame: LabFrame;
  /** Index of its first agent among all the drawn ones, and how many of its agents are drawn. */
  offset: number;
  count: number;
  home: Float32Array;
  tally: Tally;
  ctx: TallyContext;
  shells: Shells;
}

/** An escape as the map draws it. */
interface EscapeRun {
  lab: LabId;
  agent: number;
  tick: number;
  path: EscapePath;
  record: EscapeRecord | null;
}

export async function startBox(canvas: HTMLCanvasElement, opts: StartOptions): Promise<BoxApp> {
  const params = parseBoxParams(opts.params);
  const worldParams = parseWorldParams(opts.params);
  const shot: "escape" | "breakout" | null = worldParams.shot ?? params.shot;
  const scripted = isScripted(window.location.search) || shot !== null;
  opts.onProgress(0.1, "Starting the renderer");
  const { renderer, isWebGPU } = await createRenderer(canvas, { forceWebGL: opts.forceWebGL });
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const plan = resolveQuality({
    pref: opts.quality,
    isWebGPU,
    coarsePointer: coarse,
    viewportWidth: window.innerWidth,
    override: qualityOverride(opts.params),
    scripted,
  });
  // The escape shot always shows the design's crowd of 2,000, on any backend and width.
  const loneCount = params.shot ? SHOT_ESCAPE.agents : TIERS[plan.level.tier].crowdSize;
  const startScenario = worldParams.scenario ?? loneLab(params.config, params.seed, loneCount);
  const capacity = worldParams.scenario ? Math.max(WORLD_CAPACITY, totalAgents(worldParams.scenario)) : loneCount;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio(plan.level, coarse)));

  opts.onProgress(0.4, "Building the box");
  const scene = new Scene();
  const camera = new OrthographicCamera(-380, 380, 280, -280, -10, 10);
  camera.position.set(0, 0, 5);
  const u = createUniforms();
  const backdrop = createBackdrop(scene, u);
  const crowd = createCrowd({ renderer, isWebGPU, count: capacity, forceCpu: params.forceCpu });
  const agents = createAgents(scene, u, capacity, crowd.positions);
  const markers = createMarkers(scene, u);
  const trails: Internet[] = [];
  const links = createLinks(scene, u);
  const pins = createPins(scene, u);
  const post = createPost(renderer, scene, camera, { bloom: { strength: 0.55, radius: 0.35, threshold: 0.85 }, vignette: 1, grain: 0.018 });
  const bus = new EventBus<BoxEvents>();
  const clock = createClock({ fixed: scripted });
  const audio = startBoxAudio(bus);
  // On "auto" the tier steps down while frames run slow. Only the pixel ratio follows it: the crowd
  // size is fixed for the run, since changing it would restart the simulation in front of the visitor.
  const quality = adaptQuality(plan, budgetOptions(opts.params));
  let lastFrameAt = -1;

  // --- the world ---
  let world!: World;
  /** The scenario as the run began (its thresholds included); a rewound view is rebuilt from it. */
  let baseScenario!: Scenario;
  /** Set while a past moment is shown: the head it will go back to, the flip log, and whether the run was playing. */
  let seeking: { head: number; flips: Flip[]; resume: boolean } | null = null;
  let frames: LabFrame[] = [];
  let labs: LabScene[] = [];
  let map = false;
  let shapes: LinkShape[] = [];
  let worldTally = createWorldTally();
  let storyEvents: WorldEvent[] = [];
  let runs = new Map<number, EscapeRun>();
  let director: Director;
  let steps: BreakoutStep[] = [];
  let stepsDirty = false;
  let stepsPending = false;
  let flipsSeen = 0;
  const targets = new Float32Array(capacity * TARGET_STRIDE);
  const allStatus = new Uint8Array(capacity);
  const caughtAt = new Int32Array(capacity);
  const caughtLayer = new Uint8Array(capacity);
  const baseAlpha = new Float32Array(capacity);
  const scratch: Point = { x: 0, y: 0 };
  for (let i = 0; i < capacity; i++) baseAlpha[i] = 0.45 + ((Math.imul(i + 1, 2654435761) >>> 0) / 4294967296) * 0.35;

  let playing = true;
  let accumulator = 0;
  let elapsed = 0;
  let version = 0;
  let snapshot: BoxSnapshot;
  let escapeStage = 0;
  let selected: number | null = null;

  // --- the story clock and the camera ---
  let story = 0;
  /** Replaying: the story clock runs on its own until it catches up with the sim. */
  let replaying = false;
  /** A shot holds the story at one tick. */
  let frozen: number | null = null;
  let mode: CameraMode = "director";
  let freePose: Pose = { x: 0, y: 0, w: 760, h: 560 };
  let fly: { from: Pose; to: Pose; t0: number } | null = null;
  let reduced = reducedQuery.matches;
  let view: View = fitView({ x: 0, y: 0, width: 1, height: 1 }, freePose);
  /** Beats whose landing has been played on the shells. */
  const landed = new Set<number>();

  const primary = () => labs[0];
  const configOf = (l: LabScene): BoxConfig => l.runtime.state.config;
  const liveTick = () => world.tick + (playing ? accumulator / TICK_S : 0);


  const planOf = (lab: LabId, agent: number) => labOf(world, lab).state.plans[agent] ?? [];

  /** The intercepted dialogue, rebuilt only when the world or its log has moved (the log only grows). */
  let interceptCache: { world: World; n: number; lines: InterceptLine[] } | null = null;
  const intercept = (): InterceptLine[] => {
    if (interceptCache?.world !== world || interceptCache.n !== world.log.length) interceptCache = { world, n: world.log.length, lines: interceptLines(world) };
    return interceptCache.lines;
  };

  const makeSnapshot = (): BoxSnapshot => {
    const merged = mergeTallies(labs.map((l) => l.tally));
    const lone = labs.length === 1;
    const tally = lone ? { ...merged, byLayer: { ...merged.byLayer }, log: [...merged.log], markers: [...merged.markers] } : { ...merged, markers: [] };
    return {
      version: ++version,
      seed: world.scenario.seed,
      config: configOf(primary()),
      playing,
      shot: shot !== null,
      isWebGPU,
      crowdMode: crowd.mode,
      tally,
      escapeStage,
      world: {
        scenario: world.scenario,
        tick: world.tick,
        story,
        labs: labs.map((l) => ({
          id: l.runtime.id,
          name: LAB_NAME[l.runtime.id],
          status: labStatus(worldTally, l.runtime.id),
          held: worldTally.heldContacts[l.runtime.id] ?? 0,
          config: configOf(l),
          agents: l.runtime.spec.agents,
          rogues: l.tally.rogues,
          ...labTotals(l.tally),
        })),
        links: shapes.map((s) => ({ index: s.index, kind: s.kind, name: s.name, labs: s.labs })),
        steps: [...steps],
        log: [...worldTally.log],
        intercept: intercept(),
        selected,
      },
    };
  };
  const touch = () => {
    snapshot = makeSnapshot();
  };

  /** Targets and colours for every drawn agent from the sim's state at the current tick. */
  const writeAgents = () => {
    const style = agents.style;
    allStatus.fill(STATUS.escaped);
    style.fill(0);
    for (const L of labs) {
      const f = L.frame;
      const status = L.runtime.state.status;
      for (let j = 0; j < L.count; j++) {
        const g = L.offset + j;
        const s = status[j];
        const t = g * TARGET_STRIDE;
        allStatus[g] = s;
        if (s === STATUS.caught) {
          const p = ringPoint(LAYER_ORDER[caughtLayer[g]], Math.atan2(L.home[j * 2 + 1], L.home[j * 2]));
          targets[t] = f.x + p.x * 0.985 * f.scale;
          targets[t + 1] = f.y + p.y * 0.985 * f.scale;
          targets[t + 2] = CAUGHT_GAIN;
          const fresh = world.tick - caughtAt[g] < MARKER_TICKS;
          style.set([PINK.r, PINK.g, PINK.b, fresh ? 0.95 : CAUGHT_REST_ALPHA], g * 4);
        } else if (s === STATUS.escaped) {
          targets[t + 2] = 1;
          style[g * 4 + 3] = 0;
        } else {
          wander(L.home[j * 2], L.home[j * 2 + 1], j, world.tick, scratch);
          targets[t] = f.x + scratch.x * f.scale;
          targets[t + 1] = f.y + scratch.y * f.scale;
          targets[t + 2] = 1;
          style.set([PALE.r, PALE.g, PALE.b, baseAlpha[g]], g * 4);
        }
      }
    }
    agents.commit();
    crowd.setTargets(targets, allStatus);
  };

  /** Every lab's catch markers, on the map. */
  const catchMarkers = (): Marker[] =>
    labs.flatMap((L) => L.tally.markers.map((m) => (map ? { ...m, x: L.frame.x + m.x * L.frame.scale, y: L.frame.y + m.y * L.frame.scale } : m)));
  const markerFade = (m: Marker) => Math.sqrt(Math.max(0, 1 - (world.tick - m.tick) / MARKER_TICKS));
  const drawCatchMarkers = () => markers.set(catchMarkers(), markerFade, map ? labs[0].frame.scale : 1);

  const linkIndex = (kind: LinkKind, a: LabId, b: LabId): number => {
    const i = world.scenario.links.findIndex((l) => l.kind === kind && l.labs.includes(a) && l.labs.includes(b));
    return i < 0 ? 0 : i;
  };

  /** The world path of an escape from a lab, laid on the map. */
  const escapeRun = (L: LabScene, e: Extract<WorldEvent, { type: "escape" }>): EscapeRun => {
    const heading = exitHeading(frames, L.frame, e.agent);
    const home = L.ctx.home(e.agent);
    const r = Math.hypot(home.x, home.y);
    const start = { x: Math.cos(heading) * r, y: Math.sin(heading) * r };
    const rec = L.tally.lastEscape;
    return { lab: e.lab, agent: e.agent, tick: e.tick, path: worldEscapePath(frames, L.frame, start, heading), record: rec && rec.agent === e.agent ? rec : null };
  };

  const rebuildDirector = () => {
    director = createDirector(frames, storyEvents);
  };

  const computeSteps = () => {
    steps = breakoutSteps(world.scenario, world.flips, world.tick);
    flipsSeen = world.flips.length;
    stepsDirty = false;
    stepsPending = false;
    snapshot = makeSnapshot();
  };
  const wantSteps = () => {
    stepsDirty = true;
    if (stepsPending || shot !== null) return;
    stepsPending = true;
    // After the frame: the replay behind each step is the slow part of a tick.
    setTimeout(() => {
      if (!disposed && stepsDirty) computeSteps();
      stepsPending = false;
    }, 0);
  };

  const emitReport = (report: StepReport) => {
    bus.emit("tick", report);
    const flashed = new Set<LayerId>();
    for (const c of report.catches) {
      bus.emit("catch", c);
      flashed.add(c.layer);
    }
    return flashed;
  };

  /** One world tick: the sim, every tally, the story's events, and (when `emit`) the bus. */
  const advance = (emit: boolean) => {
    const wr = stepWorld(world);
    const flashed: { lab: LabScene; layers: Set<LayerId> }[] = [];
    wr.labs.forEach((report, i) => {
      const L = labs[i];
      record(L.tally, report, L.ctx);
      for (const c of report.catches) {
        const g = L.offset + c.agent;
        if (c.agent < L.count) {
          caughtAt[g] = report.tick;
          caughtLayer[g] = LAYER_ORDER.indexOf(c.layer);
        }
      }
      if (emit) flashed.push({ lab: L, layers: emitReport(report) });
    });
    const before = worldTally.breached.length;
    recordWorld(worldTally, wr.events, planOf);
    let changed = false;
    for (const e of wr.events) {
      if (e.type === "escape") {
        const L = labs.find((x) => x.runtime.id === e.lab)!;
        runs.set(storyEvents.length, escapeRun(L, e));
        storyEvents.push(e);
        changed = true;
        if (emit) bus.emit("escape", { agent: e.agent, tick: e.tick, lab: e.lab });
      } else if (e.type === "contact") {
        storyEvents.push(e);
        changed = true;
        if (emit) {
          if (e.outcome === "crossed") bus.emit("crossing", { tick: e.tick, from: e.from, to: e.to, link: e.link });
          else bus.emit("held", { tick: e.tick, from: e.from, to: e.to, link: e.link, layer: e.layer });
        }
      }
    }
    if (emit) {
      worldTally.breached.slice(before).forEach((lab) => {
        const via = wr.events.some((e) => e.type === "escape" && e.lab === lab) ? "escape" : "crossing";
        bus.emit("breached", { tick: world.tick, lab, via });
      });
    }
    if (changed) {
      rebuildDirector();
      wantSteps();
    }
    if (world.flips.length !== flipsSeen) wantSteps();
    return flashed;
  };

  const tick = () => {
    const flashed = advance(true);
    for (const { lab, layers } of flashed) for (const l of layers) lab.shells.flash(l);
    writeAgents();
    drawCatchMarkers();
    touch();
  };

  /** Builds the scene for a scenario: the labs' shells, homes and tallies, the links, the trails. */
  const build = (scenario: Scenario) => {
    for (const L of labs) L.shells.dispose();
    for (const t of trails) t.dispose();
    trails.length = 0;
    world = createWorld(scenario);
    baseScenario = scenario;
    seeking = null;
    frames = labFrames(scenario.labs.map((l) => l.id));
    map = frames.length > 1;
    shapes = linkShapes(scenario.links, frames);
    worldTally = createWorldTally();
    storyEvents = [];
    runs = new Map();
    steps = [];
    stepsDirty = false;
    flipsSeen = 0;
    landed.clear();
    selected = null;
    let offset = 0;
    labs = world.labs.map((runtime, i): LabScene => {
      const frame = frames[i];
      const count = Math.max(0, Math.min(runtime.spec.agents, capacity - offset));
      const home = homes(count, runtime.seed);
      const tally = createTally(runtime.spec.agents, rogueCount(runtime.spec.config, runtime.spec.agents));
      const L: LabScene = {
        runtime,
        frame,
        offset,
        count,
        home,
        tally,
        ctx: {
          get config() {
            return L.runtime.state.config;
          },
          plan: (a) => L.runtime.state.plans[a] ?? [],
          home: (a) => ({ x: home[a * 2], y: home[a * 2 + 1] }),
        },
        shells: createShells(scene, u, frame),
      };
      L.shells.setLayers(runtime.spec.config.layers, true);
      L.shells.setBreached(false, true);
      offset += count;
      return L;
    });
    for (let i = 0; i < (map ? TRAIL_POOL : 1); i++) trails.push(createInternet(scene, u, map ? frames[0].scale : 1));
    for (const t of trails) t.set(null, 0);
    caughtAt.fill(0);
    caughtLayer.fill(0);
    agents.setRadius(map ? MAP_DOT : undefined);
    u.grid.value = map ? 1 : 0;
    links.set(shapes);
    accumulator = 0;
    story = 0;
    replaying = false;
    escapeStage = 0;
    rebuildDirector();
    if (mode === "free" && !map) mode = "director";
    writeAgents();
    drawCatchMarkers();
    touch();
  };

  const reset = (nextSeed: number) => {
    const scenario: Scenario = {
      ...world.scenario,
      seed: nextSeed,
      labs: world.scenario.labs.map((spec, i) => ({ ...spec, config: configOf(labs[i]) })),
    };
    build(scenario);
  };

  build(startScenario);

  /** Marks the beats that have already played by the story's tick as landed, so a jump flashes nothing. */
  const markLanded = () => {
    landed.clear();
    for (const item of director.items) if (item.kind !== "escape" && reachLanded(item, story)) landed.add(item.index);
  };

  /** The same labs on a fresh world from `scenario`: no new scene objects, only their state reset. */
  const rewind = (scenario: Scenario) => {
    world = createWorld(scenario);
    baseScenario = scenario;
    labs.forEach((L, i) => {
      L.runtime = world.labs[i];
      L.tally = createTally(L.runtime.spec.agents, rogueCount(L.runtime.spec.config, L.runtime.spec.agents));
      L.shells.setLayers(L.runtime.spec.config.layers, true);
      L.shells.setBreached(false, true);
    });
    for (const t of trails) t.set(null, 0);
    worldTally = createWorldTally();
    storyEvents = [];
    runs = new Map();
    steps = [];
    stepsDirty = false;
    flipsSeen = 0;
    caughtAt.fill(0);
    caughtLayer.fill(0);
    accumulator = 0;
    story = 0;
    replaying = false;
    escapeStage = 0;
    rebuildDirector();
  };

  /** Rewinds, then replays every tick up to `tick` with the flips applied as their ticks come. */
  const replayTo = (tick: number, flips: readonly Flip[]) => {
    rewind(baseScenario);
    runWithFlips(world, flips, tick, {
      step: () => advance(false),
      flip: (f) => {
        const L = labs.find((x) => x.runtime.id === f.lab);
        if (L) L.shells.setLayers(configOf(L).layers, true);
      },
    });
    story = world.tick;
    markLanded();
    writeAgents();
    drawCatchMarkers();
    crowd.snap();
    computeSteps();
  };

  /** Runs the sim without drawing until the shot's moment, then parks the story after it. */
  const runShot = () => {
    opts.onProgress(0.7, shot === "breakout" ? "Running to the breach" : "Running to the escape");
    // The breakout runs on past its first crossing until the link window has closed, so a refused reach shows too.
    const crossedAt = () => storyEvents.find((e) => e.type === "contact" && e.outcome === "crossed")?.tick;
    const reached = () => (shot === "breakout" ? (crossedAt() ?? Infinity) + LINK_WINDOW < world.tick : storyEvents.some((e) => e.type === "escape"));
    while (world.tick < SHOT_MAX_TICKS && !reached()) advance(false);
    playing = false;
    computeSteps();
    const settled = settledTick(director.items);
    // The breakout shot ends pulled back to every lab; the escape shot holds where the escape ended.
    frozen = shot === "breakout" ? settled + 80 : settled;
    writeAgents();
    drawCatchMarkers();
    crowd.snap();
    touch();
  };
  if (shot) runShot();

  // --- framing ---
  let width = 1;
  let height = 1;
  let frame: Frame | null = null;
  /** The page rect the canvas is sized to (null: the canvas keeps covering the page). */
  let rect: SceneRect | null = null;
  let canvasStyle: string | null = null;
  // A canvas with no layout yet (a hidden tab or pane) is not drawn until the observer reports a size.
  let drawable = false;
  const resize = () => {
    drawable = canvas.clientWidth > 0 && canvas.clientHeight > 0;
    width = Math.max(1, canvas.clientWidth);
    height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  /** The scene slot in canvas px. */
  const slot = (): Frame => frame ?? { x: 0, y: 0, width, height };
  /** The canvas's top left on the page: its rect's, or the page's own when it covers it. */
  const origin = (): Point => (rect ? { x: rect.x, y: rect.y } : { x: 0, y: 0 });
  /** The scene slot on the page. */
  const pageSlot = (): Frame => (rect ? { x: rect.x, y: rect.y, width: rect.w, height: rect.h } : slot());
  const setRect = (next: SceneRect | null) => {
    if (next) {
      canvasStyle ??= canvas.getAttribute("style") ?? "";
      rect = { ...next };
      frame = null;
      canvas.style.cssText = `${canvasStyle};position:fixed;left:${next.x}px;top:${next.y}px;right:auto;bottom:auto;width:${next.w}px;height:${next.h}px`;
    } else if (rect) {
      rect = null;
      if (canvasStyle) canvas.setAttribute("style", canvasStyle);
      else canvas.removeAttribute("style");
      canvasStyle = null;
    } else return;
    resize();
  };

  const onReduced = () => {
    reduced = reducedQuery.matches;
  };
  reducedQuery.addEventListener("change", onReduced);

  const poseNow = (): Pose => {
    if (!map) return director.overview;
    if (mode === "free") return freePose;
    return director.pose(story, reduced);
  };

  const frameCamera = (pose: Pose) => {
    view = fitView(slot(), pose);
    camera.left = pose.x - view.cx / view.scale;
    camera.right = pose.x + (width - view.cx) / view.scale;
    camera.top = pose.y + view.cy / view.scale;
    camera.bottom = pose.y - (height - view.cy) / view.scale;
    camera.updateProjectionMatrix();
    u.unitPx.value = view.scale;
    u.viewSize.value.set(width, height);
    u.dpr.value = renderer.getPixelRatio();
  };

  // --- the camera, in the visitor's hands ---
  const takeCamera = () => {
    if (mode === "director") {
      freePose = poseNow();
      mode = "free";
    }
    fly = null;
  };
  const flyTo = (to: Pose) => {
    if (!map) return;
    const from = poseNow();
    mode = "free";
    freePose = from;
    fly = reduced ? null : { from, to, t0: elapsed };
    if (reduced) freePose = to;
  };
  const control: CameraControl = {
    mode: () => mode,
    director() {
      mode = "director";
      fly = null;
    },
    focus(lab) {
      const f = frames.find((x) => x.id === lab);
      if (f) flyTo(focusPose(f));
    },
    overview: () => flyTo(overviewPose(frames)),
  };
  const inSlot = (e: { clientX: number; clientY: number }) => {
    const s = pageSlot();
    return e.clientX >= s.x && e.clientX <= s.x + s.width && e.clientY >= s.y && e.clientY <= s.y + s.height;
  };
  const interactive = (t: EventTarget | null) => t instanceof Element && t.closest("button, a, input, select, textarea, label, summary, dialog, [role='dialog']") !== null;
  let drag: { x: number; y: number } | null = null;
  const onPointerDown = (e: PointerEvent) => {
    if (!map || e.button !== 0 || e.pointerType === "touch" || !inSlot(e) || interactive(e.target)) return;
    takeCamera();
    drag = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag) return;
    freePose = pan(view, e.clientX - drag.x, e.clientY - drag.y);
    drag = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = () => {
    drag = null;
  };
  // A plain wheel scrolls the page (the HUD runs below the scene); Ctrl or Cmd, and a trackpad pinch, zooms the map.
  const onWheel = (e: WheelEvent) => {
    if (!map || !(e.ctrlKey || e.metaKey) || !inSlot(e) || interactive(e.target)) return;
    e.preventDefault();
    takeCamera();
    freePose = zoomAbout(view, { x: e.clientX - origin().x, y: e.clientY - origin().y }, Math.exp(-e.deltaY * 0.0015), director.overview);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Home" && map && !(e.target instanceof Element && e.target.closest("input, textarea, select"))) control.director();
  };
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKey);

  // --- the map's text, markers and screen positions ---
  let overlayDom: OverlayDom | null = null;
  // The camera stays put: the button and its pin light up, the card names the step, and every lab
  // stays in the scene beside it (a flight to the lab cropped the others out of a short slot).
  const selectStep = (n: number | null) => {
    selected = n;
    bus.emit("step", { n });
    touch();
  };
  overlayDom = mountOverlay(canvas, (n) => selectStep(selected === n ? null : n));

  let overlayState: BoxOverlay = emptyOverlay();
  let overlaySig = "";
  const buildOverlay = () => {
    const pose = poseNow();
    const o = origin();
    const proj = (p: Point) => {
      const q = project(view, p);
      return { x: q.x + o.x, y: q.y + o.y };
    };
    const labViews: LabView[] = labs.map((L) => {
      const id = L.runtime.id;
      const at = proj(L.frame);
      const breachedAt = breachTicks(director.items)[id];
      const status: LabStatus = breachedAt !== undefined && story >= breachedAt ? "breached" : "held";
      return {
        id,
        name: LAB_NAME[id],
        status,
        held: worldTally.heldContacts[id] ?? 0,
        layers: { ...configOf(L).layers },
        monitorThreshold: configOf(L).monitorThreshold,
        auditBudget: configOf(L).auditBudget,
        agents: L.runtime.spec.agents,
        ...labTotals(L.tally),
        x: at.x,
        y: at.y,
        r: outerRadius(L.frame) * view.scale,
        wx: L.frame.x,
        wy: L.frame.y,
      };
    });
    const lit = (index: number): "crossed" | "held" | null => {
      const done = director.items.filter((i) => i.kind !== "escape" && i.index >= 0 && contactOf(i)?.index === index && story >= i.end);
      const last = done[done.length - 1];
      return last ? (last.kind === "crossed" ? "crossed" : "held") : null;
    };
    const linkViews: LinkView[] = shapes.map((s) => {
      const at = proj(s.at);
      const paths = s.conduits.map((c) => [0, 4, 8, 12, 16].map((i) => proj(c.points[i])));
      return { index: s.index, kind: s.kind, name: s.name, labs: s.labs, x: at.x, y: at.y, lit: lit(s.index), paths };
    });
    const markerViews: MarkerView[] = markerSlots(director.items).map(({ item, beat }, i) => {
      const w = markerPlace(item, beat);
      const at = proj(w);
      return {
        n: i + 1,
        kind: item.kind === "escape" ? "escape" : item.kind === "held" ? "held" : "crossing",
        lab: item.lab,
        tick: item.tick,
        x: at.x,
        y: at.y,
        wx: w.x,
        wy: w.y,
        shown: story >= markerTick(item, beat ?? 0),
        selected: selected === i + 1,
        step: steps[i] ?? null,
      };
    });
    const latest = [...runs.values()].sort((a, b) => b.tick - a.tick)[0];
    const outside = map && latest ? proj(latest.path.end) : null;
    const act = activeItem(director.items, story);
    const sig = [
      pose.x.toFixed(1),
      pose.y.toFixed(1),
      pose.w.toFixed(1),
      view.cx,
      view.cy,
      mode,
      reduced,
      labViews.map((l) => l.status + l.held).join(),
      linkViews.map((l) => l.lit).join(),
      markerViews.map((m) => `${m.shown}${m.selected}${m.step ? 1 : 0}`).join(),
      outside ? 1 : 0,
      runs.size,
      o.x,
      o.y,
      world.tick,
      seeking ? 1 : 0,
      labViews.map((l) => `${l.caught}.${l.escaped}.${l.flagged}.${l.monitorThreshold}.${l.auditBudget}`).join(),
    ].join("|");
    if (sig !== overlaySig) {
      overlaySig = sig;
      overlayState = {
        version: overlayState.version + 1,
        tick: world.tick,
        story,
        frame: { ...pageSlot() },
        timeline: { at: world.tick, head: seeking ? seeking.head : world.tick, live: seeking === null },
        flips: [...(seeking ? seeking.flips : world.flips)],
        map,
        labs: labViews,
        links: linkViews,
        markers: markerViews,
        camera: { mode, reduced, focus: mode === "director" && act && map ? act.lab : null, pose: { ...pose }, scale: view.scale },
        outside,
        trails: [...runs.values()].filter((r) => story >= r.tick).map((r): [Point, Point] => [proj(r.path.start), proj(r.path.end)]),
      };
    } else {
      overlayState = { ...overlayState, tick: world.tick, story };
    }
  };

  /** The contact event a story beat comes from. */
  const contactOf = (item: StoryItem): { index: number } | null => {
    const e = storyEvents[item.index];
    return e && e.type === "contact" ? { index: linkIndex(e.link, e.from.lab, e.to) } : null;
  };
  /** Where a step's numbered button sits on the map. */
  const markerPlace = (item: StoryItem, beat: number | null = null): Point => {
    if (item.kind === "escape") {
      const run = runs.get(item.index);
      if (!run) return { x: 0, y: 0 };
      // The sub-steps sit one after another on the trail, from the broken outer ring to the far end.
      const c = run.path.crossings[4];
      const b = beat ?? 0;
      const t = BEAT_AT[b];
      const dx = run.path.end.x - c.x;
      const dy = run.path.end.y - c.y;
      const d = Math.hypot(dx, dy) || 1;
      const off = map ? (b % 2 === 0 ? BEAT_OFF : -BEAT_OFF) : 0;
      return { x: c.x + dx * t - (dy / d) * off, y: c.y + dy * t + (dx / d) * off };
    }
    const e = storyEvents[item.index];
    if (!e || e.type !== "contact") return { x: 0, y: 0 };
    const shape = shapes.find((s) => s.index === linkIndex(e.link, e.from.lab, e.to));
    if (!shape) return { x: 0, y: 0 };
    const route = routePoints(shape, e.from.lab, e.to);
    return item.kind === "held" ? pointAlong(route, HELD_STOP) : route[route.length - 1];
  };

  // --- debug ---
  const debug = {
    frame: 0,
    settled: false,
    isWebGPU,
    tier: plan.level.tier,
    shot,
    seed: world.scenario.seed,
    config: configOf(primary()),
    playing,
    crowd: { mode: crowd.mode, count: capacity },
    stats: { tick: 0, caught: 0, escaped: 0, usefulWork: 1, rogues: 0 },
    labs: [] as unknown[],
    links: [] as unknown[],
    steps: [] as unknown[],
    markers: [] as unknown[],
    camera: {} as unknown,
  };
  const unregister = registerDebug("box", debug);
  let debugKey = "";
  const syncDebug = () => {
    const key = `${version}:${overlayState.version}`;
    if (key === debugKey) return;
    debugKey = key;
    const merged = mergeTallies(labs.map((l) => l.tally));
    debug.seed = world.scenario.seed;
    debug.config = configOf(primary());
    debug.playing = playing;
    debug.stats = { tick: merged.tick, caught: merged.caughtTotal, escaped: merged.escaped, usefulWork: merged.usefulWork, rogues: merged.rogues };
    debug.labs = overlayState.labs.map((l) => ({ id: l.id, name: l.name, status: l.status, held: l.held, layers: l.layers, agents: l.agents, x: Math.round(l.x), y: Math.round(l.y), r: Math.round(l.r) }));
    debug.links = overlayState.links.map((l) => ({ index: l.index, kind: l.kind, name: l.name, labs: l.labs, lit: l.lit, x: Math.round(l.x), y: Math.round(l.y) }));
    debug.steps = steps;
    debug.markers = overlayState.markers.map((m) => ({ n: m.n, kind: m.kind, lab: m.lab, tick: m.tick, shown: m.shown, selected: m.selected, x: Math.round(m.x), y: Math.round(m.y), title: m.step?.title ?? null }));
    debug.camera = { mode, reduced, focus: overlayState.camera.focus, pose: overlayState.camera.pose, scale: view.scale };
  };

  // --- the loop ---
  let disposed = false;
  const lastEscapeRun = (): { run: EscapeRun; item: StoryItem } | null => {
    const items = director.items.filter((i) => i.kind === "escape");
    const item = items[items.length - 1];
    const run = item ? runs.get(item.index) : undefined;
    return item && run ? { run, item } : null;
  };

  const drawStory = () => {
    const items = director.items;
    // Trails: the latest escapes, each at its own progress.
    const escapes = items.filter((i) => i.kind === "escape").slice(-trails.length);
    trails.forEach((t, k) => {
      const item = escapes[k];
      const run = item ? runs.get(item.index) : undefined;
      if (!item || !run || story < item.start) t.set(null, 0);
      else t.set(run.path, escapeProgress(item, story));
    });

    // Each lab: breached or holding, and the crack where an agent got out or in.
    const crackOf = new Map<LabId, { angle: number; amount: number }>();
    for (const item of items) {
      if (item.kind === "escape") {
        const run = runs.get(item.index);
        if (!run || story < item.start) continue;
        const f = frames.find((x) => x.id === item.lab)!;
        const c = run.path.crossings[4];
        const e = escapeProgress(item, story) * run.path.escapeeAt;
        const stage = run.path.crossings.filter((x) => e >= x.at).length;
        crackOf.set(item.lab, { angle: Math.atan2(c.y - f.y, c.x - f.x), amount: stage >= 5 ? 1 : 0 });
      } else if (item.kind === "crossed" && reachLanded(item, story)) {
        const e = storyEvents[item.index];
        if (e?.type !== "contact") continue;
        const shape = shapes.find((s) => s.index === linkIndex(e.link, e.from.lab, e.to));
        const f = frames.find((x) => x.id === item.lab);
        if (!shape || !f) continue;
        const route = routePoints(shape, e.from.lab, e.to);
        const end = route[route.length - 1];
        crackOf.set(item.lab, { angle: Math.atan2(end.y - f.y, end.x - f.x), amount: 1 });
      }
    }
    const breachedAt = breachTicks(items);
    for (const L of labs) {
      const id = L.runtime.id;
      const crack = crackOf.get(id);
      L.shells.setCrack(crack?.angle ?? 0, crack?.amount ?? 0);
      if (map) L.shells.setBreached(breachedAt[id] !== undefined && story >= (breachedAt[id] as number));
    }

    // Links: the pulse of each reach, and the path it leaves lit.
    for (const s of shapes) links.light(s.index, null);
    const pulsing = new Set<number>();
    for (const item of items) {
      if (item.kind === "escape") continue;
      const e = storyEvents[item.index];
      if (e?.type !== "contact") continue;
      const index = linkIndex(e.link, e.from.lab, e.to);
      const tone = item.kind === "crossed" ? "crossed" : "held";
      const p = reachProgress(item, story);
      if (p !== null) {
        links.pulse(index, e.from.lab, e.to, p, tone);
        pulsing.add(index);
      }
      if (story >= item.end) links.light(index, tone);
      if (reachLanded(item, story) && !landed.has(item.index)) {
        landed.add(item.index);
        const target = labs.find((x) => x.runtime.id === e.to);
        if (item.kind === "held") target?.shells.refuse(e.layer);
        else target?.shells.flash("audit");
      }
    }
    for (const s of shapes) if (!pulsing.has(s.index)) links.pulse(s.index, s.labs[0], s.labs[1], null, "crossed");

    // Pins under the numbered buttons.
    pins.set(
      markerSlots(items)
        .map(({ item, beat }, i) => ({ item, beat, n: i + 1, at: markerTick(item, beat ?? 0) }))
        .filter(({ at }) => story >= at - 4)
        .map(({ item, beat, n, at }) => {
          const p = markerPlace(item, beat);
          return { x: p.x, y: p.y, tone: item.kind === "held" ? ("held" as const) : ("breach" as const), fade: Math.min(1, (story - at + 4) / 6), selected: selected === n };
        }),
    );

    // The shells the latest escapee has crossed, for the HUD.
    const last = lastEscapeRun();
    if (last) {
      const e = escapeProgress(last.item, story) * last.run.path.escapeeAt;
      const stage = last.run.path.crossings.filter((c) => e >= c.at).length;
      if (stage !== escapeStage) {
        escapeStage = stage;
        touch();
      }
    }
  };

  const loop = () => {
    if (disposed) return;
    const now = performance.now();
    const stepped = lastFrameAt < 0 ? null : quality.frame(now - lastFrameAt);
    lastFrameAt = now;
    if (stepped) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio(stepped, coarse)));
      debug.tier = stepped.tier;
    }
    const dt = clock.tick();
    elapsed += dt;
    u.time.value = elapsed;
    if (playing) {
      accumulator += dt;
      let n = 0;
      while (accumulator >= TICK_S && n < MAX_TICKS_PER_FRAME) {
        accumulator -= TICK_S;
        tick();
        n++;
      }
      if (n === MAX_TICKS_PER_FRAME) accumulator = 0;
    }
    crowd.step(dt);
    agents.sync();
    for (const L of labs) L.shells.update(dt);

    if (frozen !== null && !playing) story = frozen;
    else if (replaying) {
      story += dt / TICK_S;
      if (story >= liveTick()) {
        replaying = false;
        story = liveTick();
      }
    } else {
      frozen = null;
      story = liveTick();
    }
    drawStory();

    if (fly) {
      const k = (elapsed - fly.t0) / FLY_S;
      if (k >= 1) {
        freePose = fly.to;
        fly = null;
      } else {
        freePose = mixPose(fly.from, fly.to, k);
      }
    }
    frameCamera(poseNow());
    buildOverlay();
    overlayDom?.update(overlayState, pageSlot().width < 640 ? 1.25 : 1);
    if (drawable) post.render();
    debug.frame++;
    syncDebug();
    if (shot && debug.frame > 20 && crowd.idle()) debug.settled = true;
  };

  opts.onProgress(1, "Ready");
  await renderer.setAnimationLoop(loop);

  /** Back to the head of the run from a past moment shown. */
  function goLive() {
    if (!seeking) return;
    const { head, flips, resume } = seeking;
    seeking = null;
    replayTo(head, flips);
    frozen = null;
    playing = resume;
    touch();
    syncDebug();
  }

  const app: BoxApp = {
    bus,
    isWebGPU,
    configure(next) {
      goLive();
      const L = primary();
      const current = configOf(L);
      for (const layer of LAYER_ORDER) if (current.layers[layer] !== next.layers[layer]) setWorldLayer(world, L.runtime.id, layer, next.layers[layer]);
      configureState(L.runtime.state, { ...next, layers: { ...configOf(L).layers } });
      L.shells.setLayers(next.layers);
      bus.emit("config", next);
      touch();
      syncDebug();
    },
    setLayer(lab, layer, on) {
      const L = labs.find((x) => x.runtime.id === lab);
      if (!L) return;
      goLive();
      setWorldLayer(world, lab, layer, on);
      L.shells.setLayers(configOf(L).layers);
      if (L === primary()) bus.emit("config", configOf(L));
      touch();
      syncDebug();
    },
    reset(nextSeed) {
      reset(nextSeed);
      syncDebug();
      bus.emit("reset", { seed: nextSeed });
    },
    loadScenario(scenario, from) {
      build(scenario);
      const flips = [...(from?.flips ?? [])].sort((a, b) => a.tick - b.tick);
      const tick = from?.tick ?? flips.reduce((n, f) => Math.max(n, f.tick), 0);
      if (tick > 0 || flips.length > 0) replayTo(tick, flips);
      syncDebug();
      bus.emit("reset", { seed: scenario.seed });
    },
    seek(tick) {
      if (!seeking) seeking = { head: world.tick, flips: [...world.flips], resume: playing };
      const at = Math.max(0, Math.min(seeking.head, Math.round(tick)));
      playing = false;
      replayTo(at, seeking.flips);
      frozen = at;
      story = at;
      touch();
      syncDebug();
    },
    live: goLive,
    flips: () => [...(seeking ? seeking.flips : world.flips)],
    setThreshold(lab, key, value) {
      const i = baseScenario.labs.findIndex((l) => l.id === lab);
      if (i < 0) return;
      const v = Math.min(key === "auditBudget" ? 0.2 : 1, Math.max(0, value));
      const next: Scenario = { ...baseScenario, labs: baseScenario.labs.map((l, k) => (k === i ? { ...l, config: { ...l.config, [key]: v } } : l)) };
      baseScenario = next;
      const flips = seeking ? seeking.flips : [...world.flips];
      replayTo(world.tick, flips);
      if (seeking) {
        frozen = world.tick;
        story = world.tick;
      }
      if (i === 0) bus.emit("config", configOf(primary()));
      touch();
      syncDebug();
    },
    stats: () => snapshot,
    play() {
      if (seeking) seeking.resume = true;
      goLive();
      playing = true;
      touch();
    },
    pause() {
      playing = false;
      touch();
    },
    replayEscape() {
      const last = lastEscapeRun();
      if (!last) return;
      story = Math.max(0, last.item.start - 1);
      frozen = null;
      replaying = true;
      landed.clear();
      touch();
    },
    setFrame(f) {
      if (f && "w" in f) {
        setRect(f);
        return;
      }
      setRect(null);
      frame = f;
    },
    overlay: () => overlayState,
    camera: control,
    selectStep,
    showOverlay(visible) {
      overlayDom?.setVisible(visible);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      setRect(null);
      observer.disconnect();
      reducedQuery.removeEventListener("change", onReduced);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      void renderer.setAnimationLoop(null);
      overlayDom?.dispose();
      unregister();
      audio.dispose();
      bus.clear();
      post.dispose();
      crowd.dispose();
      for (const L of labs) L.shells.dispose();
      for (const t of trails) t.dispose();
      links.dispose();
      for (const m of [pins, markers, agents, backdrop]) m.dispose();
      renderer.dispose();
    },
  };
  // The page's checks reach the app through the debug entry; hidden from its JSON dump.
  Object.defineProperty(debug, "app", { value: app, enumerable: false });
  return app;

  function emptyOverlay(): BoxOverlay {
    return {
      version: 0,
      tick: 0,
      story: 0,
      frame: { x: 0, y: 0, width: 1, height: 1 },
      timeline: { at: 0, head: 0, live: true },
      flips: [],
      map: false,
      labs: [],
      links: [],
      markers: [],
      camera: { mode: "director", reduced: false, focus: null, pose: { x: 0, y: 0, w: 760, h: 560 }, scale: 1 },
      outside: null,
      trails: [],
    };
  }
}

function totalAgents(s: Scenario): number {
  return s.labs.reduce((n, l) => n + l.agents, 0);
}

