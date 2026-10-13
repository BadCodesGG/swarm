import { afterEach, describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import { clearImported, getImported, setImported } from "./imported";

afterEach(clearImported);

describe("imported session", () => {
  it("is empty until an import sets it", () => {
    expect(getImported()).toBeNull();
  });

  it("holds the same trace object, and clears", () => {
    const trace = { ...generateTrace(1, "small"), source: "upload" as const };
    setImported(trace);
    expect(getImported()).toBe(trace);
    clearImported();
    expect(getImported()).toBeNull();
  });
});
