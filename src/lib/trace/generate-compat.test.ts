import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateTrace, type SampleSize } from "./generate";
import type { SessionTrace } from "./types";

/**
 * Digest of the fields a sample had before the brief, permission, size, think time and
 * compaction fields existed: compact events are dropped (and `call` links remapped past them),
 * and the new keys are stripped. Hero seed 50 drives public/og.jpg and the stills, so these
 * digests were taken on the code before those fields were generated and must never change.
 */
export function legacyDigest(trace: SessionTrace): string {
  const keep: number[] = [];
  let n = 0;
  trace.events.forEach((e, i) => {
    if ((e.kind as string) !== "compact") keep[i] = n++;
  });
  const events = trace.events
    .filter((e) => (e.kind as string) !== "compact")
    .map((e) => {
      const o: Record<string, unknown> = { ...e };
      delete o.permission;
      delete o.size;
      delete o.thinkMs;
      delete o.compact;
      if (e.kind === "spawn") delete o.excerpt;
      if (e.call !== undefined) o.call = keep[e.call];
      return o;
    });
  const body = JSON.stringify({ source: trace.source, label: trace.label, duration: trace.duration, agents: trace.agents, events });
  return createHash("sha256").update(body).digest("hex");
}

const LEGACY: Record<SampleSize, string> = {
  small: "5a91a4c5cfa5ac71e5406905ca581a08b61cbf454adf9c506b4ffcc082bce89f",
  medium: "3ad31200a8808cd5187cd6d8da5434d27c9e6c28611f6d85fe7225d5ec6d9986",
  large: "b79e977ff4d3f02a7932bce21d751877bf975453343305445f2314c199461ea8",
};

describe("hero seed 50 legacy fields", () => {
  it.each(["small", "medium", "large"] as const)("%s keeps every pre-existing field", (size) => {
    expect(legacyDigest(generateTrace(50, size))).toBe(LEGACY[size]);
  });
});
