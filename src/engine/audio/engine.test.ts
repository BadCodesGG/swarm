import { afterEach, describe, expect, it, vi } from "vitest";
import { createAudio } from "./engine";

afterEach(() => vi.unstubAllGlobals());

describe("audio engine", () => {
  it("is off until enabled, and builds no AudioContext for offers made while off", () => {
    const AudioContext = vi.fn();
    vi.stubGlobal("AudioContext", AudioContext);
    const engine = createAudio();
    expect(engine.enabled).toBe(false);
    engine.offer({ timbre: "tick", hz: 220, pan: 0, level: 0.1 }, 0);
    engine.disable();
    expect(AudioContext).not.toHaveBeenCalled();
    engine.dispose();
  });

  it("stays silent, without throwing, where there is no Web Audio", async () => {
    const engine = createAudio();
    await expect(engine.enable()).resolves.toBe(false);
    expect(engine.enabled).toBe(false);
  });

  it("refuses to start once disposed", async () => {
    const AudioContext = vi.fn();
    vi.stubGlobal("AudioContext", AudioContext);
    const engine = createAudio();
    engine.dispose();
    await expect(engine.enable()).resolves.toBe(false);
    expect(AudioContext).not.toHaveBeenCalled();
  });
});
