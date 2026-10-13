/**
 * The sounds. Everything is synthesised; there are no samples and no audio files.
 *
 * Ported from cubic-mm's voices. Factory functions over a plain `BaseAudioContext`, with no module
 * state, so the engine decides when they run and how many may sound at once. A `Voice` is the part
 * that lives in the pool: one StereoPannerNode and one envelope GainNode, built once. Each trigger
 * hangs a few short-lived source nodes off it (an oscillator cannot be restarted, so that is the
 * cheapest thing the Web Audio API allows) and the browser releases them after `stop()`.
 *
 * The scenes are a stage seen from the front, not a space to fly through, so voices pan in stereo
 * rather than through cubic-mm's HRTF panner.
 */

import type { Cue, Timbre } from "./cues";

/** Slack after an envelope ends before its sources are stopped and its voice counts as free. */
const TAIL = 0.02;
/** How long a stolen voice takes to fade out before its replacement starts. */
export const STEAL_FADE = 0.008;

const BED_GAIN = 0.0316; // -30 dB
const BED_FADE = 1.5;

/** Attack and decay per timbre, seconds. */
const ENVELOPE: Readonly<Record<Timbre, { attack: number; decay: number }>> = {
  rise: { attack: 0.01, decay: 0.16 },
  fall: { attack: 0.01, decay: 0.18 },
  tick: { attack: 0.002, decay: 0.05 },
  whoosh: { attack: 0.08, decay: 0.22 },
  bell: { attack: 0.005, decay: 1.4 },
  thud: { attack: 0.004, decay: 0.16 },
  buzz: { attack: 0.006, decay: 0.12 },
  hiss: { attack: 0.004, decay: 0.09 },
  ping: { attack: 0.003, decay: 0.3 },
  gong: { attack: 0.006, decay: 0.9 },
  alarm: { attack: 0.02, decay: 0.7 },
  chord: { attack: 0.02, decay: 0.9 },
};

/** How long a cue occupies a voice, seconds. */
export function duration(timbre: Timbre): number {
  const e = ENVELOPE[timbre];
  return e.attack + e.decay + TAIL;
}

export interface Voice {
  pan: StereoPannerNode;
  env: GainNode;
  /** Sources of the sound currently (or last) on this voice. */
  active: AudioScheduledSourceNode[];
}

export interface Noise {
  white: AudioBuffer;
  brown: AudioBuffer;
}

/** A soft limiter curve: tanh, scaled so full-scale input stays full scale. */
export function tanhCurve(drive = 1.5, points = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  const norm = Math.tanh(drive);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

export function createNoise(ctx: BaseAudioContext): Noise {
  const rate = ctx.sampleRate;
  const white = ctx.createBuffer(1, rate, rate);
  const w = white.getChannelData(0);
  for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;

  const brown = ctx.createBuffer(1, rate * 3, rate);
  const b = brown.getChannelData(0);
  let last = 0;
  for (let i = 0; i < b.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    b[i] = last * 3.5;
  }
  // Crossfade the tail into the head so the loop has no seam.
  const fade = Math.floor(rate * 0.25);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    b[i] = b[i] * k + b[b.length - fade + i] * (1 - k);
  }
  return { white, brown };
}

export function createVoice(ctx: BaseAudioContext, out: AudioNode): Voice {
  const pan = ctx.createStereoPanner();
  const env = ctx.createGain();
  env.gain.value = 0;
  env.connect(pan).connect(out);
  return { pan, env, active: [] };
}

/** Fade a stolen voice out quickly and stop what it was playing. */
export function silence(voice: Voice, now: number): void {
  voice.env.gain.cancelScheduledValues(now);
  voice.env.gain.setTargetAtTime(0, now, STEAL_FADE / 4);
  for (const s of voice.active) {
    try {
      s.stop(now + STEAL_FADE);
    } catch {
      // Already stopped.
    }
  }
  voice.active.length = 0;
}

/** Schedule the amplitude envelope and return the time the sources should stop. */
function shape(voice: Voice, t: number, peak: number, attack: number, decay: number): number {
  const g = voice.env.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + attack);
  g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  voice.active.length = 0;
  return t + attack + decay + TAIL;
}

function tone(ctx: BaseAudioContext, voice: Voice, type: OscillatorType, hz: number, level: number, t: number, end: number, glideTo?: number): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz, t);
  if (glideTo !== undefined) o.frequency.exponentialRampToValueAtTime(glideTo, end - TAIL);
  const g = ctx.createGain();
  g.gain.value = level;
  o.connect(g).connect(voice.env);
  o.start(t);
  o.stop(end);
  voice.active.push(o);
}

function noiseThrough(ctx: BaseAudioContext, voice: Voice, noise: Noise, filter: BiquadFilterNode, t: number, end: number): void {
  const s = ctx.createBufferSource();
  s.buffer = noise.white;
  s.start(t, Math.random() * Math.max(0, noise.white.duration - (end - t)));
  s.stop(end);
  s.connect(filter).connect(voice.env);
  voice.active.push(s);
}

function band(ctx: BaseAudioContext, type: BiquadFilterType, hz: number, q: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  return f;
}

/** Plays one cue on a voice at audio-clock time `t`. */
export function playCue(ctx: BaseAudioContext, voice: Voice, noise: Noise, cue: Cue, t: number): void {
  const { attack, decay } = ENVELOPE[cue.timbre];
  voice.pan.pan.setValueAtTime(cue.pan, t);
  const end = shape(voice, t, cue.level, attack, decay);
  const hz = cue.hz;
  switch (cue.timbre) {
    case "rise":
      tone(ctx, voice, "sine", hz, 1, t, end, hz * 1.5);
      tone(ctx, voice, "triangle", hz, 0.25, t, end, hz * 1.5);
      break;
    case "fall":
      tone(ctx, voice, "sine", hz * 1.5, 1, t, end, hz);
      tone(ctx, voice, "triangle", hz * 1.5, 0.25, t, end, hz);
      break;
    case "tick":
      tone(ctx, voice, "sine", hz, 1, t, end);
      tone(ctx, voice, "triangle", hz * 2, 0.2, t, end);
      break;
    case "whoosh": {
      const f = band(ctx, "bandpass", 300, 2);
      f.frequency.setValueAtTime(300, t);
      f.frequency.exponentialRampToValueAtTime(hz * 5, end - TAIL);
      noiseThrough(ctx, voice, noise, f, t, end);
      break;
    }
    case "bell":
    case "gong":
      // Inharmonic partials: what makes a struck metal read as a bell rather than an organ.
      tone(ctx, voice, "sine", hz, 1, t, end);
      tone(ctx, voice, "sine", hz * 2.76, 0.35, t, end);
      tone(ctx, voice, "sine", hz * 5.4, 0.12, t, end);
      break;
    case "thud":
      tone(ctx, voice, "triangle", hz * 1.6, 1, t, end, hz);
      break;
    case "buzz": {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = hz;
      const f = band(ctx, "lowpass", hz * 4, 1);
      const g = ctx.createGain();
      g.gain.value = 0.5;
      o.connect(f).connect(g).connect(voice.env);
      o.start(t);
      o.stop(end);
      voice.active.push(o);
      break;
    }
    case "hiss":
      noiseThrough(ctx, voice, noise, band(ctx, "highpass", hz, 0.7), t, end);
      break;
    case "ping":
      tone(ctx, voice, "sine", hz, 1, t, end);
      break;
    case "alarm":
      tone(ctx, voice, "sawtooth", hz, 0.35, t, end, hz / 2);
      tone(ctx, voice, "sine", hz * 1.01, 0.6, t, end, hz / 2);
      break;
    case "chord":
      // A major triad: root, third, fifth.
      for (const [ratio, level] of [
        [1, 0.6],
        [1.26, 0.4],
        [1.5, 0.4],
      ] as const)
        tone(ctx, voice, "sine", hz * ratio, level, t, end);
      break;
  }
}

export interface Bed {
  fadeIn(now: number): void;
  /** Fade out, then stop the sources. */
  fadeOut(now: number): void;
}

/**
 * The room tone: two detuned 55 Hz sines and brown noise through a 120 Hz lowpass, at -30 dB.
 * Its nodes exist only between `fadeIn` and the end of `fadeOut`.
 */
export function createBed(ctx: BaseAudioContext, noise: Noise, out: AudioNode): Bed {
  let live: { gain: GainNode; sources: AudioScheduledSourceNode[] } | null = null;
  return {
    fadeIn(now) {
      if (live) {
        live.gain.gain.cancelScheduledValues(now);
        live.gain.gain.setTargetAtTime(BED_GAIN, now, BED_FADE / 3);
        return;
      }
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.setTargetAtTime(BED_GAIN, now, BED_FADE / 3);
      gain.connect(out);
      const sources: AudioScheduledSourceNode[] = [];
      for (const hz of [55, 55.4]) {
        const o = ctx.createOscillator();
        o.frequency.value = hz;
        const g = ctx.createGain();
        g.gain.value = 0.5;
        o.connect(g).connect(gain);
        o.start(now);
        sources.push(o);
      }
      const rumble = ctx.createBufferSource();
      rumble.buffer = noise.brown;
      rumble.loop = true;
      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 120;
      rumble.connect(low).connect(gain);
      rumble.start(now);
      sources.push(rumble);
      live = { gain, sources };
    },
    fadeOut(now) {
      const current = live;
      if (!current) return;
      live = null;
      current.gain.gain.cancelScheduledValues(now);
      current.gain.gain.setTargetAtTime(0, now, 0.15);
      for (const s of current.sources) s.stop(now + 1);
    },
  };
}
