/**
 * The Box under reduced motion (or with no WebGPU and no WebGL 2): a `BoxApp` with no renderer and
 * no three. The scene slot shows a still frame of the escape, drawn on a 2D canvas, while the HUD
 * stays live: the layer switches configure, and "Run 100 trials" runs and plots off the main
 * thread exactly as in the live scene. Play is a request for motion, so it enters the live scene.
 */

import { rogueCount } from "@/lib/box/sim";
import type { BoxConfig } from "@/lib/box/types";
import { startBoxAudio } from "../audio/box";
import { registerDebug } from "../shared/debug";
import { EventBus } from "../shared/events";
import { TIERS } from "../shared/quality";
import type { BoxApp, BoxEvents, BoxSnapshot, Frame } from "./app";
import { parseBoxParams } from "./params";
import { createTally, type Tally } from "./tally";

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

/** The DOM-free part of the still Box: state, snapshot, bus and debug entry. */
export function createStillBox({ params, enter, paint }: StillBoxOptions): BoxApp {
  const parsed = parseBoxParams(params);
  // The trials never use the crowd size; the counters only need a plausible one.
  const count = TIERS.lite.crowdSize;
  const bus = new EventBus<BoxEvents>();
  const audio = startBoxAudio(bus);
  let config: BoxConfig = parsed.config;
  let seed = parsed.seed;
  let tally: Tally = createTally(count, rogueCount(config, count));
  let version = 0;
  let trials = 0;
  const offTrials = bus.on("trials", () => {
    trials++;
    debug.trials = trials;
  });

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
  });
  let snapshot = make();

  const debug = { still: true, settled: true, seed, config, trials };
  const unregister = registerDebug("box", debug);

  return {
    bus,
    isWebGPU: false,
    configure(next) {
      config = next;
      debug.config = next;
      snapshot = make();
      bus.emit("config", next);
    },
    reset(next) {
      seed = next;
      debug.seed = next;
      tally = createTally(count, rogueCount(config, count));
      snapshot = make();
      bus.emit("reset", { seed: next });
    },
    stats: () => snapshot,
    play: enter,
    pause() {},
    replayEscape() {},
    setFrame: (frame) => paint(frame),
    dispose() {
      offTrials();
      unregister();
      audio.dispose();
      bus.clear();
      paint(null);
    },
  };
}

/** Loads the still and draws it into whatever scene slot the HUD reports, at device resolution. */
export async function startBoxStill(canvas: HTMLCanvasElement, { src, params, enter }: { src: string; params: URLSearchParams; enter(): void }): Promise<BoxApp> {
  const image = new Image();
  image.src = src;
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
