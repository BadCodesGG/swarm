import { describe, expect, it } from "vitest";
import { buildCalls, stationCalls } from "./calls";
import { generateTrace } from "./generate";
import { agent, trace } from "./test-trace";

describe("buildCalls", () => {
  it("pairs a call with its result and a launch with its return", () => {
    const t = trace(
      [
        { t: 1, agent: 0, kind: "call", category: "files", tool: "Read" },
        { t: 3, agent: 0, kind: "result", category: "files", tool: "Read", call: 0, size: 900, isError: true, permission: "rule" },
        { t: 4, agent: 0, kind: "spawn", category: "agents", tool: "Agent", child: 1, excerpt: "brief" },
        { t: 10, agent: 0, kind: "return", child: 1, call: 2 },
      ],
      [agent(0), agent(1, { spawnT: 4, returnT: 10 })],
    );
    const [read, launch] = buildCalls(t);
    expect(read).toMatchObject({ tool: "Read", category: "files", start: 1, duration: 2, size: 900, isError: true, permission: "rule", spawn: false });
    expect(launch).toMatchObject({ tool: "Agent", duration: 6, spawn: true, child: 1, isError: false });
    expect(launch.size).toBeUndefined();
  });

  it("degrades on an old trace with no result fields, or no result at all", () => {
    const t = trace([
      { t: 1, agent: 0, kind: "call", category: "shell", tool: "Bash" },
      { t: 2, agent: 0, kind: "result", category: "shell", tool: "Bash", call: 0 },
      { t: 5, agent: 0, kind: "call", category: "shell", tool: "Bash" },
    ]);
    const [done, open] = buildCalls(t);
    expect(done).toMatchObject({ resolved: true, isError: false, size: undefined, permission: undefined });
    expect(open).toMatchObject({ resolved: false, duration: 0 });
  });

  it("is empty for an empty trace", () => {
    expect(buildCalls(trace([]))).toEqual([]);
  });

  it("covers every call and launch of a sample, in order", () => {
    const g = generateTrace(2, "small");
    const calls = buildCalls(g);
    expect(calls).toHaveLength(g.events.filter((e) => e.kind === "call" || e.kind === "spawn").length);
    expect(calls.every((c) => c.resolved)).toBe(true);
    for (let i = 1; i < calls.length; i++) expect(calls[i].start).toBeGreaterThanOrEqual(calls[i - 1].start);
  });
});

describe("stationCalls", () => {
  const g = generateTrace(2, "small");
  it("selects by category or tool name", () => {
    const files = stationCalls(g, "files");
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((c) => c.category === "files")).toBe(true);
    const tool = files[0].tool;
    expect(stationCalls(g, tool).every((c) => c.tool === tool)).toBe(true);
  });
  it("stops at `until`, and is empty for an unknown key", () => {
    const all = stationCalls(g, "shell");
    const cut = all[Math.floor(all.length / 2)].start;
    expect(stationCalls(g, "shell", cut).every((c) => c.start <= cut)).toBe(true);
    expect(stationCalls(g, "shell", cut).length).toBeLessThan(all.length);
    expect(stationCalls(g, "nope")).toEqual([]);
    expect(stationCalls(trace([]), "files")).toEqual([]);
  });
});
