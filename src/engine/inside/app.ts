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
  featuredAgent,
  makeFlight,
  nearestWithin,
  newPose,
  pickTarget,
  sceneFraming,
  agentPose,
  STATIONS,
  stationActivity,
  stationPos,
  stationCounts,
  webProbes,
  type SceneFrame,
  type StationCategory,
  type WebProbe,
} from "./layout";
import { CAMERA_FOV, directorPose, followPose, type CameraPose } from "./camera-director";
import { getImported } from "./imported";
import { parseInsideParams, type InsideParams } from "./params";
import { createFrameSync, createPlayback } from "./playback";
import { createAgents } from "./scene/agents";
import { createBackdrop } from "./scene/backdrop";
import { createBoundary } from "./scene/boundary";
import { MAX_ANCHORS, type AgentAnchor, type CameraMode, type InsideOverlay, type ProbeLabel, type StationLabel } from "./overlay-api";
import { createUniforms } from "./scene/common";
import { createCore } from "./scene/core";
import { createNebula } from "./scene/nebula";
import { cloudAt, newCloudState } from "./nebula-plan";
import { createParticles } from "./scene/particles";
import { createPulses } from "./scene/pulses";
import { createSpokes } from "./scene/spokes";
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

export type { AgentAnchor, CameraMode, InsideOverlay, ProbeLabel, StationLabel } from "./overlay-api";

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
  /** The camera locks onto an agent (the director steps aside); -1 gives it back. */
  follow(id: number): void;
  following(): number;
  /** Who flies the camera: the director, the visitor (a drag or the wheel), or Follow. */
  cameraMode(): CameraMode;
  /** Hands the camera back to the director (the D key and the Director toggle). */
  resumeDirector(): void;
  /** The part of the canvas the scene is framed in (CSS px), or null for all of it. */
  setFrame(frame: SceneFrame | null): void;
  overlay(): InsideOverlay;
  /** The tool station under a point of the canvas (CSS px), or null. */
  pickStation(x: number, y: number): StationCategory | null;
  /** The selected tool station, or null. Selecting one clears the selected agent, and the reverse. */
  station(): StationCategory | null;
  selectStation(key: StationCategory | null): void;
}

/** CSS px around a point within which a click picks an agent. */
const PICK_RADIUS = 30;
const PICK_RADIUS_COARSE = 40;
/** Radians of orbit per CSS px dragged, and the wheel's dolly per delta unit. */
const ORBIT_PER_PX = 0.006;
const DOLLY_PER_UNIT = 0.0012;
const MIN_DIST = 2.5;
const MAX_DIST = 120;
/** The automatic pick of a running subagent is tried this many frames apart. */
const AUTO_SELECT_FRAMES = 20;
/** Screen px from a station's centre to its label's anchor. */
const LABEL_PX = 16;
/** Screen px past the canvas edge within which a label or callout is still kept. */
const EDGE_MARGIN = 40;

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
  scene.add(swarm);
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 400);
  const u = createUniforms();

  const backdrop = createBackdrop(scene);
  const boundary = createBoundary(swarm, u);
  const stations = createStations(swarm);
  const tethers = createTethers(swarm, u, 64);
  let particles = createParticles(swarm, u, tier.particleCap);
  const core = createCore(swarm);
  const agents = createAgents(swarm, 64);
  let nebula = createNebula(swarm, tier.nebula, u);
  const spokes = createSpokes(swarm, u);
  const pulses = createPulses(scene, u);
  const post = createPost(renderer, scene, camera, {
    bloom: { strength: isWebGPU ? 0.5 : 0.4, radius: 0.5, threshold: 0.9 },
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
  let mode: CameraMode = "director";
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

  const stopFollow = () => {
    followId = -1;
    if (mode === "follow") mode = "director";
  };

  const select = (id: number, byVisitor = true) => {
    if (id === selected) return;
    if (id >= 0 && stationSel) selectStation(null);
    selected = id;
    if (byVisitor) dismissed = id < 0;
    if (id < 0 || id !== followId) stopFollow();
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
    stopFollow();
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

  // --- camera: the director flies it between clusters; a drag or the wheel takes it over ---
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const eye = new Vector3();
  const look = new Vector3();
  const goalEye = new Vector3();
  const goalLook = new Vector3();
  let placed = false;
  let width = 1;
  let height = 1;
  /** What the director (or Follow) wanted on the last frame. */
  let want: CameraPose | null = null;
  const manual = { az: 0, el: 0.2, dist: 12, target: new Vector3() };

  const manualEye = (out: Vector3) =>
    out.set(
      manual.target.x + manual.dist * Math.sin(manual.az) * Math.cos(manual.el),
      manual.target.y + manual.dist * Math.sin(manual.el),
      manual.target.z + manual.dist * Math.cos(manual.az) * Math.cos(manual.el),
    );

  /** A drag or the wheel: the visitor flies from wherever the camera is now. */
  const startManual = () => {
    if (mode === "manual") return;
    const dx = eye.x - look.x;
    const dy = eye.y - look.y;
    const dz = eye.z - look.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    manual.dist = Math.min(MAX_DIST, Math.max(MIN_DIST, len));
    manual.az = Math.atan2(dx, dz);
    manual.el = Math.asin(Math.max(-1, Math.min(1, dy / len)));
    manual.target.copy(look);
    followId = -1;
    mode = "manual";
  };

  /** Moves the camera toward what the director (or the visitor) wants; `dt` real seconds. */
  const placeCamera = (dt: number) => {
    const t = playback.time();
    if (mode === "manual") {
      manualEye(goalEye);
      goalLook.copy(manual.target);
      want = null;
    } else {
      const opts = {
        rate: playback.rate(),
        aspect: width / height,
        reduced: reducedMotion,
        free: frame ? { width: (frame.width ?? width) / width, height: frame.height / height } : undefined,
      };
      want = followId >= 0 ? followPose(timeline, followId, t, opts) : directorPose(timeline, t, opts);
      goalEye.set(want.eye[0], want.eye[1], want.eye[2]);
      goalLook.set(want.target[0], want.target[1], want.target[2]);
    }
    // The director's pose is already smooth; easing only absorbs a seek, a rate change or a mode switch.
    // A scripted shot and reduced motion take the pose as it is.
    if (!placed || params.shot || (reducedMotion && mode !== "manual")) {
      eye.copy(goalEye);
      look.copy(goalLook);
    } else {
      const k = 1 - Math.exp(-(mode === "director" ? 9 : 6) * Math.min(dt, 0.1));
      eye.lerp(goalEye, k);
      look.lerp(goalLook, k);
    }
    placed = true;
    camera.position.copy(eye);
    camera.lookAt(look);
    camera.updateMatrixWorld();
    u.focus.value = Math.max(eye.distanceTo(look), 1);
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
    // A framed scene (the phone band, or the desktop space between the panels) puts the camera's
    // target in the middle of its own slot; `sizeScale` thins lines on a small screen.
    const { pxPerUnit, offsetX, offsetY } = sceneFraming({ width, height }, frame);
    const pixelScale = height / (2 * Math.tan((CAMERA_FOV * Math.PI) / 360));
    if (frame) camera.setViewOffset(width, height, offsetX, offsetY, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    u.pixelScale.value = pixelScale;
    u.sizeScale.value = pxPerUnit / 100;
    placeCamera(0);
  };
  backdrop.setCentre(0.5, 0.48);
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  // --- overlay: projected label anchors ---
  const v = new Vector3();
  const view = new Vector3();
  const right = new Vector3();
  /** Canvas px of a world point, its depth from the eye, and whether it is behind the camera. */
  const project = (x: number, y: number, z: number) => {
    v.set(x, y, z);
    view.copy(v).applyMatrix4(camera.matrixWorldInverse);
    const depth = -view.z;
    v.project(camera);
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height, depth, behind: depth <= camera.near };
  };
  const onCanvas = (p: { x: number; y: number; behind: boolean }, margin = EDGE_MARGIN) =>
    !p.behind && p.x > -margin && p.x < width + margin && p.y > -margin && p.y < height + margin;

  let overlay: InsideOverlay = { version: 0, scale: 1, width: 0, height: 0, frame: { x: 0, y: 0, w: 0, h: 0 }, core: { x: 0, y: 0 }, stations: [], probes: [], anchors: [] };
  const activityNow = new Float32Array(STATIONS.length);
  /** Frames between two publishes of the overlay: React re-renders at about 20 Hz at most. */
  const OVERLAY_EVERY = 3;
  let overlayFrame = 0;
  let overlaySig = "";
  const anchorPose = newPose();
  const anchorCloud = newCloudState();

  /** The agent the camera is on: Follow's, else the selected one while the visitor flies, else the shot's. */
  const focusAgent = () => (followId >= 0 ? followId : mode === "manual" ? selected : (want?.agent ?? -1));

  /** The orchestrator, the focused cluster and the biggest others on screen, projected. */
  const anchorsAt = (t: number): AgentAnchor[] => {
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    const focused = focusAgent();
    const all: AgentAnchor[] = [];
    const consider = (id: number) => {
      const radius = nebula.radiusOf(id);
      if (radius <= 0) return;
      const a = trace.agents[id];
      // The label sits on the cloud, which stays put once the agent has returned.
      cloudAt(trace, id, t, anchorCloud);
      const c = project(anchorCloud.x, anchorCloud.y, anchorCloud.z);
      const edge = project(anchorCloud.x + right.x * radius, anchorCloud.y + right.y * radius, anchorCloud.z + right.z * radius);
      const r = Math.hypot(edge.x - c.x, edge.y - c.y);
      if (!onCanvas(c, r)) return;
      all.push({
        id,
        x: c.x,
        y: c.y,
        r,
        model: a.model,
        name: id === 0 ? "orchestrator" : a.label,
        tokens: nebula.tokensAt(id, t),
        live: id === 0 || (t >= a.spawnT && !(a.returned && t >= a.returnT)),
        far: Math.min(1, Math.max(0, (c.depth / u.focus.value - 1.7) / 2.8)),
        focus: id === focused,
      });
    };
    consider(0);
    for (let i = 1; i < trace.agents.length; i++) consider(i);
    // The focused cluster first, then the orchestrator, then the biggest live ones on screen, then the returned.
    const rank = (a: AgentAnchor) => (a.focus ? 3 : a.id === 0 ? 2 : a.live ? 1 : 0);
    all.sort((p, q) => rank(q) - rank(p) || q.r - p.r || p.id - q.id);
    return all.slice(0, MAX_ANCHORS);
  };

  const updateOverlay = (t: number, drawn: number[]) => {
    overlayFrame++;
    const core = project(0, 0, 0);
    const stationLabels: StationLabel[] = [];
    STATIONS.forEach((key, i) => {
      stationPos(i, anchorPose);
      const c = project(anchorPose.x, anchorPose.y, anchorPose.z);
      if (!onCanvas(c)) return;
      // The label sits off the station, away from the orchestrator on screen.
      const dx = c.x - core.x;
      const dy = c.y - core.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = core.behind ? 0 : dx / len;
      const uy = core.behind ? -1 : dy / len;
      stationLabels.push({ key, x: c.x + ux * LABEL_PX, y: c.y + uy * LABEL_PX, ax: (1 - ux) / 2, ay: (1 - uy) / 2, count: counts.at(i, t), active: activityNow[i] > 0.5 });
    });
    const probeLabels: ProbeLabel[] = [];
    for (const k of drawn) {
      const pr = probes[k];
      const c = project(pr.ex, pr.ey, pr.ez);
      if (onCanvas(c)) probeLabels.push({ id: pr.event, x: c.x, y: c.y, tool: pr.tool, query: pr.query });
    }
    const anchors = anchorsAt(t);
    const bounds = frame ? { x: frame.left ?? 0, y: frame.top, w: frame.width ?? width, h: frame.height } : { x: 0, y: 0, w: width, h: height };
    // Publish only what moved a pixel or changed, and no oftener than every few frames, so a paused
    // or slowly drifting scene does not re-render the React overlay 60 times a second.
    const sig = [
      width,
      height,
      `${bounds.x},${bounds.y},${bounds.w},${bounds.h}`,
      u.sizeScale.value.toFixed(3),
      stationLabels.map((l) => `${l.key},${l.x.toFixed(0)},${l.y.toFixed(0)},${l.count},${l.active ? 1 : 0}`).join(";"),
      probeLabels.map((l) => `${l.id},${l.x.toFixed(0)},${l.y.toFixed(0)}`).join(";"),
      anchors.map((l) => `${l.id},${l.x.toFixed(0)},${l.y.toFixed(0)},${l.r.toFixed(0)},${Math.round(l.tokens / 100)},${l.live ? 1 : 0},${l.far.toFixed(1)},${l.focus ? 1 : 0}`).join(";"),
    ].join("|");
    if (sig === overlaySig || (overlayFrame % OVERLAY_EVERY !== 0 && overlay.width === width && overlay.height === height)) return;
    overlaySig = sig;
    overlay = {
      version: overlay.version + 1,
      scale: u.sizeScale.value,
      width,
      height,
      frame: bounds,
      anchors,
      core: { x: core.x, y: core.y },
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
      const c = project(pickPose.x, pickPose.y, pickPose.z);
      if (!c.behind) pts.push({ id: i, x: c.x, y: c.y });
    }
    return pts;
  };
  /** Station centres, projected at the click because the camera moves. */
  const projectStations = () => {
    const pts: { id: number; x: number; y: number }[] = [];
    STATIONS.forEach((_, i) => {
      stationPos(i, pickPose);
      const c = project(pickPose.x, pickPose.y, pickPose.z);
      if (!c.behind) pts.push({ id: i, x: c.x, y: c.y });
    });
    return pts;
  };
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
    if (pickPose.presence < 0.5) return null;
    const c = project(pickPose.x, pickPose.y, pickPose.z);
    return c.behind ? null : { x: c.x, y: c.y };
  };

  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  let dragging = false;
  const onDown = (e: PointerEvent) => {
    downX = lastX = e.clientX;
    downY = lastY = e.clientY;
    dragging = true;
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging || e.buttons === 0) return;
    // A press that has not moved far is still a click; past 8 px it is an orbit.
    if (mode !== "manual" && Math.hypot(e.clientX - downX, e.clientY - downY) <= 8) return;
    startManual();
    manual.az -= (e.clientX - lastX) * ORBIT_PER_PX;
    manual.el = Math.max(-1.35, Math.min(1.35, manual.el + (e.clientY - lastY) * ORBIT_PER_PX));
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    dragging = false;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) return;
    const box = canvas.getBoundingClientRect();
    const hit = trace ? pickTarget(pickAgents(playback.time()), projectStations(), e.clientX - box.left, e.clientY - box.top, pickRadius()) : null;
    if (hit?.kind === "agent") select(hit.id);
    else if (hit?.kind === "station") selectStation(hit.key);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    startManual();
    manual.dist = Math.min(MAX_DIST, Math.max(MIN_DIST, manual.dist * Math.exp(e.deltaY * DOLLY_PER_UNIT)));
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

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
    camera: { mode: "director" as CameraMode, kind: "", agent: -1, station: -1, distance: 0, flight: 0, eye: [0, 0, 0] as number[], target: [0, 0, 0] as number[] },
    agentsAlive: 0,
    label: "",
    agents: 0,
    events: 0,
    duration: 0,
    screenOf,
    /** The projected label anchors this frame, for scripted crops. */
    overlay: () => overlay,
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
      nebula = createNebula(swarm, TIERS[stepped.tier].nebula, u);
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
    placeCamera(dt);
    const focusId = focusAgent();
    spokes.update(timeline, t, focusId, nebula.radiusOf(focusId) * 0.95);
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
    debug.camera = {
      mode,
      kind: want?.kind ?? "manual",
      agent: want?.agent ?? -1,
      station: want?.station ?? -1,
      distance: Number(eye.distanceTo(look).toFixed(2)),
      flight: Number((want?.flight ?? 0).toFixed(3)),
      eye: [eye.x, eye.y, eye.z].map((x) => Number(x.toFixed(2))),
      target: [look.x, look.y, look.z].map((x) => Number(x.toFixed(2))),
    };
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
      if (id >= 0 && id < trace.agents.length) {
        followId = id;
        mode = "follow";
      } else stopFollow();
    },
    cameraMode: () => mode,
    resumeDirector: () => {
      followId = -1;
      mode = "director";
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
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      void renderer.setAnimationLoop(null);
      unregister();
      audio.dispose();
      bus.clear();
      post.dispose();
      for (const m of [pulses, spokes, nebula, agents, core, particles, tethers, stations, boundary, backdrop]) m.dispose();
      renderer.dispose();
    },
  };
}
