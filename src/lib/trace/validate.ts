import { COMPACT_TRIGGERS, PERMISSION_SOURCES, TRACE_LIMITS, type SessionTrace } from "./types";

const MAX_MESSAGES = 50;
const EPS = 1e-6;

/**
 * Every invariant a trace must hold, as messages; empty is valid. Conventions checked here:
 * `spawn` and `return` events are authored by the parent (`agent` is the parent, `child` the
 * subagent), and a `return` sits at the child's `returnT`.
 */
export function validateTrace(trace: SessionTrace): string[] {
  const out: string[] = [];
  const bad = (msg: string) => {
    if (out.length < MAX_MESSAGES) out.push(msg);
  };
  const { agents, events, duration } = trace;

  if (trace.version !== 1) bad(`version must be 1, got ${String(trace.version)}`);
  if (!Number.isFinite(duration) || duration < 0) bad(`duration ${duration} is not a finite number of seconds`);
  if (events.length > TRACE_LIMITS.events) bad(`${events.length} events exceeds the cap of ${TRACE_LIMITS.events}`);
  if (agents.length > TRACE_LIMITS.agents) bad(`${agents.length} agents exceeds the cap of ${TRACE_LIMITS.agents}`);
  if (agents.length === 0) {
    bad("trace has no agents");
    return out;
  }

  // Agents.
  agents.forEach((a, i) => {
    if (a.id !== i) bad(`agent at index ${i} has id ${a.id}`);
    if (i === 0) {
      if (a.parent !== -1) bad("agent 0 is the orchestrator and must have parent -1");
      if (a.depth !== 0) bad("agent 0 must have depth 0");
    } else if (!(a.parent >= 0 && a.parent < i)) {
      bad(`agent ${i} parent ${a.parent} must be an earlier agent`);
    } else if (a.depth !== agents[a.parent].depth + 1) {
      bad(`agent ${i} depth ${a.depth} is not its parent's depth plus one`);
    }
    if (a.label.length > 80) bad(`agent ${i} label is ${a.label.length} chars, over 80`);
    if (a.spawnT < 0 || a.returnT < a.spawnT) bad(`agent ${i} has returnT before spawnT`);
    if (a.returnT > duration + EPS) bad(`agent ${i} returnT ${a.returnT} is past the duration`);
    if (!a.returned && Math.abs(a.returnT - duration) > EPS) {
      bad(`agent ${i} never returned, so returnT must equal the duration`);
    }
    for (const v of Object.values(a.usage)) {
      if (!(v >= 0)) bad(`agent ${i} has a negative or invalid usage`);
    }
  });

  // Events, in order.
  const spawnOf = new Map<number, number>(); // child -> spawn event index
  const returnOf = new Map<number, number>(); // child -> return event index
  const resultOf = new Map<number, number>(); // call event index -> result event index
  let prevT = -Infinity;
  let excerptBytes = 0;

  events.forEach((e, i) => {
    if (!(e.t >= prevT)) bad(`events are not sorted: event ${i} t=${e.t} follows t=${prevT}`);
    prevT = e.t;
    if (!(e.t >= 0 && e.t <= duration + EPS)) bad(`event ${i} t=${e.t} is outside [0, duration]`);

    const owner = agents[e.agent];
    if (!owner) {
      bad(`event ${i} names agent ${e.agent}, which does not exist`);
      return;
    }
    if (e.agent !== 0 && (e.t < owner.spawnT - EPS || e.t > owner.returnT + EPS)) {
      bad(`event ${i} of agent ${e.agent} at t=${e.t} is outside [spawnT, returnT]`);
    }

    if (e.excerpt !== undefined) {
      const cap = e.kind === "prompt" ? TRACE_LIMITS.prompt : TRACE_LIMITS.excerpt;
      if (e.excerpt.length > cap) bad(`event ${i} excerpt is ${e.excerpt.length} chars, over ${cap}`);
      excerptBytes += e.excerpt.length;
    }

    for (const [name, v] of [["size", e.size], ["thinkMs", e.thinkMs]] as const) {
      if (v !== undefined && !(Number.isFinite(v) && v >= 0)) bad(`event ${i} ${name} ${v} is not a finite, non-negative number`);
    }
    if (e.permission !== undefined && !PERMISSION_SOURCES.includes(e.permission)) {
      bad(`event ${i} permission ${String(e.permission)} is not a known source`);
    }
    if (e.kind === "compact") {
      const c = e.compact;
      if (!c || !COMPACT_TRIGGERS.includes(c.trigger)) bad(`compact event ${i} needs a known trigger`);
      else for (const v of [c.preTokens, c.postTokens, c.durationMs]) {
        if (!(Number.isFinite(v) && v >= 0)) bad(`compact event ${i} has a negative or invalid number`);
      }
    } else if (e.compact !== undefined) bad(`event ${i} is not a compact event but carries compact data`);

    switch (e.kind) {
      case "call":
        if (!e.category || !e.tool) bad(`call event ${i} needs a category and a tool`);
        break;
      case "result": {
        const c = e.call;
        if (c === undefined || !(c >= 0 && c < i) || events[c].kind !== "call" || events[c].agent !== e.agent) {
          bad(`result event ${i} has no matching earlier call by the same agent`);
        } else if (resultOf.has(c)) {
          bad(`call event ${c} has more than one result`);
        } else {
          resultOf.set(c, i);
        }
        break;
      }
      case "spawn": {
        const ch = e.child;
        if (ch === undefined || !agents[ch]) {
          bad(`spawn event ${i} names a child that does not exist`);
        } else if (agents[ch].parent !== e.agent) {
          bad(`spawn event ${i}: agent ${ch} is not a child of agent ${e.agent}`);
        } else if (spawnOf.has(ch)) {
          bad(`agent ${ch} is spawned more than once`);
        } else {
          spawnOf.set(ch, i);
          if (Math.abs(e.t - agents[ch].spawnT) > EPS) bad(`spawn event ${i} is not at agent ${ch} spawnT`);
        }
        break;
      }
      case "return": {
        const ch = e.child;
        if (ch === undefined || !agents[ch]) {
          bad(`return event ${i} names a child that does not exist`);
          break;
        }
        const s = spawnOf.get(ch);
        if (s === undefined || e.call !== s) {
          bad(`return event ${i} has no matching earlier spawn`);
        } else if (returnOf.has(ch)) {
          bad(`agent ${ch} returns more than once`);
        } else {
          returnOf.set(ch, i);
          if (!agents[ch].returned) bad(`return event ${i}: agent ${ch} is marked as never returned`);
          if (Math.abs(e.t - agents[ch].returnT) > EPS) bad(`return event ${i} is not at agent ${ch} returnT`);
        }
        break;
      }
      default:
        break;
    }
  });

  if (excerptBytes > TRACE_LIMITS.excerptBytes) bad(`excerpts total ${excerptBytes} chars, over the cap`);

  // Agent 0 is the root; everyone else needs a spawn, and a return when marked returned.
  for (let i = 1; i < agents.length; i++) {
    if (!spawnOf.has(i)) bad(`agent ${i} has no spawn event`);
    else if (agents[i].returned && !returnOf.has(i)) bad(`agent ${i} is marked returned but has no return event`);
  }
  return out;
}
