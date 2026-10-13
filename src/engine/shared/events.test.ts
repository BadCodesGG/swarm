import { describe, expect, it } from "vitest";
import { EventBus } from "./events";

interface TestEvents {
  spawn: { agent: number };
  call: { agent: number; tool: string };
}

describe("EventBus", () => {
  it("delivers to subscribers of that type only and honours unsubscribe", () => {
    const bus = new EventBus<TestEvents>();
    const spawns: number[] = [];
    const calls: string[] = [];
    const off = bus.on("spawn", (e) => spawns.push(e.agent));
    bus.on("call", (e) => calls.push(e.tool));
    bus.emit("spawn", { agent: 3 });
    bus.emit("call", { agent: 3, tool: "Read" });
    off();
    bus.emit("spawn", { agent: 4 });
    expect(spawns).toEqual([3]);
    expect(calls).toEqual(["Read"]);
  });

  it("clear drops every handler", () => {
    const bus = new EventBus<TestEvents>();
    let n = 0;
    bus.on("spawn", () => n++);
    bus.clear();
    bus.emit("spawn", { agent: 1 });
    expect(n).toBe(0);
  });
});
