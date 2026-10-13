import { describe, expect, it } from "vitest";
import { AUDIO_PREF_KEY, readAudioPref, writeAudioPref } from "./pref";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("audio preference", () => {
  it("is stored under swarm-audio", () => {
    expect(AUDIO_PREF_KEY).toBe("swarm-audio");
  });

  it("is off until the visitor turns it on", () => {
    expect(readAudioPref(memory())).toBe("off");
    expect(readAudioPref(null)).toBe("off");
  });

  it("round-trips on and off", () => {
    const s = memory();
    writeAudioPref("on", s);
    expect(s.m.get("swarm-audio")).toBe("on");
    expect(readAudioPref(s)).toBe("on");
    writeAudioPref("off", s);
    expect(readAudioPref(s)).toBe("off");
  });

  it("treats anything unexpected, or storage that throws, as off", () => {
    const s = memory();
    s.m.set("swarm-audio", "loud");
    expect(readAudioPref(s)).toBe("off");
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readAudioPref(throwing)).toBe("off");
    expect(() => writeAudioPref("on", throwing)).not.toThrow();
  });
});
