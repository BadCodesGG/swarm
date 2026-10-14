import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import { callsOf, lanesOf, recapOf, startedBy } from "./trace-memo";

const trace = generateTrace(3, "small");

describe("trace-memo", () => {
  it("builds once per trace", () => {
    expect(lanesOf(trace)).toBe(lanesOf(trace));
    expect(recapOf(trace)).toBe(recapOf(trace));
    expect(callsOf(trace, "shell")).toBe(callsOf(trace, "shell"));
  });
  it("counts the calls started by a time", () => {
    const list = callsOf(trace, "files");
    expect(startedBy(list, -1)).toBe(0);
    expect(startedBy(list, trace.duration)).toBe(list.length);
    if (list.length > 1) expect(startedBy(list, list[0].start)).toBeGreaterThanOrEqual(1);
  });
});
