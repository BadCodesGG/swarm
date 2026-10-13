/**
 * The Act 1 clock: trace time, rate and play state. Real seconds advance playback time (trace time
 * with idle stretches compressed, see `Timeline.toPlayback`), so a long idle gap plays in seconds.
 * Pure: the app calls `advance(dt)` once a frame.
 */

export const MIN_RATE = 1;
export const MAX_RATE = 200;

/** The part of a `Timeline` the clock needs. */
export interface PlaybackMap {
  duration: number;
  toPlayback(traceT: number): number;
  toTrace(playbackT: number): number;
}

export interface Playback {
  /** Trace seconds. */
  time(): number;
  rate(): number;
  playing(): boolean;
  play(): void;
  pause(): void;
  seek(traceT: number): void;
  setRate(rate: number): void;
  /** Moves the clock on by `dt` real seconds; pauses at the end. */
  advance(dt: number): void;
  /** A new trace: back to the start. */
  setMap(map: PlaybackMap): void;
}

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return MIN_RATE;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}

export function createPlayback(
  map: PlaybackMap,
  { t = 0, rate = 1, playing = false }: { t?: number; rate?: number; playing?: boolean } = {},
): Playback {
  let m = map;
  const clampT = (x: number) => Math.min(Math.max(Number.isFinite(x) ? x : 0, 0), m.duration);
  let time = clampT(t);
  let r = clampRate(rate);
  let on = playing;

  return {
    time: () => time,
    rate: () => r,
    playing: () => on,
    play() {
      if (time >= m.duration) time = 0;
      on = true;
    },
    pause() {
      on = false;
    },
    seek(x) {
      time = clampT(x);
    },
    setRate(x) {
      r = clampRate(x);
    },
    advance(dt) {
      if (!on || !(dt > 0)) return;
      const end = m.toPlayback(m.duration);
      const next = m.toPlayback(time) + dt * r;
      if (next >= end) {
        time = m.duration;
        on = false;
        return;
      }
      time = clampT(m.toTrace(next));
    },
    setMap(next) {
      m = next;
      time = 0;
    },
  };
}

/**
 * Whether a frame rewrites the particle ring or emits the events the playhead crossed. Ordinary
 * play always emits, however far one frame jumps (an idle cut, a long frame at 200x), so its cues
 * sound; a seek, a rate change, a new trace or a quality step calls `rewrite()` and skips them.
 */
export interface FrameSync {
  rewrite(): void;
  next(t: number): "rebuild" | "emit";
}

export function createFrameSync(): FrameSync {
  let pending = true;
  let last = -Infinity;
  return {
    rewrite() {
      pending = true;
    },
    next(t) {
      const rebuild = pending || t < last;
      pending = false;
      last = t;
      return rebuild ? "rebuild" : "emit";
    },
  };
}
