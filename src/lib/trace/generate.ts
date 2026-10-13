import { fork, pick, type Rng } from "../rng";
import type { AgentTypeCategory } from "./categories";
import { HANDBACKS, LABEL_NOUNS, LABEL_VERBS, PROMPTS, TURN_EXCERPTS, WEB_QUERIES } from "./phrases";
import type { ModelFamily, SessionTrace, ToolCategory, TraceAgent, TraceEvent, Usage } from "./types";

export type SampleSize = "small" | "medium" | "large";

type Range = readonly [number, number];
/** Every category a plain `call` can carry; subagent launches are `spawn` events. */
type CallCategory = Exclude<ToolCategory, "agents">;

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

/** Everything the generator draws from. A calibrated version replaces `PLACEHOLDER_STATS`. */
export interface GenStats {
  sizes: Record<SampleSize, SizePreset>;
  categoryMix: readonly (readonly [CallCategory, number])[];
  tools: Record<CallCategory, readonly string[]>;
  /** Seconds between a call and its result, per category. */
  latency: Record<CallCategory, Range>;
  errorRate: number;
  /** Weights for 0, 1, 2... calls in one assistant turn. */
  callsPerTurn: readonly number[];
  parallelCallProb: number;
  /** Seconds from a turn to its first call. */
  turnThink: Range;
  /** Seconds from a result to the next turn. */
  resultGap: Range;
  usage: { input: Range; output: Range; cacheRead: Range; cacheWrite: Range };
  usageScale: Record<ModelFamily, number>;
  /** Subagent model weights by depth (1, 2, 3). */
  modelMix: Record<1 | 2 | 3, readonly (readonly [ModelFamily, number])[]>;
  agentTypeMix: readonly (readonly [AgentTypeCategory, number])[];
  backgroundProb: number;
  /** Seconds a human takes between prompts, an idle stretch, and the chance of one. */
  humanGap: Range;
  idleGap: Range;
  idleProb: number;
  forcedIdleGap: Range;
}

/** Flat placeholder distributions. The calibrated `CALIBRATION` replaces this in a later slice. */
export const PLACEHOLDER_STATS: GenStats = {
  sizes: {
    small: { agents: [3, 8], depth: 1, events: [150, 400], prompts: [1, 2], rootGroup: null, minRootChildren: 2, maxGroup: 3, forcedIdle: false },
    medium: { agents: [10, 25], depth: 2, events: [1000, 3000], prompts: [2, 4], rootGroup: null, minRootChildren: 3, maxGroup: 4, forcedIdle: true },
    large: { agents: [40, 120], depth: 3, events: [8000, 20000], prompts: [3, 6], rootGroup: [6, 8], minRootChildren: 8, maxGroup: 5, forcedIdle: true },
  },
  categoryMix: [
    ["shell", 0.3],
    ["files", 0.3],
    ["edit", 0.15],
    ["web", 0.08],
    ["mcp", 0.06],
    ["plan", 0.04],
    ["other", 0.05],
    ["advisor", 0.02],
  ],
  tools: {
    web: ["WebSearch", "WebFetch"],
    shell: ["Bash", "PowerShell"],
    files: ["Read", "Grep", "Glob", "LS"],
    edit: ["Edit", "Write", "MultiEdit", "NotebookEdit"],
    advisor: ["advisor"],
    plan: ["TodoWrite", "ExitPlanMode"],
    mcp: ["mcp__sample__lookup", "mcp__sample__query"],
    other: ["Skill", "ToolSearch"],
  },
  latency: {
    web: [1, 8],
    shell: [0.3, 12],
    files: [0.05, 1.5],
    edit: [0.1, 2],
    advisor: [4, 25],
    plan: [0.05, 0.5],
    mcp: [0.5, 6],
    other: [0.1, 2],
  },
  errorRate: 0.06,
  callsPerTurn: [0.15, 0.35, 0.3, 0.2],
  parallelCallProb: 0.3,
  turnThink: [0.2, 1.5],
  resultGap: [0.05, 0.4],
  usage: { input: [200, 8000], output: [50, 2500], cacheRead: [5000, 120000], cacheWrite: [0, 6000] },
  usageScale: { opus: 1, fable: 1, sonnet: 0.8, haiku: 0.5, other: 0.7 },
  modelMix: {
    1: [["fable", 0.3], ["sonnet", 0.35], ["haiku", 0.2], ["opus", 0.15]],
    2: [["fable", 0.15], ["sonnet", 0.35], ["haiku", 0.4], ["opus", 0.1]],
    3: [["fable", 0.1], ["sonnet", 0.3], ["haiku", 0.55], ["opus", 0.05]],
  },
  agentTypeMix: [
    ["general", 0.3],
    ["explore", 0.25],
    ["plan", 0.1],
    ["build", 0.15],
    ["review", 0.1],
    ["test", 0.1],
  ],
  backgroundProb: 0.2,
  humanGap: [5, 90],
  idleGap: [130, 1500],
  idleProb: 0.3,
  forcedIdleGap: [660, 2400],
};

const SIZE_STREAM: Record<SampleSize, number> = { small: 0, medium: 1000, large: 2000 };

const uni = (r: Rng, [a, b]: Range) => a + r() * (b - a);
const int = (r: Rng, [a, b]: Range) => a + Math.floor(r() * (b - a + 1));
const round2 = (x: number) => Math.round(x * 100) / 100;
const choose = <T>(xs: readonly T[], r: Rng): T => xs[Math.floor(r() * xs.length)];
const pickPair = <T>(pairs: readonly (readonly [T, number])[], r: Rng): T =>
  pairs[pick(pairs.map((p) => p[1]), r)][0];

interface Plan {
  groups: number[][];
  budget: number;
  must: CallCategory[];
  prompts: number;
}

/** The skeleton: who exists, who spawns whom, and in which sibling groups. */
function buildAgents(preset: SizePreset, stats: GenStats, r: Rng): { agents: TraceAgent[]; groupsOf: number[][][] } {
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
    for (let k = 0; k < count; k++) {
      const id = agents.length;
      const parents = byDepth[depth - 1];
      const parent = depth === 1 ? 0 : parents[int(r, [0, parents.length - 1])];
      const model = forcedModels[id - 1] ?? pickPair(stats.modelMix[depth as 1 | 2 | 3], r);
      const label = `${choose(LABEL_VERBS, r)} ${choose(LABEL_NOUNS, r)}`;
      make(id, parent, depth, model, pickPair(stats.agentTypeMix, r), label);
    }
  });

  // Sibling groups: children of one parent spawned together in one orchestrator turn.
  const groupsOf: number[][][] = agents.map(() => []);
  agents.forEach((a) => {
    const kids = agents.filter((k) => k.parent === a.id).map((k) => k.id);
    for (let i = 0; i < kids.length; ) {
      const first = a.id === 0 && i === 0 ? preset.rootGroup : null;
      const size = Math.min(first ? int(r, first) : int(r, [1, a.id === 0 ? preset.maxGroup : 3]), kids.length - i);
      groupsOf[a.id].push(kids.slice(i, i + size));
      i += size;
    }
  });

  // Background children belong to the orchestrator, which outlives them.
  const rootKids = agents.filter((a) => a.parent === 0);
  for (const k of rootKids) k.background = r() < stats.backgroundProb;
  if (!rootKids.some((k) => k.background)) {
    const lastGroup = groupsOf[0][groupsOf[0].length - 1];
    agents[lastGroup[0]].background = true;
  }
  return { agents, groupsOf };
}

function split(budgets: Plan[], agents: TraceAgent[], target: number, mandatory: number, r: Rng) {
  const rest = target - mandatory;
  const mins = budgets.map((p, i) => 4 + 2 * p.must.length + 2 * p.groups.length + (i === 0 ? 4 * p.prompts : 0));
  const extra = Math.max(0, rest - mins.reduce((a, b) => a + b, 0));
  const weights = agents.map(() => 0.2 + r() ** 2 * 2);
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
  stats: GenStats;
  seed: number;
  streamBase: number;
  agents: TraceAgent[];
  plans: Plan[];
  events: TraceEvent[];
  preset: SizePreset;
}

const CALL_WEIGHTS = (stats: GenStats) => stats.categoryMix.map((m) => m[1]);

function makeUsage(c: Ctx, model: ModelFamily, r: Rng): Usage {
  const s = c.stats.usageScale[model];
  const u = c.stats.usage;
  return {
    input: Math.round(uni(r, u.input) * s),
    output: Math.round(uni(r, u.output) * s),
    cacheRead: Math.round(uni(r, u.cacheRead) * s),
    cacheWrite: Math.round(uni(r, u.cacheWrite) * s),
  };
}

/** Runs one agent from `startT` and returns its returnT (the session's last event time for the orchestrator). */
function runAgent(c: Ctx, id: number, startT: number): number {
  const { stats, events } = c;
  const me = c.agents[id];
  const plan = c.plans[id];
  const r = fork(c.seed, c.streamBase + 100 + id);
  const callWeights = CALL_WEIGHTS(stats);
  const must = [...plan.must];
  const phases = id === 0 ? plan.prompts : 1;

  me.spawnT = startT;
  let cursor = id === 0 ? startT : round2(startT + uni(r, [0.1, 0.8]));
  let last = startT;
  let pendingBg = 0;
  let calls = 0;

  const emit = (e: TraceEvent): number => {
    events.push(e);
    last = Math.max(last, e.t);
    return events.length - 1;
  };

  const issueCalls = (k: number) => {
    const parallel = k >= 2 && r() < stats.parallelCallProb;
    let latest = cursor;
    for (let j = 0; j < k; j++) {
      const category = must.length ? must.shift()! : stats.categoryMix[pick(callWeights, r)][0];
      const tool = choose(stats.tools[category], r);
      const callT = parallel ? round2(cursor + 0.05 * j) : cursor;
      // A web call carries its query; picked by position, not drawn, so every other draw is unchanged.
      const query = category === "web" ? { excerpt: WEB_QUERIES[events.length % WEB_QUERIES.length] } : {};
      const seq = emit({ t: callT, agent: id, kind: "call", category, tool, ...query });
      calls++;
      const resT = round2(callT + uni(r, stats.latency[category]));
      emit({ t: resT, agent: id, kind: "result", category, tool, call: seq, isError: r() < stats.errorRate });
      if (parallel) latest = Math.max(latest, resT);
      else cursor = round2(resT + uni(r, stats.resultGap));
    }
    if (parallel) cursor = round2(latest + uni(r, stats.resultGap));
  };

  const spawnGroup = (group: number[]) => {
    let fgLatest = -1;
    group.forEach((child, j) => {
      const t = round2(cursor + 0.1 * (j + 1));
      const spawnSeq = emit({ t, agent: id, kind: "spawn", category: "agents", tool: "Agent", child });
      calls++;
      const retT = runAgent(c, child, t);
      emit({ t: retT, agent: id, kind: "return", child, call: spawnSeq, excerpt: choose(HANDBACKS, r) });
      if (c.agents[child].background) pendingBg = Math.max(pendingBg, retT);
      else fgLatest = Math.max(fgLatest, retT);
    });
    cursor = fgLatest >= 0 ? round2(fgLatest + uni(r, [0.1, 0.6])) : round2(cursor + 0.1 * (group.length + 1) + 0.3);
  };

  for (let p = 0; p < phases; p++) {
    if (id === 0) {
      if (p > 0) {
        const idle =
          c.preset.forcedIdle && p === 1
            ? uni(r, stats.forcedIdleGap)
            : r() < stats.idleProb
              ? uni(r, stats.idleGap)
              : uni(r, stats.humanGap);
        cursor = round2(Math.max(cursor, pendingBg) + idle);
      }
      emit({ t: cursor, agent: 0, kind: "prompt", excerpt: choose(PROMPTS, r) });
      cursor = round2(cursor + uni(r, [0.3, 1.5]));
    }
    const phaseBudget = Math.floor(plan.budget / phases) + (p === phases - 1 ? plan.budget % phases : 0);
    const groups = plan.groups.filter((_, g) => Math.floor((g * phases) / plan.groups.length) === p);
    let used = 0;
    let gi = 0;
    while (used < phaseBudget || gi < groups.length) {
      const turnT = cursor;
      const usage = makeUsage(c, me.model, r);
      emit({ t: turnT, agent: id, kind: "turn", usage, excerpt: choose(TURN_EXCERPTS, r) });
      for (const key of Object.keys(usage) as (keyof Usage)[]) me.usage[key] += usage[key];
      used++;
      cursor = round2(turnT + uni(r, stats.turnThink));

      let k = pick(stats.callsPerTurn, r);
      k = Math.min(k, Math.max(0, Math.floor((phaseBudget - used) / 2)));
      if (must.length && k < 1) k = 1;
      issueCalls(k);
      used += 2 * k;

      if (gi < groups.length && used >= ((gi + 1) / (groups.length + 1)) * 0.7 * phaseBudget) {
        spawnGroup(groups[gi++]);
      }
    }
  }

  me.toolCalls = calls;
  if (id === 0) {
    cursor = round2(Math.max(cursor, pendingBg) + uni(r, [0.3, 1.5]));
    emit({ t: cursor, agent: 0, kind: "turn", usage: makeUsage(c, me.model, r), excerpt: choose(TURN_EXCERPTS, r) });
    return last;
  }
  me.returnT = round2(last + uni(r, [0.3, 2]));
  return me.returnT;
}

/**
 * A seeded sample session. Same seed and size give the same trace; `stats` supplies the
 * distributions (placeholders until calibration lands).
 */
export function generateTrace(seed: number, size: SampleSize, stats: GenStats = PLACEHOLDER_STATS): SessionTrace {
  const preset = stats.sizes[size];
  const streamBase = SIZE_STREAM[size];
  const rs = fork(seed, streamBase);
  const { agents, groupsOf } = buildAgents(preset, stats, rs);

  const prompts = int(rs, preset.prompts);
  const plans: Plan[] = agents.map((a, i) => ({
    groups: groupsOf[i],
    budget: 0,
    must: i === 0 ? ["advisor"] : i === 1 ? ["web"] : [],
    prompts: i === 0 ? prompts : 1,
  }));
  const mandatory = 2 * (agents.length - 1) + prompts + 1;
  // Overshoot room: a flushed group turn per group plus forced calls.
  const slack = agents.length + 14;
  const target = int(rs, [preset.events[0] + 5, preset.events[1] - slack]);
  split(plans, agents, target, mandatory, fork(seed, streamBase + 1));

  const ctx: Ctx = { stats, seed, streamBase, agents, plans, events: [], preset };
  runAgent(ctx, 0, 0);

  // Sort by time, creation order breaking ties, then point links at the sorted positions.
  const order = ctx.events.map((_, i) => i).sort((a, b) => ctx.events[a].t - ctx.events[b].t || a - b);
  const pos = new Array<number>(order.length);
  order.forEach((from, to) => (pos[from] = to));
  const events = order.map((from) => {
    const e = ctx.events[from];
    return e.call === undefined ? e : { ...e, call: pos[e.call] };
  });

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
