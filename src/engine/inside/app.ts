/**
 * Act 1, Inside: `startInside` builds the renderer and the scene once and plays a `SessionTrace`.
 * Each frame the scene is a pure function of `(trace, t, rate)`: poses from `agentPose`, streaks
 * baked by `makeFlight` into the time-indexed particle ring, station activity and web probes from
 * their pure tables. `setTrace` swaps the source without rebuilding the renderer.
 *
 * `?shot=hero` runs the fixed-step clock, holds the clock paused at `t`, and selects a featured
 * subagent, so `scripts/shot.mjs` gets the same frame every time.
 */

import { Group, PerspectiveCamera, Scene, Vector3 } from "three/webgpu";
import { generateTrace } from "@/lib/trace/generate";
import { buildTimeline, type Timeline } from "@/lib/trace/timeline";
import type { SessionTrace, ToolCategory } from "@/lib/trace/types";
import type { ExperienceApp, StartOptions } from "@/components/experience";
import { createClock } from "../shared/clock";
import { registerDebug } from "../shared/debug";
import { EventBus } from "../shared/events";
import { createPost } from "../shared/post";
import { maxPixelRatio, resolveQuality, TIERS } from "../shared/quality";
import { createRenderer } from "../shared/renderer";
import {
  BOUNDARY_RADIUS,
  featuredAgent,
  makeFlight,
  STATION_RADIUS,
  STATIONS,
  stationActivity,
  stationAngle,
  stationCounts,
  webProbes,
  type StationCategory,
  type WebProbe,
} from "./layout";
import { parseInsideParams } from "./params";
import { createPlayback } from "./playback";
import { createAgents } from "./scene/agents";
import { createBackdrop } from "./scene/backdrop";
import { createBoundary } from "./scene/boundary";
import { createUniforms } from "./scene/common";
import { createCore } from "./scene/core";
import { createParticles } from "./scene/particles";
import { createPulses } from "./scene/pulses";
import { createStations } from "./scene/stations";
import { createTethers } from "./scene/tethers";

export interface InsideEvents {
  spawn: { agent: number; parent: number };
  return: { agent: number };
  call: { agent: number; category: ToolCategory };
  web: { agent: number; tool: string };
  prompt: { excerpt: string };
  trace: { trace: SessionTrace };
}

export interface StationLabel {
  key: StationCategory;
  x: number;
  y: number;
  /** Text anchor as a fraction of the label box: 0 left/top, 1 right/bottom. */
  ax: number;
  ay: number;
  count: number;
  active: boolean;
}

export interface ProbeLabel {
  id: number;
  x: number;
  y: number;
  tool: string;
  query: string;
}

/** Screen positions (CSS px) and text the DOM overlay draws over the canvas. */
export interface InsideOverlay {
  version: number;
  /** Screen px per design px (1 at the 1440x900 hero framing). */
  scale: number;
  /** Viewport width, CSS px. */
  width: number;
  core: { x: number; y: number };
  boundary: { x: number; y: number };
  stations: StationLabel[];
  probes: ProbeLabel[];
}

export interface InsideApp extends ExperienceApp {
  bus: EventBus<InsideEvents>;
  isWebGPU: boolean;
  timeline(): Timeline;
  setTrace(trace: SessionTrace): void;
  play(): void;
  pause(): void;
  seek(t: number): void;
  setRate(rate: number): void;
  time(): number;
  rate(): number;
  playing(): boolean;
  /** The agent or particle under a screen point; picking lands with the HUD. */
  pick(x: number, y: number): null;
  selected(): number;
  overlay(): InsideOverlay;
}

const FOV = 36;
/** Design framing: 100 px per world unit on a 900 px tall window, the core 20 px above centre. */
const DESIGN_HEIGHT_UNITS = 9;
const CORE_LIFT = 0.2;
/** The swarm plane tips back a little, so it reads as 3D without hiding the ring. */
const TILT_X = -0.3;
const TILT_Y = 0.06;
/** Radians the web label turns clockwise off its station's direction, clear of the probes. */
const WEB_LABEL_TURN = 1.05;
/** World units from a station's centre to its label's anchor. */
const LABEL_GAP = 0.2;

export async function startInside(canvas: HTMLCanvasElement, opts: StartOptions): Promise<InsideApp> {
  const params = parseInsideParams(opts.params);
  opts.onProgress(0.1, "Starting the renderer");
  const { renderer, isWebGPU } = await createRenderer(canvas, { forceWebGL: opts.forceWebGL });
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const plan = resolveQuality({
    pref: opts.quality,
    isWebGPU,
    coarsePointer: coarse,
    viewportWidth: window.innerWidth,
    scripted: params.shot,
  });
  const tier = TIERS[plan.level.tier];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio(plan.level, coarse)));

  opts.onProgress(0.4, "Building the scene");
  const scene = new Scene();
  const swarm = new Group();
  swarm.rotation.set(TILT_X, TILT_Y, 0);
  scene.add(swarm);
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 200);
  const u = createUniforms();

  const backdrop = createBackdrop(scene);
  const boundary = createBoundary(scene, swarm, u);
  const stations = createStations(swarm, u);
  const tethers = createTethers(swarm, u, 64);
  const particles = createParticles(swarm, u, tier.particleCap);
  const core = createCore(swarm);
  const agents = createAgents(swarm, 64);
  const pulses = createPulses(scene, u);
  const post = createPost(renderer, scene, camera, {
    bloom: { strength: isWebGPU ? 0.75 : 0.6, radius: 0.55, threshold: 0.82 },
    vignette: 0.7,
    grain: 0.022,
  });

  const bus = new EventBus<InsideEvents>();
  const clock = createClock({ fixed: params.shot });

  let trace!: SessionTrace;
  let timeline!: Timeline;
  let counts!: ReturnType<typeof stationCounts>;
  let activity!: ReturnType<typeof stationActivity>;
  let probes!: WebProbe[];
  let promptTimes: number[] = [];
  const playback = createPlayback({ duration: 0, toPlayback: (x) => x, toTrace: (x) => x }, { rate: params.rate });
  let selected = -1;
  /** Index of the first event not yet emitted, for appending while playing. */
  let cursor = 0;
  let lastT = -1;
  let lastRate = -1;

  const rebuildParticles = (t: number) => {
    particles.reset();
    const [lo, hi] = timeline.visibleAt(t, playback.rate());
    for (let i = lo; i < hi; i++) {
      const f = makeFlight(trace, i, playback.rate());
      if (f && f.t1 >= t) particles.emit(f);
    }
    cursor = hi;
  };

  const emitUpTo = (t: number) => {
    const hi = timeline.indexAt(t);
    for (let i = cursor; i < hi; i++) {
      const e = trace.events[i];
      const f = makeFlight(trace, i, playback.rate());
      if (f) particles.emit(f);
      if (e.kind === "spawn" && e.child !== undefined) bus.emit("spawn", { agent: e.child, parent: e.agent });
      else if (e.kind === "return" && e.child !== undefined) bus.emit("return", { agent: e.child });
      else if (e.kind === "call" && e.category) {
        bus.emit("call", { agent: e.agent, category: e.category });
        if (e.category === "web") bus.emit("web", { agent: e.agent, tool: e.tool ?? "web" });
      } else if (e.kind === "prompt") bus.emit("prompt", { excerpt: e.excerpt ?? "" });
    }
    cursor = hi;
  };

  const setTrace = (next: SessionTrace, startT = 0) => {
    trace = next;
    timeline = buildTimeline(next);
    counts = stationCounts(next);
    activity = stationActivity(next);
    probes = webProbes(next);
    promptTimes = next.events.filter((e) => e.kind === "prompt").map((e) => e.t);
    agents.setTrace(next);
    tethers.setTrace(next);
    boundary.setProbes(probes);
    playback.setMap(timeline);
    playback.seek(startT);
    lastT = -1;
    bus.emit("trace", { trace: next });
  };

  setTrace(generateTrace(params.seed, params.source), params.t);
  if (params.shot) {
    selected = params.select ?? featuredAgent(trace, playback.time());
  } else {
    selected = params.select ?? -1;
    playback.play();
  }

  // --- framing ---
  const centre = new Vector3();
  let width = 1;
  let height = 1;
  const resize = () => {
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // 100 px per unit on a 900 px tall window; narrower windows fit the probes' reach instead.
    const pxPerUnit = Math.min(height / DESIGN_HEIGHT_UNITS, width / 9.4);
    const pixelScale = height / (2 * Math.tan((FOV * Math.PI) / 360));
    const distance = pixelScale / pxPerUnit;
    camera.position.set(0, -CORE_LIFT, distance);
    camera.lookAt(0, -CORE_LIFT, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    u.pixelScale.value = pixelScale;
    u.sizeScale.value = pxPerUnit / 100;
    boundary.setCameraDistance(distance);
    centre.set(0, 0, 0).project(camera);
    backdrop.setCentre((centre.x + 1) / 2, (1 - centre.y) / 2);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  // --- overlay: projected label anchors ---
  const v = new Vector3();
  const project = (x: number, y: number, z: number, inSwarm: boolean) => {
    v.set(x, y, z);
    if (inSwarm) v.applyMatrix4(swarm.matrixWorld);
    v.project(camera);
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
  };
  let overlay: InsideOverlay = { version: 0, scale: 1, width: 0, core: { x: 0, y: 0 }, boundary: { x: 0, y: 0 }, stations: [], probes: [] };
  const activityNow = new Float32Array(STATIONS.length);

  const updateOverlay = (t: number, drawn: number[]) => {
    const stationLabels = STATIONS.map((key, i): StationLabel => {
      const at = stationAngle(i);
      // Outward from the disc; the web station's probes leave along its own direction, so its label turns aside.
      const a = at - (key === "web" ? WEB_LABEL_TURN : 0);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const p = project(Math.cos(at) * STATION_RADIUS + c * LABEL_GAP, Math.sin(at) * STATION_RADIUS + s * LABEL_GAP, 0, true);
      return { key, ...p, ax: (1 - c) / 2, ay: (1 + s) / 2, count: counts.at(i, t), active: activityNow[i] > 0.5 };
    });
    const probeLabels = drawn.map((k): ProbeLabel => {
      const pr = probes[k];
      return { id: pr.event, ...project(pr.ex, pr.ey, pr.ez, true), tool: pr.tool, query: pr.query };
    });
    // The boundary label sits outside the circle at about ten to eleven on the clock face.
    const ba = (140 * Math.PI) / 180;
    overlay = {
      version: overlay.version + 1,
      scale: u.sizeScale.value,
      width,
      core: project(0, 0, 0, true),
      boundary: project(Math.cos(ba) * (BOUNDARY_RADIUS + 0.12), Math.sin(ba) * (BOUNDARY_RADIUS + 0.12), 0, false),
      stations: stationLabels,
      probes: probeLabels,
    };
  };

  // --- debug ---
  const debug = {
    frame: 0,
    settled: false,
    isWebGPU,
    tier: plan.level.tier,
    source: params.source,
    seed: params.seed,
    shot: params.shot,
    t: 0,
    rate: 0,
    playing: false,
    selected,
    agentsAlive: 0,
    streaks: 0,
    probes: 0,
    activeStations: [] as string[],
  };
  const unregister = registerDebug("inside", debug);

  let disposed = false;
  const loop = () => {
    if (disposed) return;
    const dt = clock.tick();
    playback.advance(dt);
    const t = playback.time();
    const rate = playback.rate();
    u.time.value = t;
    if (t < lastT || rate !== lastRate || lastT < 0 || t - lastT > 30) rebuildParticles(t);
    else emitUpTo(t);
    lastT = t;
    lastRate = rate;
    particles.flush();

    swarm.updateMatrixWorld();
    agents.update(t, selected);
    tethers.update(t, selected);
    for (let i = 0; i < STATIONS.length; i++) activityNow[i] = activity.at(i, t);
    stations.update(activityNow);
    const drawn = boundary.update(t);
    let lastPrompt = -Infinity;
    for (const p of promptTimes) if (p <= t) lastPrompt = p;
    pulses.update(t - lastPrompt);
    updateOverlay(t, drawn);

    post.render();
    debug.frame++;
    debug.t = t;
    debug.rate = rate;
    debug.playing = playback.playing();
    debug.selected = selected;
    debug.streaks = Math.min(particles.count, particles.capacity);
    debug.probes = drawn.length;
    debug.agentsAlive = timeline.countersAt(t).agentsActive - 1;
    debug.activeStations = STATIONS.filter((_, i) => activityNow[i] > 0.5);
    if (params.shot && debug.frame > 20) debug.settled = true;
  };

  opts.onProgress(1, "Ready");
  await renderer.setAnimationLoop(loop);

  return {
    bus,
    isWebGPU,
    timeline: () => timeline,
    setTrace: (next) => setTrace(next, 0),
    play: () => playback.play(),
    pause: () => playback.pause(),
    seek: (t) => playback.seek(t),
    setRate: (r) => playback.setRate(r),
    time: () => playback.time(),
    rate: () => playback.rate(),
    playing: () => playback.playing(),
    pick: () => null,
    selected: () => selected,
    overlay: () => overlay,
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      void renderer.setAnimationLoop(null);
      unregister();
      bus.clear();
      post.dispose();
      for (const m of [pulses, agents, core, particles, tethers, stations, boundary, backdrop]) m.dispose();
      renderer.dispose();
    },
  };
}
