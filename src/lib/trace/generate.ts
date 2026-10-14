import { fork, pick, sampleQuantiles, type Rng } from "../rng";
import { BRIEFS, HANDBACKS, LABEL_NOUNS, LABEL_VERBS, PROMPTS, TURN_EXCERPTS, WEB_QUERIES } from "./phrases";
import {
  CALIBRATION,
  CORE_CATEGORIES,
  DEPTH_KEYS,
  LIFE_BINS,
  TYPE_KEYS,
  type CalibrationStats,
  type CallCategory,
  type CoreCategory,
} from "./stats";
import type { ModelFamily, PermissionSource, SessionTrace, TraceAgent, TraceEvent, Usage } from "./types";

export type SampleSize = "small" | "medium" | "large";

type Range = readonly [number, number];

/** The skeleton a size fixes; `CALIBRATION` supplies what happens inside it. */
export interface SizePreset {
  agents: Range;
  /** Deepest agent; each level below the orchestrator gets at least one agent. */
  depth: 1 | 2 | 3;
  events: Range;
  /** Human prompts; the orchestrator works through one phase per prompt. */
  prompts: Range;
  /** Size of the first orchestrator fan-out group, or null for ordinary groups. */
  rootGroup: Range | null;
  /** Orchestrator children at depth 1, at least. */
  minRootChildren: number;
  /** Largest sibling group below the first. */
  maxGroup: number;
  /** The second prompt always arrives after a long idle stretch. */
  forcedIdle: boolean;
}

export const PRESETS: Record<SampleSize, SizePreset> = {
  small: { agents: [3, 8], depth: 1, events: [150, 400], prompts: [1, 2], rootGroup: null, minRootChildren: 2, maxGroup: 3, forcedIdle: false },
  medium: { agents: [10, 25], depth: 2, events: [1000, 3000], prompts: [2, 4], rootGroup: null, minRootChildren: 3, maxGroup: 4, forcedIdle: true },
  large: { agents: [40, 120], depth: 3, events: [8000, 20000], prompts: [3, 6], rootGroup: [6, 8], minRootChildren: 8, maxGroup: 5, forcedIdle: true },
};

/** Generic tool names a sample uses; each categorizes back to its key. Web tools are picked apart. */
const TOOLS: Record<Exclude<CallCategory, "web">, readonly string[]> = {
  shell: ["Bash", "PowerShell"],
  files: ["Read", "Grep", "Glob", "LS"],
  edit: ["Edit", "Write", "MultiEdit", "NotebookEdit"],
  advisor: ["advisor"],
  plan: ["TodoWrite", "ExitPlanMode"],
  mcp: ["mcp__sample__lookup", "mcp__sample__query"],
  other: ["Skill", "ToolSearch"],
};

/** Seconds from a turn to its first call, and between calls issued one after another. */
const TURN_THINK: Range = [0.05, 0.6];
const CALL_STEP: Range = [0.05, 0.4];
/** The idle stretch before the second prompt when a preset forces one. */
const FORCED_IDLE_GAP: Range = [660, 2400];
/** Heavy tails are clipped so one draw cannot swallow a session: a wait mid-task, and a human's. */
const MAX_IDLE_GAP = 240;
const MAX_HUMAN_GAP = 1800;
const MIN_HUMAN_GAP = 5;

const SIZE_STREAM: Record<SampleSize, number> = { small: 0, medium: 1000, large: 2000 };
/**
 * Streams for the fields added after the sample was calibrated (briefs, permissions, result sizes,
 * think time, the compaction). Each lives on its own stream, so none of them shifts a draw that
 * the original fields depend on, and hero seed 50 keeps its trace. Existing streams top out near 2,300.
 */
const DETAIL_STREAM = 50_000;
const COMPACT_STREAM = 59_000;

const uni = (r: Rng, [a, b]: Range) => a + r() * (b - a);
const int = (r: Rng, [a, b]: Range) => a + Math.floor(r() * (b - a + 1));
const round2 = (x: number) => Math.round(x * 100) / 100;
const choose = <T>(xs: readonly T[], r: Rng): T => xs[Math.floor(r() * xs.length)];
const pickPair = <T>(pairs: readonly (readonly [T, number])[], r: Rng): T =>
  pairs[pick(pairs.map((p) => p[1]), r)][0];

/** A call an agent must make somewhere in its life, `at` being how far through (0 to 1). */
interface Must {
  category: CallCategory;
  at: number;
}

interface Plan {
  groups: number[][];
  budget: number;
  must: Must[];
  prompts: number;
}

/** What a subagent's drawn size says of it: weight in the event budget, and how fast it works. */
interface Shape {
  calls: number;
  pace: number;
}

/** A group size from a histogram indexed by count, at least 1 and at most `cap`. */
function groupOf(weights: readonly number[], cap: number, r: Rng): number {
  const tail = weights.map((w, i) => (i === 0 ? 0 : w));
  return tail.some((w) => w > 0) ? Math.min(pick(tail, r), cap) : 1;
}

const modelPairs = (mix: Record<ModelFamily, number>) =>
  (Object.entries(mix) as [ModelFamily, number][]).filter(([m]) => m !== "other");

/** The skeleton: who exists, who spawns whom, and in which sibling groups. */
function buildAgents(
  preset: SizePreset,
  stats: CalibrationStats,
  r: Rng,
): { agents: TraceAgent[]; groupsOf: number[][][]; shapes: Shape[] } {
  const total = int(r, preset.agents);
  const n = total - 1;

  let counts: number[];
  if (preset.depth === 1) counts = [n];
  else if (preset.depth === 2) {
    const c1 = Math.min(Math.max(Math.round(n * uni(r, [0.4, 0.6])), preset.minRootChildren), n - 1);
    counts = [c1, n - c1];
  } else {
    const c1 = Math.max(Math.round(n * uni(r, [0.3, 0.45])), preset.minRootChildren);
    const c2 = Math.max(1, Math.min(Math.round(n * uni(r, [0.3, 0.4])), n - c1 - 1));
    counts = [c1, c2, n - c1 - c2];
  }

  const agents: TraceAgent[] = [];
  const byDepth: number[][] = [[0]];
  const make = (id: number, parent: number, depth: number, model: ModelFamily, agentType: string, label: string) => {
    const a: TraceAgent = {
      id,
      parent,
      depth,
      model,
      modelId: `claude-${model}-sample`,
      agentType,
      label,
      spawnT: 0,
      returnT: 0,
      returned: id !== 0,
      background: false,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      toolCalls: 0,
      childMissing: false,
    };
    agents.push(a);
    byDepth[depth] ??= [];
    if (id !== 0) byDepth[depth].push(id);
  };
  make(0, -1, 0, "opus", "main", "Orchestrator");

  const forcedModels: ModelFamily[] = ["sonnet", "haiku", "fable"];
  counts.forEach((count, di) => {
    const depth = di + 1;
    // Only some agents launch subagents of their own; at least one must.
    const above = byDepth[depth - 1];
    let spawners = depth === 1 ? above : above.filter(() => r() < stats.childSpawnProb);
    if (spawners.length === 0) spawners = [above[int(r, [0, above.length - 1])]];
    for (let k = 0; k < count; k++) {
      const id = agents.length;
      const parent = depth === 1 ? 0 : spawners[int(r, [0, spawners.length - 1])];
      const model = forcedModels[id - 1] ?? pickPair(modelPairs(stats.modelMix[DEPTH_KEYS[depth - 1]]), r);
      const label = `${choose(LABEL_VERBS, r)} ${choose(LABEL_NOUNS, r)}`;
      make(id, parent, depth, model, pickPair(TYPE_KEYS.map((t) => [t, stats.agentTypeMix[t]] as const), r), label);
    }
  });

  // Sibling groups: children of one parent spawned together in one orchestrator turn.
  const groupsOf: number[][][] = agents.map(() => []);
  agents.forEach((a) => {
    const kids = agents.filter((k) => k.parent === a.id).map((k) => k.id);
    for (let i = 0; i < kids.length; ) {
      const first = a.id === 0 && i === 0 ? preset.rootGroup : null;
      const wanted = first
        ? int(r, first)
        : a.id === 0
          ? groupOf(stats.spawnsPerTurn, preset.maxGroup, r)
          : groupOf(stats.groupSize, 3, r);
      const size = Math.min(wanted, kids.length - i);
      groupsOf[a.id].push(kids.slice(i, i + size));
      i += size;
    }
  });

  // Background children belong to the orchestrator, which outlives them.
  const rootKids = agents.filter((a) => a.parent === 0);
  for (const k of rootKids) k.background = r() < stats.backgroundFraction;
  if (!rootKids.some((k) => k.background)) {
    const lastGroup = groupsOf[0][groupsOf[0].length - 1];
    agents[lastGroup[0]].background = true;
  }

  // Each subagent's drawn tool calls and duration: its share of the budget, and its pace.
  const refPace = stats.childDuration.p50 / stats.childToolCalls.p50;
  const shapes: Shape[] = agents.map((a) => {
    if (a.id === 0) return { calls: 0, pace: 1 };
    const calls = sampleQuantiles(stats.childToolCalls, r);
    const duration = sampleQuantiles(stats.childDuration, r);
    return { calls, pace: Math.min(2, Math.max(0.5, duration / calls / refPace)) };
  });
  return { agents, groupsOf, shapes };
}

function split(budgets: Plan[], shapes: Shape[], target: number, mandatory: number) {
  const rest = target - mandatory;
  const mins = budgets.map((p, i) => 4 + 2 * p.must.length + 2 * p.groups.length + (i === 0 ? 4 * p.prompts : 0));
  const extra = Math.max(0, rest - mins.reduce((a, b) => a + b, 0));
  const weights = shapes.map((s) => s.calls);
  const others = weights.reduce((a, b) => a + b, 0) - weights[0];
  weights[0] = 0.4 * others;
  const sum = weights.reduce((a, b) => a + b, 0);
  let given = 0;
  budgets.forEach((p, i) => {
    const share = Math.floor((extra * weights[i]) / sum);
    p.budget = mins[i] + share;
    given += share;
  });
  budgets[0].budget += extra - given;
}

interface Ctx {
  stats: CalibrationStats;
  shapes: Shape[];
  seed: number;
  streamBase: number;
  agents: TraceAgent[];
  plans: Plan[];
  events: TraceEvent[];
  preset: SizePreset;
}

function makeUsage(c: Ctx, model: ModelFamily, r: Rng): Usage {
  const u = c.stats.usage[model];
  return {
    input: Math.round(sampleQuantiles(u.input, r)),
    output: Math.round(sampleQuantiles(u.output, r)),
    cacheRead: Math.round(sampleQuantiles(u.cacheRead, r)),
    cacheWrite: Math.round(sampleQuantiles(u.cacheWrite, r)),
  };
}

/** Runs one agent from `startT` and returns its returnT (the session's last event time for the orchestrator). */
function runAgent(c: Ctx, id: number, startT: number): number {
  const { stats, events } = c;
  const me = c.agents[id];
  const plan = c.plans[id];
  const pace = c.shapes[id].pace;
  const r = fork(c.seed, c.streamBase + 100 + id);
  const rd = fork(c.seed, DETAIL_STREAM + c.streamBase + id);
  const must = [...plan.must];
  const phases = id === 0 ? plan.prompts : 1;

  me.spawnT = startT;
  let cursor = id === 0 ? startT : round2(startT + uni(r, [0.1, 0.8]));
  let last = startT;
  let pendingBg = 0;
  let calls = 0;
  let spent = 0; // budget used so far, over the agent's whole life
  let burst = true;
  let prevCore: CoreCategory | undefined;

  const emit = (e: TraceEvent): number => {
    events.push(e);
    last = Math.max(last, e.t);
    return events.length - 1;
  };

  /** Seconds from the end of one turn's work to the next turn: a burst/idle two-state chain. */
  const gap = (): number => {
    const g = stats.gaps;
    if (r() >= (burst ? g.continueBurst : g.continueIdle)) burst = !burst;
    const x = sampleQuantiles(burst ? g.burst : g.idle, r);
    return Math.min(burst ? x * pace : x, MAX_IDLE_GAP);
  };

  const pickCategory = (life: number): CallCategory => {
    const due = must.findIndex((m) => life >= m.at);
    if (due >= 0) return must.splice(due, 1)[0].category;
    const density = stats.advisor.position[Math.min(LIFE_BINS - 1, Math.floor(life * LIFE_BINS))] * LIFE_BINS;
    if (r() < Math.min(0.2, stats.advisor.rate * density)) return "advisor";
    if (r() < stats.web.share) return "web";
    const row = prevCore ? stats.core.transitions[prevCore] : stats.core.mix;
    prevCore = CORE_CATEGORIES[pick(CORE_CATEGORIES.map((k) => row[k]), r)];
    return prevCore;
  };

  /** Who allowed a result: mostly a standing rule, sometimes a mode, now and then a human wait. */
  const permission = (): PermissionSource => {
    const x = rd();
    return x < 0.06 ? "user" : x < 0.8 ? "rule" : "auto";
  };
  const thinkMs = () => Math.round(150 + rd() * rd() * 9000);

  const issueCalls = (k: number) => {
    const parallel = k >= 2 && r() < stats.parallelCallProb;
    let latest = cursor;
    for (let j = 0; j < k; j++) {
      const category = pickCategory(spent / plan.budget);
      const tool =
        category === "web" ? (r() < stats.web.search ? "WebSearch" : "WebFetch") : choose(TOOLS[category], r);
      const callT = parallel ? round2(cursor + 0.05 * j) : cursor;
      // A web call carries its query; picked by position, not drawn, so every other draw is unchanged.
      const query = category === "web" ? { excerpt: WEB_QUERIES[events.length % WEB_QUERIES.length] } : {};
      const seq = emit({ t: callT, agent: id, kind: "call", category, tool, ...query });
      calls++;
      const resT = round2(callT + sampleQuantiles(stats.latency[category], r));
      emit({ t: resT, agent: id, kind: "result", category, tool, call: seq, isError: r() < stats.errorRate, permission: permission(), size: Math.round(30 + rd() ** 3 * 24000) });
      if (parallel) latest = Math.max(latest, resT);
      else cursor = round2(resT + uni(r, CALL_STEP));
    }
    if (parallel) cursor = round2(latest + uni(r, CALL_STEP));
  };

  const spawnGroup = (group: number[]) => {
    let fgLatest = -1;
    group.forEach((child, j) => {
      const t = round2(cursor + 0.1 * (j + 1));
      const spawnSeq = emit({ t, agent: id, kind: "spawn", category: "agents", tool: "Agent", child, excerpt: choose(BRIEFS, rd) });
      calls++;
      const retT = runAgent(c, child, t);
      emit({ t: retT, agent: id, kind: "return", child, call: spawnSeq, excerpt: choose(HANDBACKS, r) });
      if (c.agents[child].background) pendingBg = Math.max(pendingBg, retT);
      else fgLatest = Math.max(fgLatest, retT);
    });
    cursor = fgLatest >= 0 ? round2(fgLatest) : round2(cursor + 0.1 * (group.length + 1));
  };

  for (let p = 0; p < phases; p++) {
    if (id === 0) {
      if (p > 0) {
        const human =
          c.preset.forcedIdle && p === 1
            ? uni(r, FORCED_IDLE_GAP)
            : Math.min(MAX_HUMAN_GAP, Math.max(MIN_HUMAN_GAP, sampleQuantiles(stats.humanGap, r)));
        cursor = round2(Math.max(cursor, pendingBg) + human);
      }
      emit({ t: cursor, agent: 0, kind: "prompt", excerpt: choose(PROMPTS, r) });
      cursor = round2(cursor + uni(r, [0.3, 1.5]));
    }
    const lastPhase = p === phases - 1;
    const phaseBudget = Math.floor(plan.budget / phases) + (lastPhase ? plan.budget % phases : 0);
    const groups = plan.groups.filter((_, g) => Math.floor((g * phases) / plan.groups.length) === p);
    let used = 0;
    let gi = 0;
    while (used < phaseBudget || gi < groups.length || (lastPhase && must.length > 0)) {
      const turnT = cursor;
      const usage = makeUsage(c, me.model, r);
      emit({ t: turnT, agent: id, kind: "turn", usage, excerpt: choose(TURN_EXCERPTS, r), thinkMs: thinkMs() });
      for (const key of Object.keys(usage) as (keyof Usage)[]) me.usage[key] += usage[key];
      used++;
      spent++;
      cursor = round2(turnT + uni(r, TURN_THINK));

      let k = pick(stats.callsPerTurn, r);
      k = Math.min(k, Math.max(0, Math.floor((phaseBudget - used) / 2)));
      if (k < 1 && must.some((m) => spent / plan.budget >= m.at)) k = 1;
      issueCalls(k);
      used += 2 * k;
      spent += 2 * k;

      if (gi < groups.length && used >= ((gi + 1) / (groups.length + 1)) * 0.7 * phaseBudget) {
        spawnGroup(groups[gi++]);
      }
      cursor = round2(cursor + gap());
    }
  }

  me.toolCalls = calls;
  if (id === 0) {
    cursor = round2(Math.max(cursor, pendingBg) + uni(r, [0.3, 1.5]));
    emit({ t: cursor, agent: 0, kind: "turn", usage: makeUsage(c, me.model, r), excerpt: choose(TURN_EXCERPTS, r), thinkMs: thinkMs() });
    return last;
  }
  me.returnT = round2(last + uni(r, [0.3, 2]));
  return me.returnT;
}

/**
 * One compaction in the orchestrator's thread, just before one of its later prompts (a long session
 * compacts when its context fills). The event goes in place, so every `call` link past it moves up one.
 */
function addCompaction(events: TraceEvent[], r: Rng): void {
  const prompts = events.flatMap((e, i) => (e.kind === "prompt" && e.agent === 0 && i > 0 ? [i] : []));
  if (prompts.length === 0) return;
  const at = prompts[Math.floor(r() * prompts.length)];
  const preTokens = Math.round(uni(r, [180_000, 900_000]));
  const compact: TraceEvent = {
    t: events[at].t,
    agent: 0,
    kind: "compact",
    compact: {
      trigger: r() < 0.7 ? "auto" : "manual",
      preTokens,
      postTokens: Math.round(uni(r, [8_000, 30_000])),
      durationMs: Math.round(uni(r, [20_000, 90_000])),
    },
  };
  for (let i = 0; i < events.length; i++) {
    const c = events[i].call;
    if (c !== undefined && c >= at) events[i] = { ...events[i], call: c + 1 };
  }
  events.splice(at, 0, compact);
}

/**
 * A seeded sample session. Same seed and size give the same trace. The size fixes the skeleton;
 * `stats` (the committed calibration by default) supplies every distribution inside it.
 */
export function generateTrace(seed: number, size: SampleSize, stats: CalibrationStats = CALIBRATION): SessionTrace {
  const preset = PRESETS[size];
  const streamBase = SIZE_STREAM[size];
  const rs = fork(seed, streamBase);
  const { agents, groupsOf, shapes } = buildAgents(preset, stats, rs);

  const prompts = int(rs, preset.prompts);
  const plans: Plan[] = agents.map((a, i) => ({
    groups: groupsOf[i],
    budget: 0,
    must:
      i === 0
        ? [{ category: "advisor", at: (pick(stats.advisor.position, rs) + rs()) / LIFE_BINS }]
        : i === 1
          ? [{ category: "web", at: rs() * 0.5 }]
          : [],
    prompts: i === 0 ? prompts : 1,
  }));
  const mandatory = 2 * (agents.length - 1) + prompts + 1;
  // Overshoot room: a flushed group turn per group plus forced calls.
  const slack = agents.length + 14;
  const target = int(rs, [preset.events[0] + 5, preset.events[1] - slack]);
  split(plans, shapes, target, mandatory);

  const ctx: Ctx = { stats, shapes, seed, streamBase, agents, plans, events: [], preset };
  runAgent(ctx, 0, 0);

  // Sort by time, creation order breaking ties, then point links at the sorted positions.
  const order = ctx.events.map((_, i) => i).sort((a, b) => ctx.events[a].t - ctx.events[b].t || a - b);
  const pos = new Array<number>(order.length);
  order.forEach((from, to) => (pos[from] = to));
  const events = order.map((from) => {
    const e = ctx.events[from];
    return e.call === undefined ? e : { ...e, call: pos[e.call] };
  });
  if (size === "large") addCompaction(events, fork(seed, COMPACT_STREAM + streamBase));

  const duration = round2(events[events.length - 1].t + uni(rs, [1, 4]));
  agents[0].returnT = duration;

  return {
    version: 1,
    source: "sample",
    label: `Sample ${size}, seed ${seed}`,
    duration,
    agents,
    events,
    truncated: false,
  };
}
