import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import type { SessionTrace } from "@/lib/trace/types";
import { momentSearch } from "./moment-url";

const sample = generateTrace(7, "small");
const upload: SessionTrace = { ...sample, source: "upload" };

describe("momentSearch", () => {
  it("writes source, seed, t, select and follow for a sample, keeping other params", () => {
    const next = momentSearch("?quality=low&t=1", sample, { size: "small", seed: 7, t: 12.34, select: 3, follow: 3 });
    const q = new URLSearchParams(next ?? "");
    expect(q.get("source")).toBe("small");
    expect(q.get("seed")).toBe("7");
    expect(q.get("t")).toBe("12.3");
    expect(q.get("select")).toBe("3");
    expect(q.get("follow")).toBe("3");
    expect(q.get("quality")).toBe("low");
  });

  it("drops select and follow when nothing is selected or followed", () => {
    const next = momentSearch("?select=2&follow=2", sample, { size: "medium", seed: 1, t: 5, select: -1, follow: -1 });
    const q = new URLSearchParams(next ?? "");
    expect(q.has("select")).toBe(false);
    expect(q.has("follow")).toBe(false);
  });

  it("never builds a URL for an uploaded session", () => {
    expect(momentSearch("?source=upload", upload, { size: "small", seed: 7, t: 12, select: 3, follow: 3 })).toBeNull();
  });

  it("never builds a URL when the sample size is unknown", () => {
    expect(momentSearch("", sample, { size: null, seed: 7, t: 12, select: -1, follow: -1 })).toBeNull();
  });
});
