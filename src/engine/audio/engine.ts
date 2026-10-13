/**
 * Synthesised sound for both acts, ported from cubic-mm's engine. No samples, nothing fetched.
 *
 * Graph:
 *
 *   voice (osc / noise -> envelope GainNode -> StereoPannerNode) x 24  --+
 *   bed (2 sines + brown noise -> lowpass -> GainNode, -30 dB)  ---------+
 *                                                                        v
 *   DynamicsCompressorNode -> WaveShaperNode (tanh soft limiter) -> master GainNode (-6 dB) -> destination
 *
 * Sound is off by default. The AudioContext is created on the first `enable()`, which must come from
 * a user gesture. Until then, and after `disable()`, nothing is scheduled: offers are ignored and the
 * flush loop is stopped. While enabled, a requestAnimationFrame loop flushes the rate limiter, so a
 * replay at 200x or a burst of catches never becomes a wall of sound.
 */

import { RateLimiter } from "./limiter";
import { VoicePool } from "./pool";
import type { Cue, Offer } from "./cues";
import { STEAL_FADE, createBed, createNoise, createVoice, duration, playCue, silence, tanhCurve, type Bed, type Noise, type Voice } from "./voices";

export interface AudioEngine {
  readonly enabled: boolean;
  /** Start (or resume) sound. Call from a click. Resolves true once the context is running. */
  enable(): Promise<boolean>;
  disable(): void;
  /** Queue a cue for the next flush; ignored while disabled. */
  offer: Offer;
  dispose(): void;
}

const VOICES = 24;
const CUES_PER_SECOND = 14;
const CUES_PER_FLUSH = 4;
const MASTER_GAIN = 0.501; // -6 dB
const SUSPEND_AFTER_MS = 1500;

export function createAudio(): AudioEngine {
  let ctx: AudioContext | null = null;
  let noise: Noise;
  let bed: Bed;
  let pool: VoicePool<Voice>;
  let enabled = false;
  let disposed = false;
  let raf = 0;
  let suspendTimer: ReturnType<typeof setTimeout> | undefined;

  const cues = new RateLimiter<Cue>(CUES_PER_SECOND, CUES_PER_FLUSH);

  function build(): AudioContext {
    const c = new AudioContext({ latencyHint: "interactive" });
    const compressor = c.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;
    const limiter = c.createWaveShaper();
    limiter.curve = tanhCurve();
    limiter.oversample = "2x";
    const master = c.createGain();
    master.gain.value = MASTER_GAIN;
    compressor.connect(limiter).connect(master).connect(c.destination);

    noise = createNoise(c);
    bed = createBed(c, noise, compressor);
    pool = new VoicePool(VOICES, () => createVoice(c, compressor));
    return c;
  }

  /** A stolen voice is faded out first, so its replacement starts STEAL_FADE later. */
  function play(c: AudioContext, cue: Cue): void {
    const now = c.currentTime;
    const { voice, stolen } = pool.acquire(now, duration(cue.timbre));
    if (stolen) silence(voice, now);
    playCue(c, voice, noise, cue, stolen ? now + STEAL_FADE : now);
  }

  const flush = () => {
    raf = 0;
    if (!enabled || !ctx) return;
    for (const cue of cues.flush(ctx.currentTime)) play(ctx, cue);
    raf = requestAnimationFrame(flush);
  };

  return {
    get enabled() {
      return enabled;
    },

    async enable() {
      if (disposed) return false;
      clearTimeout(suspendTimer);
      try {
        ctx ??= build();
      } catch {
        // No Web Audio here (or the browser refused a context): stay silent.
        return false;
      }
      const c = ctx;
      // `resume()` can stay pending when the browser has not seen a gesture, so do not wait on it forever.
      await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 500))]).catch(() => {});
      if (disposed) return false;
      if (c.state !== "running") {
        void c.suspend().catch(() => {});
        return false;
      }
      enabled = true;
      bed.fadeIn(c.currentTime);
      if (!raf) raf = requestAnimationFrame(flush);
      return true;
    },

    disable() {
      if (!enabled || !ctx) return;
      enabled = false;
      cancelAnimationFrame(raf);
      raf = 0;
      // Drop what was queued; a sound that arrives after "off" would be a bug.
      cues.clear();
      const c = ctx;
      bed.fadeOut(c.currentTime);
      suspendTimer = setTimeout(() => {
        if (!enabled) void c.suspend().catch(() => {});
      }, SUSPEND_AFTER_MS);
    },

    offer(cue, rank) {
      if (enabled) cues.offer(cue, rank);
    },

    dispose() {
      disposed = true;
      enabled = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(suspendTimer);
      cues.clear();
      void ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
