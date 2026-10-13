import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, PREF_KEYS, readPref, readPrefs, writePref } from "./prefs";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("prefs", () => {
  it("uses the documented localStorage keys", () => {
    expect(PREF_KEYS).toEqual({ quality: "swarm-quality", motion: "swarm-motion", audio: "swarm-audio" });
  });

  it("defaults when nothing is stored, with audio off", () => {
    expect(readPrefs(fakeStorage())).toEqual(DEFAULT_PREFS);
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS.audio).toBe("off");
  });

  it("reads valid values back", () => {
    const s = fakeStorage({ "swarm-quality": "lite", "swarm-motion": "on", "swarm-audio": "on" });
    expect(readPrefs(s)).toEqual({ quality: "lite", motion: "on", audio: "on" });
  });

  it("falls back per key on anything unexpected", () => {
    const s = fakeStorage({ "swarm-quality": "ultra", "swarm-motion": "ON", "swarm-audio": "on" });
    expect(readPrefs(s)).toEqual({ quality: "auto", motion: "auto", audio: "on" });
    expect(readPref("audio", fakeStorage({ "swarm-audio": "yes" }))).toBe("off");
  });

  it("treats a throwing storage as no value", () => {
    const boom = { getItem: () => { throw new Error("denied"); } };
    expect(readPrefs(boom)).toEqual(DEFAULT_PREFS);
    expect(writePref("audio", "on", { setItem: () => { throw new Error("full"); } })).toBe(false);
  });

  it("writes valid values and refuses invalid ones", () => {
    const s = fakeStorage();
    expect(writePref("quality", "hi", s)).toBe(true);
    expect(s.data.get("swarm-quality")).toBe("hi");
    expect(writePref("quality", "max" as never, s)).toBe(false);
    expect(s.data.get("swarm-quality")).toBe("hi");
    expect(writePref("motion", "on", null)).toBe(false);
  });
});
