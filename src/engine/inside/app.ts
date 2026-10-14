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
import { adaptQuality, budgetOptions, maxPixelRatio, qualityOverride, resolveQuality, TIERS } from "../shared/quality";
import { startInsideAudio } from "../audio/inside";
import { createRenderer } from "../shared/renderer";
import {
  BOUNDARY_RADIUS,
  featuredAgent,
  makeFlight,
  nearestWithin,
  newPose,
  pickTarget,
  sceneFraming,
  agentPose,
  STATION_RADIUS,
  STATIONS,
  stationActivity,
  stationAngle,
  stationPos,
  stationCounts,
  webProbes,
  type SceneFrame,
  type StationCategory,
  type WebProbe,
} from "./layout";
import { getImported } from "./imported";
import { parseInsideParams, type InsideParams } from "./params";
import { createFrameSync, createPlayback } from "./playback";
import { createAgents } from "./scene/agents";
import { createBackdrop } from "./scene/backdrop";
import { createBoundary } from "./scene/boundary";
import { MAX_ANCHORS, type AgentAnchor, type InsideOverlay, type ProbeLabel, type StationLabel } from "./overlay-api";
import { createUniforms } from "./scene/common";
import { createCore } from "./scene/core";
import { createNebula } from "./scene/nebula";
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
  select: { agent: number };
  station: { station: StationCategory | null };
}

export type { AgentAnchor, InsideOverlay, ProbeLabel, StationLabel } from "./overlay-api";

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
  /** The parameters the page was opened with. */
  params: InsideParams;
  /** The page asked for `source=upload` but nothing was in memory (a reload), so a sample plays instead. */
  uploadMissing: boolean;
  /** The agent nearest a point of the canvas (CSS px) within a finger's reach, or null. */
  pick(x: number, y: number): number | null;
  /** The selected agent id, or -1. */
  selected(): number;
  /** Selects an agent (ring and brighter tether); -1 clears it and stops the automatic pick. */
  select(id: number): void;
  /** The camera follows an agent; -1 stops. */
  follow(id: number): void;
  following(): number;
  /** The part of the canvas the scene is framed in (CSS px), or null for all of it. */
  setFrame(frame: SceneFrame | null): void;
  overlay(): InsideOverlay;
  /** The tool station under a point of the canvas (CSS px), or null. */
  pickStation(x: number, y: number): StationCategory | null;
  /** The selected tool station, or null. Selecting one clears the selected agent, and the reverse. */
  station(): StationCategory | null;
  selectStation(key: StationCategory | null): void;
}

const FOV = 36;
/** The core sits this many units above the framed centre. */
const CORE_LIFT = 0.2;
/** The swarm plane tips back a little, so it reads as 3D without hiding the ring. */
const TILT_X = -0.3;
const TILT_Y = 0.06;
/** CSS px around a point within which a click picks an agent. */
const PICK_RADIUS = 30;
const PICK_RADIUS_COARSE = 40;
/** Fraction of an agent's offset the camera moves while following it. */
const FOLLOW_PAN = 0.8;
/** The automatic pick of a running subagent is tried this many frames apart. */
const AUTO_SELECT_FRAMES = 20;
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
    override: qualityOverride(opts.params),
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
  let particles = createParticles(swarm, u, tier.particleCap);
  const core = createCore(swarm);
  const agents = createAgents(swarm, 64);
  let nebula = createNebula(swarm, tier.nebula);
  const pulses = createPulses(scene, u);
  const post = createPost(renderer, scene, camera, {
    bloom: { strength: isWebGPU ? 0.75 : 0.6, radius: 0.55, threshold: 0.82 },
    vignette: 0.7,
    grain: 0.022,
  });

  const bus = new EventBus<InsideEvents>();
  const clock = createClock({ fixed: params.shot });
  const audio = startInsideAudio(bus);
  // On "auto" the tier steps down while frames run slow: a smaller particle ring and pixel ratio.
  const quality = adaptQuality(plan, budgetOptions(opts.params));
  let lastFrameAt = -1;
  /** Real seconds played, for the nebula's slow swirl (fixed-step under `?shot=`). */
  let realSeconds = 0;

  let trace!: SessionTrace;
  let timeline!: Timeline;
  let counts!: ReturnType<typeof stationCounts>;
  let activity!: ReturnType<typeof stationActivity>;
  let probes!: WebProbe[];
  let promptTimes: number[] = [];
  const playback = createPlayback({ duration: 0, toPlayback: (x) => x, toTrace: (x) => x }, { rate: params.rate });
  let selected = -1;
  let stationSel: StationCategory | null = null;
  /** The visitor closed the card: stop picking one for them until the trace changes. */
  let dismissed = false;
  let followId = -1;
  let frame: SceneFrame | null = null;
  /** Index of the first event not yet emitted, for appending while playing. */
  let cursor = 0;
  /** A seek, a rate change, a new trace or a quality step rewrites the ring; ordinary play emits. */
  const sync = createFrameSync();

  const rebuildParticles = (t: number) => {
    particles.reset();
    const [lo, hi] = timeline.visibleAt(t, playback.rate());
    const now = timeline.toPlayback(t);
    for (let i = lo; i < hi; i++) {
      const f = makeFlight(timeline, i, playback.rate());
      if (f && f.t1 >= now) particles.emit(f);
    }
    cursor = hi;
  };

  const emitUpTo = (t: number) => {
    const hi = timeline.indexAt(t);
    for (let i = cursor; i < hi; i++) {
      const e = trace.events[i];
      const f = makeFlight(timeline, i, playback.rate());
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

  const select = (id: number, byVisitor = true) => {
    if (id === selected) return;
    if (id >= 0 && stationSel) selectStation(null);
    selected = id;
    if (byVisitor) dismissed = id < 0;
    if (id < 0 || id !== followId) followId = -1;
    bus.emit("select", { agent: id });
  };

  const selectStation = (key: StationCategory | null) => {
    if (key === stationSel) return;
    stationSel = key;
    if (key) select(-1);
    bus.emit("station", { station: key });
  };

  const setTrace = (next: SessionTrace, startT = 0) => {
    trace = next;
    selected = -1;
    if (stationSel) {
      stationSel = null;
      bus.emit("station", { station: null });
    }
    dismissed = false;
    followId = -1;
    timeline = buildTimeline(next);
    counts = stationCounts(next);
    activity = stationActivity(next);
    probes = webProbes(next);
    promptTimes = next.events.filter((e) => e.kind === "prompt").map((e) => e.t);
    agents.setTrace(next);
    nebula.setTrace(next, params.seed);
    tethers.setTrace(next);
    boundary.setProbes(probes);
    playback.setMap(timeline);
    playback.seek(startT);
    sync.rewrite();
    bus.emit("trace", { trace: next });
    bus.emit("select", { agent: -1 });
  };

  // `source=upload` plays the session the import screen left in memory; after a reload there is none.
  const imported = params.upload ? getImported() : null;
  const uploadMissing = params.upload && !imported;
  setTrace(imported ?? generateTrace(params.seed, params.source), params.upload ? 0 : params.t);
  if (params.shot) {
    selected = params.select ?? featuredAgent(trace, playback.time());
  } else {
    selected = params.select ?? -1;
    playback.play();
  }
  dismissed = false;

  // --- framing ---
  const centre = new Vector3();
  let width = 1;
  let height = 1;
  let distance = 10;
  /** Where the camera looks, world units off the core: follows an agent when asked. */
  let panX = 0;
  let panY = 0;
  const placeCamera = () => {
    camera.position.set(panX, panY - CORE_LIFT, distance);
    camera.lookAt(panX, panY - CORE_LIFT, 0);
    camera.updateMatrixWorld();
    centre.set(0, 0, 0).project(camera);
    backdrop.setCentre((centre.x + 1) / 2, (1 - centre.y) / 2);
  };
  // A canvas with no layout yet (a hidden tab or pane) has no size, and WebGPU rejects a zero-sized
  // target; nothing is drawn until the observer reports a real size.
  let drawable = false;
  const resize = () => {
    drawable = canvas.clientWidth > 0 && canvas.clientHeight > 0;
    width = Math.max(1, canvas.clientWidth || window.innerWidth);
    height = Math.max(1, canvas.clientHeight || window.innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // 100 px per unit on a 900 px tall window; narrower windows fit the probes' reach instead, and a
    // framed scene (the phone band, or the desktop space between the panels) fits its own slot.
    const { pxPerUnit, offsetX, offsetY } = sceneFraming({ width, height }, frame);
    const pixelScale = height / (2 * Math.tan((FOV * Math.PI) / 360));
    distance = pixelScale / pxPerUnit;
    if (frame) camera.setViewOffset(width, height, offsetX, offsetY, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    placeCamera();
    u.pixelScale.value = pixelScale;
    u.sizeScale.value = pxPerUnit / 100;
    boundary.setCameraDistance(distance);
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
  let overlay: InsideOverlay = { version: 0, scale: 1, width: 0, height: 0, frame: { x: 0, y: 0, w: 0, h: 0 }, core: { x: 0, y: 0 }, boundary: { x: 0, y: 0 }, stations: [], probes: [], anchors: [] };
  const activityNow = new Float32Array(STATIONS.length);
  /** Frames between two publishes of the overlay: React re-renders at about 20 Hz at most. */
  const OVERLAY_EVERY = 3;
  let overlayFrame = 0;
  let overlaySig = "";
  const anchorPose = newPose();

  /** The orchestrator and the busiest visible clouds by tokens so far, projected. */
  const anchorsAt = (t: number): AgentAnchor[] => {
    const found: { id: number; tokens: number }[] = [];
    for (let i = 1; i < trace.agents.length; i++) {
      if (nebula.radiusOf(i) > 0) found.push({ id: i, tokens: nebula.tokensAt(i, t) });
    }
    found.sort((p, q) => q.tokens - p.tokens || p.id - q.id);
    const top = found.slice(0, MAX_ANCHORS - 1);
    const ids = [0, ...top.map((f) => f.id)];
    return ids.map((id): AgentAnchor => {
      const a = trace.agents[id];
      agentPose(trace, id, t, anchorPose);
      const c = project(anchorPose.x, anchorPose.y, anchorPose.z, true);
      const edge = project(anchorPose.x + nebula.radiusOf(id), anchorPose.y, anchorPose.z, true);
      const r = Math.hypot(edge.x - c.x, edge.y - c.y);
      return {
        id,
        ...c,
        r,
        model: a.model,
        name: id === 0 ? "orchestrator" : a.label,
        tokens: nebula.tokensAt(id, t),
        live: id === 0 || (t >= a.spawnT && !(a.returned && t >= a.returnT)),
      };
    });
  };

  const updateOverlay = (t: number, drawn: number[]) => {
    overlayFrame++;
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
    const anchors = anchorsAt(t);
    const bounds = frame ? { x: frame.left ?? 0, y: frame.top, w: frame.width ?? width, h: frame.height } : { x: 0, y: 0, w: width, h: height };
    const core = project(0, 0, 0, true);
    // Publish only what moved a pixel or changed, and no oftener than every few frames, so a paused
    // or slowly drifting scene does not re-render the React overlay 60 times a second.
    const sig = [
      width,
      height,
      `${bounds.x},${bounds.y},${bounds.w},${bounds.h}`,
      u.sizeScale.value.toFixed(3),
      core.x.toFixed(0),
      core.y.toFixed(0),
      stationLabels.map((l) => `${l.x.toFixed(0)},${l.y.toFixed(0)},${l.count},${l.active ? 1 : 0}`).join(";"),
      probeLabels.map((l) => `${l.id},${l.x.toFixed(0)},${l.y.toFixed(0)}`).join(";"),
      anchors.map((l) => `${l.id},${l.x.toFixed(0)},${l.y.toFixed(0)},${l.r.toFixed(0)},${Math.round(l.tokens / 100)},${l.live ? 1 : 0}`).join(";"),
    ].join("|");
    if (sig === overlaySig || (overlayFrame % OVERLAY_EVERY !== 0 && overlay.width === width && overlay.height === height)) return;
    overlaySig = sig;
    // The boundary label sits outside the circle at about ten to eleven on the clock face.
    const ba = (140 * Math.PI) / 180;
    overlay = {
      version: overlay.version + 1,
      scale: u.sizeScale.value,
      width,
      height,
      frame: bounds,
      anchors,
      core,
      boundary: project(Math.cos(ba) * (BOUNDARY_RADIUS + 0.12), Math.sin(ba) * (BOUNDARY_RADIUS + 0.12), 0, false),
      stations: stationLabels,
      probes: probeLabels,
    };
  };

  // --- picking: the CPU twin of the scene (agentPose), projected like the labels ---
  const pickPose = newPose();
  const pickAgents = (t: number) => {
    const pts: { id: number; x: number; y: number }[] = [];
    for (let i = 1; i < trace.agents.length; i++) {
      agentPose(trace, i, t, pickPose);
      if (pickPose.presence < 0.5) continue;
      pts.push({ id: i, ...project(pickPose.x, pickPose.y, pickPose.z, true) });
    }
    return pts;
  };
  /** Station centres, projected at the click because the camera moves. */
  const projectStations = () =>
    STATIONS.map((_, i) => {
      stationPos(i, pickPose);
      return { id: i, ...project(pickPose.x, pickPose.y, pickPose.z, true) };
    });
  const pickRadius = () => (coarse ? PICK_RADIUS_COARSE : PICK_RADIUS);
  const pick = (x: number, y: number): number | null => (trace ? nearestWithin(pickAgents(playback.time()), x, y, pickRadius()) : null);
  const pickStation = (x: number, y: number): StationCategory | null => {
    const hit = trace ? pickTarget([], projectStations(), x, y, pickRadius()) : null;
    return hit?.kind === "station" ? hit.key : null;
  };

  /** Where agent `id` is on the canvas now (CSS px), or null while it is not in the scene. */
  const screenOf = (id: number) => {
    if (!trace || id < 1 || id >= trace.agents.length) return null;
    agentPose(trace, id, playback.time(), pickPose);
    return pickPose.presence < 0.5 ? null : project(pickPose.x, pickPose.y, pickPose.z, true);
  };

  let downX = 0;
  let downY = 0;
  const onDown = (e: PointerEvent) => {
    downX = e.clientX;
    downY = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) return;
    const box = canvas.getBoundingClientRect();
    const hit = trace ? pickTarget(pickAgents(playback.time()), projectStations(), e.clientX - box.left, e.clientY - box.top, pickRadius()) : null;
    if (hit?.kind === "agent") select(hit.id);
    else if (hit?.kind === "station") selectStation(hit.key);
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);

  // --- debug ---
  const debug = {
    frame: 0,
    settled: false,
    isWebGPU,
    tier: plan.level.tier,
    source: imported ? "upload" : params.source,
    traceSource: "",
    uploadMissing,
    seed: params.seed,
    shot: params.shot,
    t: 0,
    rate: 0,
    playing: false,
    selected,
    station: null as StationCategory | null,
    nebula: 0,
    following: -1,
    agentsAlive: 0,
    label: "",
    agents: 0,
    events: 0,
    duration: 0,
    screenOf,
    /** Agent `id`'s spawn time, trace seconds, or null. */
    spawnTOf: (id: number) => trace?.agents[id]?.spawnT ?? null,
    counters: null as null | { tokens: number; toolCalls: number; agentsSpawned: number; agentsActive: number; elapsed: number },
    streaks: 0,
    probes: 0,
    activeStations: [] as string[],
  };
  const unregister = registerDebug("inside", debug);

  let disposed = false;
  const loop = () => {
    if (disposed) return;
    const now = performance.now();
    const stepped = lastFrameAt < 0 ? null : quality.frame(now - lastFrameAt);
    lastFrameAt = now;
    if (stepped) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio(stepped, coarse)));
      particles.dispose();
      particles = createParticles(swarm, u, TIERS[stepped.tier].particleCap);
      nebula.dispose();
      nebula = createNebula(swarm, TIERS[stepped.tier].nebula);
      nebula.setTrace(trace, params.seed);
      sync.rewrite();
      debug.tier = stepped.tier;
    }
    const dt = clock.tick();
    playback.advance(dt);
    const t = playback.time();
    const rate = playback.rate();
    u.playTime.value = timeline.toPlayback(t);
    if (sync.next(t) === "rebuild") rebuildParticles(t);
    else emitUpTo(t);
    particles.flush();

    swarm.updateMatrixWorld();
    if (!dismissed && selected < 0 && debug.frame % AUTO_SELECT_FRAMES === 0) {
      const pickId = featuredAgent(trace, t);
      if (pickId > 0) select(pickId, false);
    }
    // Follow: ease the camera toward the agent's offset, or back to the centre.
    let wantX = 0;
    let wantY = 0;
    if (followId >= 0) {
      agentPose(trace, followId, t, pickPose);
      v.set(pickPose.x, pickPose.y, pickPose.z).applyMatrix4(swarm.matrixWorld);
      wantX = v.x * FOLLOW_PAN;
      wantY = v.y * FOLLOW_PAN;
    }
    if (Math.abs(wantX - panX) > 1e-4 || Math.abs(wantY - panY) > 1e-4) {
      const ease = 1 - Math.exp(-4 * Math.min(dt, 0.1));
      panX += (wantX - panX) * ease;
      panY += (wantY - panY) * ease;
      placeCamera();
    }
    agents.update(t, selected);
    tethers.update(t, selected);
    realSeconds += dt;
    for (let i = 0; i < STATIONS.length; i++) activityNow[i] = activity.at(i, t);
    nebula.update(t, selected, activityNow, realSeconds);
    stations.update(activityNow);
    const drawn = boundary.update(t);
    let lastPrompt = -Infinity;
    for (const p of promptTimes) if (p <= t) lastPrompt = p;
    pulses.update(t - lastPrompt);
    updateOverlay(t, drawn);

    if (drawable) post.render();
    debug.frame++;
    debug.t = t;
    debug.rate = rate;
    debug.playing = playback.playing();
    debug.selected = selected;
    debug.station = stationSel;
    debug.nebula = nebula.points();
    debug.following = followId;
    debug.streaks = Math.min(particles.count, particles.capacity);
    debug.probes = drawn.length;
    const counters = timeline.countersAt(t);
    debug.agentsAlive = counters.agentsActive - 1;
    debug.counters = counters;
    debug.label = trace.label;
    debug.traceSource = trace.source;
    debug.agents = trace.agents.length;
    debug.events = trace.events.length;
    debug.duration = trace.duration;
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
    params,
    uploadMissing,
    play: () => playback.play(),
    pause: () => playback.pause(),
    seek: (t) => {
      playback.seek(t);
      sync.rewrite();
    },
    setRate: (r) => {
      playback.setRate(r);
      sync.rewrite();
    },
    time: () => playback.time(),
    rate: () => playback.rate(),
    playing: () => playback.playing(),
    pick,
    selected: () => selected,
    select: (id) => select(id),
    follow: (id) => {
      followId = id >= 0 && id < trace.agents.length ? id : -1;
    },
    following: () => followId,
    setFrame: (next) => {
      frame = next;
      resize();
    },
    overlay: () => overlay,
    pickStation,
    station: () => stationSel,
    selectStation,
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      void renderer.setAnimationLoop(null);
      unregister();
      audio.dispose();
      bus.clear();
      post.dispose();
      for (const m of [pulses, nebula, agents, core, particles, tethers, stations, boundary, backdrop]) m.dispose();
      renderer.dispose();
    },
  };
}
