/** Small literal traces for tests. Not imported by app code. */
import type { ModelFamily, SessionTrace, TraceAgent, TraceEvent } from "./types";

const usage = { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 };

export function agent(id: number, over: Partial<TraceAgent> = {}): TraceAgent {
  return {
    id,
    parent: id === 0 ? -1 : 0,
    depth: id === 0 ? 0 : 1,
    model: (id === 0 ? "opus" : "sonnet") as ModelFamily,
    modelId: "m",
    agentType: id === 0 ? "main" : "general",
    label: `agent ${id}`,
    spawnT: 0,
    returnT: 100,
    returned: id !== 0,
    background: false,
    usage,
    toolCalls: 0,
    childMissing: false,
    ...over,
  };
}

export function trace(events: TraceEvent[], agents: TraceAgent[] = [agent(0)], over: Partial<SessionTrace> = {}): SessionTrace {
  return { version: 1, source: "sample", label: "t", duration: 100, agents, events, truncated: false, ...over };
}

export { usage };
