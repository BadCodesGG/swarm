"use client";

import type { InsideApp } from "@/engine/inside/app";
import { clock, compact, shortClock } from "@/engine/inside/format";
import { useClock, useTimeline } from "./use-engine";

/** ELAPSED, TOKENS, TOOL CALLS and AGENTS ("5 live / 19") at the playhead. `compact` is the phone's four-up grid. */
export function Counters({ app, compact: small = false }: { app: InsideApp; compact?: boolean }) {
  const tl = useTimeline(app);
  const { t } = useClock(app);
  const c = tl.countersAt(t);
  const live = c.agentsActive - 1;

  if (small) {
    return (
      <dl className="m-0 grid grid-cols-4 gap-1.5 font-mono" aria-label="Counters">
        <Item label="TIME" tight>
          {shortClock(c.elapsed)}
        </Item>
        <Item label="TOKENS" tight>
          {compact(c.tokens)}
        </Item>
        <Item label="CALLS" tight>
          {c.toolCalls}
        </Item>
        <Item label="AGENTS" tight>
          {live}
          <span className="text-faint">/{c.agentsSpawned}</span>
        </Item>
      </dl>
    );
  }
  return (
    <dl className="m-0 flex flex-wrap gap-x-7 gap-y-2 font-mono" aria-label="Counters">
      <Item label="ELAPSED">{clock(c.elapsed)}</Item>
      <Item label="TOKENS">{compact(c.tokens)}</Item>
      <Item label="TOOL CALLS">{c.toolCalls}</Item>
      <Item label="AGENTS">
        {live} live <span className="text-faint">/ {c.agentsSpawned}</span>
      </Item>
    </dl>
  );
}

function Item({ label, tight = false, children }: { label: string; tight?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col ${tight ? "gap-0.5" : "gap-[3px]"}`}>
      <dt className={`text-[10px] text-faint ${tight ? "tracking-[0.08em]" : "tracking-[0.12em]"}`}>{label}</dt>
      <dd className={`m-0 tabular-nums ${tight ? "text-sm" : "text-lg font-medium"}`}>{children}</dd>
    </div>
  );
}
