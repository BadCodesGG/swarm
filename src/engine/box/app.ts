/**
 * Act 2, The Box: `startBox` builds the renderer and the scene once and runs the containment
 * simulation from `lib/box` on a fixed 10 Hz decision tick. Each tick `step` decides, the tally
 * folds the report into what the HUD shows, and the app writes each agent's target and colour; each
 * frame the crowd (GPU compute or the CPU worker) moves the agents toward their targets.
 *
 * The scene is flat and face on: an orthographic camera maps scene units (px of the 760x560 design
 * frame) onto the page's scene slot, which the HUD reports with `setFrame`, so the DOM labels drawn
 * in an SVG with the same viewBox sit exactly on the shells.
 *
 * `?shot=escape` runs on the fixed clock: the network layer off, the sim run straight to the tick of
 * the first escape, the crowd snapped to its targets and the escapee parked past the cracked shell.
 */

import { OrthographicCamera, Scene } from "three/webgpu";
import { createState, configure as configureState, rogueCount, step, STATUS, type BoxState } from "@/lib/box/sim";
import { LAYER_ORDER, type BoxConfig, type CatchReport, type LayerId, type StepReport, type TrialSummary } from "@/lib/box/types";
import type { Rng } from "@/lib/rng";
import type { ExperienceApp, StartOptions } from "@/components/experience";
import { createClock, isScripted } from "../shared/clock";
import { registerDebug } from "../shared/debug";
import { EventBus } from "../shared/events";
import { createPost } from "../shared/post";
import { adaptQuality, budgetOptions, maxPixelRatio, qualityOverride, resolveQuality, TIERS } from "../shared/quality";
import { startBoxAudio } from "../audio/box";
import { createRenderer } from "../shared/renderer";
import { createCrowd } from "./crowd";
import { TARGET_STRIDE } from "./crowd/integrate";
import { homes, ringPoint, wander, type Point } from "./layout";
import { parseBoxParams, runToEscape, SHOT_ESCAPE, simRng } from "./params";
import { createAgents } from "./scene/agents";
import { createBackdrop } from "./scene/backdrop";
import { createUniforms, hex } from "./scene/common";
import { createInternet } from "./scene/internet";
import { createMarkers } from "./scene/markers";
import { createShells } from "./scene/shells";
import { createTally, MARKER_TICKS, record, type Marker, type Tally, type TallyContext } from "./tally";

export interface BoxEvents {
  tick: StepReport;
  catch: CatchReport;
  escape: { agent: number; tick: number };
  reset: { seed: number };
  config: BoxConfig;
  trials: TrialSummary;
}

/** What the HUD reads; a new object whenever `version` moves. */
export interface BoxSnapshot {
  version: number;
  seed: number;
  config: BoxConfig;
  playing: boolean;
  shot: boolean;
  isWebGPU: boolean;
  crowdMode: "gpu" | "cpu";
  tally: Readonly<Tally>;
  /** Shells the latest escapee has crossed so far (0 to 5); 5 once it is past the outer one. */
  escapeStage: number;
}

/** The scene slot, CSS px from the canvas's top left. */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoxApp extends ExperienceApp {
  bus: EventBus<BoxEvents>;
  isWebGPU: boolean;
  configure(config: BoxConfig): void;
  reset(seed: number): void;
  stats(): BoxSnapshot;
  play(): void;
  pause(): void;
  /** Runs the latest escape's flight again. */
  replayEscape(): void;
  setFrame(frame: Frame): void;
}

/** Seconds per decision tick (10 Hz, Decision 11) and the most ticks one frame may catch up. */
const TICK_S = 0.1;
const MAX_TICKS_PER_FRAME = 5;
/** Seconds the escapee takes from the crowd to its parking spot. */
const ESCAPE_S = 2.6;
/** Pull on a caught agent as it walks to its ring. */
const CAUGHT_GAIN = 0.5;
/** A caught agent's dot fades to this once its marker has gone. */
const CAUGHT_REST_ALPHA = 0.35;
const SHOT_MAX_TICKS = 3000;

const PALE = hex(0xd6e4ff);
const PINK = hex(0xff4d7d);

const easeOut = (t: number) => 1 - (1 - t) ** 3;

export async function startBox(canvas: HTMLCanvasElement, opts: StartOptions): Promise<BoxApp> {
  const params = parseBoxParams(opts.params);
  const scripted = isScripted(window.location.search) || params.shot !== null;
  opts.onProgress(0.1, "Starting the renderer");
  const { renderer, isWebGPU } = await createRenderer(canvas, { forceWebGL: opts.forceWebGL });
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const plan = resolveQuality({
    pref: opts.quality,
    isWebGPU,
    coarsePointer: coarse,
    viewportWidth: window.innerWidth,
    override: qualityOverride(opts.params),
    scripted,
  });
  // The shot always shows the design's crowd of 2,000, on any backend and width.
  const count = params.shot ? SHOT_ESCAPE.agents : TIERS[plan.level.tier].crowdSize;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio(plan.level, coarse)));

  opts.onProgress(0.4, "Building the box");
  const scene = new Scene();
  const camera = new OrthographicCamera(-380, 380, 280, -280, -10, 10);
  camera.position.set(0, 0, 5);
  const u = createUniforms();
  const backdrop = createBackdrop(scene, u);
  const shells = createShells(scene, u);
  const crowd = createCrowd({ renderer, isWebGPU, count, forceCpu: params.forceCpu });
  const agents = createAgents(scene, u, count, crowd.positions);
  const markers = createMarkers(scene, u);
  const internet = createInternet(scene, u);
  const post = createPost(renderer, scene, camera, { bloom: { strength: 0.55, radius: 0.35, threshold: 0.85 }, vignette: 1, grain: 0.018 });
  const bus = new EventBus<BoxEvents>();
  const clock = createClock({ fixed: scripted });
  const audio = startBoxAudio(bus);
  // On "auto" the tier steps down while frames run slow. Only the pixel ratio follows it: the crowd
  // size is fixed for the run, since changing it would restart the simulation in front of the visitor.
  const quality = adaptQuality(plan, budgetOptions(opts.params));
  let lastFrameAt = -1;

  // --- simulation state ---
  let config: BoxConfig = params.config;
  let seed = params.seed;
  let state: BoxState;
  let r: Rng;
  let tally: Tally;
  let home: Float32Array;
  const targets = new Float32Array(count * TARGET_STRIDE);
  const caughtAt = new Int32Array(count);
  const caughtLayer = new Uint8Array(count);
  const baseAlpha = new Float32Array(count);
  const scratch: Point = { x: 0, y: 0 };
  const ctx: TallyContext = {
    get config() {
      return config;
    },
    plan: (i) => state.plans[i] ?? [],
    home: (i) => ({ x: home[i * 2], y: home[i * 2 + 1] }),
  };

  let playing = true;
  let accumulator = 0;
  let elapsed = 0;
  let escapeStart = -Infinity;
  let escapeTick = -1;
  let escapeStage = 0;
  let version = 0;
  let snapshot: BoxSnapshot;

  const makeSnapshot = (): BoxSnapshot => ({
    version: ++version,
    seed,
    config,
    playing,
    shot: params.shot !== null,
    isWebGPU,
    crowdMode: crowd.mode,
    tally: { ...tally, byLayer: { ...tally.byLayer }, log: [...tally.log], markers: [...tally.markers] },
    escapeStage,
  });
  const touch = () => {
    snapshot = makeSnapshot();
  };

  /** Targets and colours for every agent from the sim's state at the current tick. */
  const writeAgents = () => {
    const style = agents.style;
    for (let i = 0; i < count; i++) {
      const s = state.status[i];
      const t = i * TARGET_STRIDE;
      if (s === STATUS.caught) {
        const p = ringPoint(LAYER_ORDER[caughtLayer[i]], Math.atan2(home[i * 2 + 1], home[i * 2]));
        targets[t] = p.x * 0.985;
        targets[t + 1] = p.y * 0.985;
        targets[t + 2] = CAUGHT_GAIN;
        const fresh = state.tick - caughtAt[i] < MARKER_TICKS;
        style.set([PINK.r, PINK.g, PINK.b, fresh ? 0.95 : CAUGHT_REST_ALPHA], i * 4);
      } else if (s === STATUS.escaped) {
        targets[t + 2] = 1;
        style[i * 4 + 3] = 0;
      } else {
        wander(home[i * 2], home[i * 2 + 1], i, state.tick, scratch);
        targets[t] = scratch.x;
        targets[t + 1] = scratch.y;
        targets[t + 2] = 1;
        style.set([PALE.r, PALE.g, PALE.b, baseAlpha[i]], i * 4);
      }
    }
    agents.commit();
    crowd.setTargets(targets, state.status);
  };

  const markerFade = (m: Marker) => Math.sqrt(Math.max(0, 1 - (tally.tick - m.tick) / MARKER_TICKS));

  const onReport = (report: StepReport) => {
    record(tally, report, ctx);
    for (const c of report.catches) {
      caughtAt[c.agent] = report.tick;
      caughtLayer[c.agent] = LAYER_ORDER.indexOf(c.layer);
    }
  };

  const emitReport = (report: StepReport) => {
    bus.emit("tick", report);
    const flashed = new Set<LayerId>();
    for (const c of report.catches) {
      bus.emit("catch", c);
      flashed.add(c.layer);
    }
    for (const l of flashed) shells.flash(l);
    for (const e of report.escapes) bus.emit("escape", { agent: e.agent, tick: report.tick });
  };

  const startEscape = (at: number) => {
    escapeStart = at;
    escapeTick = tally.lastEscape?.tick ?? -1;
    escapeStage = 0;
    shells.setCrack(0, 0);
  };

  const tick = () => {
    const report = step(state, r);
    onReport(report);
    emitReport(report);
    if (tally.lastEscape && tally.lastEscape.tick !== escapeTick) startEscape(elapsed);
    writeAgents();
    markers.set(tally.markers, markerFade);
    touch();
  };

  const reset = (nextSeed: number) => {
    seed = nextSeed;
    state = createState(config, seed, count);
    r = simRng(seed);
    tally = createTally(count, rogueCount(config, count));
    home = homes(count, seed);
    caughtAt.fill(0);
    caughtLayer.fill(0);
    for (let i = 0; i < count; i++) baseAlpha[i] = 0.45 + ((Math.imul(i + 1, 2654435761) >>> 0) / 4294967296) * 0.35;
    accumulator = 0;
    escapeStart = -Infinity;
    escapeTick = -1;
    escapeStage = 0;
    shells.setCrack(0, 0);
    internet.set(null, 0);
    writeAgents();
    markers.set([], markerFade);
    touch();
  };

  reset(seed);
  shells.setLayers(config.layers, true);

  if (params.shot) {
    opts.onProgress(0.7, "Running to the escape");
    runToEscape(state!, r!, SHOT_MAX_TICKS, onReport);
    playing = false;
    writeAgents();
    markers.set(tally!.markers, markerFade);
    crowd.snap();
    if (tally!.lastEscape) {
      escapeTick = tally!.lastEscape.tick;
      escapeStart = -Infinity;
    }
    touch();
  }

  // --- framing ---
  let width = 1;
  let height = 1;
  let frame: Frame | null = null;
  const resize = () => {
    width = Math.max(1, canvas.clientWidth);
    height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  const frameCamera = () => {
    const f = frame ?? { x: 0, y: 0, width, height };
    const scale = Math.max(0.05, Math.min(f.width / 760, f.height / 560));
    const cx = f.x + f.width / 2;
    const cy = f.y + f.height / 2;
    camera.left = -cx / scale;
    camera.right = (width - cx) / scale;
    camera.top = cy / scale;
    camera.bottom = (cy - height) / scale;
    camera.updateProjectionMatrix();
    u.unitPx.value = scale;
    u.viewSize.value.set(width, height);
    u.dpr.value = renderer.getPixelRatio();
  };

  // --- debug ---
  const debug = {
    frame: 0,
    settled: false,
    isWebGPU,
    tier: plan.level.tier,
    shot: params.shot,
    seed,
    config,
    playing,
    crowd: { mode: crowd.mode, count },
    stats: { tick: 0, caught: 0, escaped: 0, usefulWork: 1, rogues: 0 },
  };
  const unregister = registerDebug("box", debug);
  const syncDebug = () => {
    debug.seed = seed;
    debug.config = config;
    debug.playing = playing;
    debug.stats = { tick: tally.tick, caught: tally.caughtTotal, escaped: tally.escaped, usefulWork: tally.usefulWork, rogues: tally.rogues };
  };

  let disposed = false;
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
    shells.update(dt);

    const esc = tally.lastEscape;
    if (esc) {
      const progress = params.shot && escapeStart === -Infinity ? 1 : easeOut(Math.min(1, (elapsed - escapeStart) / ESCAPE_S));
      internet.set(esc.path, progress);
      const e = progress * esc.path.escapeeAt;
      const stage = esc.path.crossings.filter((c) => e >= c.at).length;
      shells.setCrack(Math.atan2(esc.path.crossings[4].y, esc.path.crossings[4].x), stage >= 5 ? 1 : 0);
      if (stage !== escapeStage) {
        escapeStage = stage;
        touch();
      }
    }

    frameCamera();
    post.render();
    debug.frame++;
    syncDebug();
    if (params.shot && debug.frame > 20 && crowd.idle()) debug.settled = true;
  };

  opts.onProgress(1, "Ready");
  await renderer.setAnimationLoop(loop);

  return {
    bus,
    isWebGPU,
    configure(next) {
      config = next;
      configureState(state, next);
      shells.setLayers(next.layers);
      bus.emit("config", next);
      touch();
      syncDebug();
    },
    reset(nextSeed) {
      reset(nextSeed);
      syncDebug();
      bus.emit("reset", { seed: nextSeed });
    },
    stats: () => snapshot,
    play() {
      playing = true;
      touch();
    },
    pause() {
      playing = false;
      touch();
    },
    replayEscape() {
      if (tally.lastEscape) startEscape(elapsed);
      touch();
    },
    setFrame(f) {
      frame = f;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      void renderer.setAnimationLoop(null);
      unregister();
      audio.dispose();
      bus.clear();
      post.dispose();
      crowd.dispose();
      for (const m of [internet, markers, agents, shells, backdrop]) m.dispose();
      renderer.dispose();
    },
  };
}

