"use client";

import { useCallback, useMemo } from "react";
import type { InsideApp } from "@/engine/inside/app";
import { CATEGORY_LABELS, MODEL_VARS, shortClock } from "@/engine/inside/format";
import type { StationCategory } from "@/engine/inside/layout";
import { agentName } from "@/engine/inside/roster";
import { callDuration, resultSize } from "./charts";
import { callsOf, startedBy } from "./trace-memo";
import { useEngineSnapshot, useTimeline } from "./use-engine";

/** Rows drawn at most; the newest first, the rest counted. */
const MAX_ROWS = 120;

/**
 * One tool station's calls so far: who made each, which tool, when, how long it took, how big the
 * result was and whether it failed. No arguments are shown: the trace keeps none, except a launch's
 * brief, which its agent's card shows.
 */
export function StationPanel({ app, station, onClose, sheet = false }: { app: InsideApp; station: StationCategory; onClose: () => void; sheet?: boolean }) {
  const tl = useTimeline(app);
  const all = useMemo(() => callsOf(tl.trace, station), [tl, station]);
  const read = useCallback(() => startedBy(all, app.time()), [app, all]);
  const started = useEngineSnapshot(read, Object.is, 250);
  const shown = useMemo(() => all.slice(Math.max(0, started - MAX_ROWS), started).reverse(), [all, started]);
  const failed = useMemo(() => all.slice(0, started).filter((c) => c.isError).length, [all, started]);

  return (
    <aside
      aria-label={`${CATEGORY_LABELS[station]} station`}
      data-station-panel={station}
      className={`pointer-events-auto flex min-h-0 flex-col gap-2.5 ${sheet ? "" : "box-border w-80 max-w-full rounded-[14px] border border-panel-border bg-panel p-[18px] backdrop-blur-[10px]"}`}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <h2 className="m-0 text-[19px] font-bold tracking-[-0.01em]">{CATEGORY_LABELS[station]} station</h2>
          <span className="font-mono text-xs text-label">
            {started} {started === 1 ? "call" : "calls"} so far{failed > 0 ? `, ${failed} failed` : ""}
          </span>
        </div>
        <button
          type="button"
          aria-label="Close station"
          onClick={onClose}
          className="-mt-3 -mr-3 flex size-11 shrink-0 items-center justify-center border-0 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-layer-1"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="#a7b1c2" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <p className="m-0 text-[11px] leading-snug text-faint">
        {station === "agents"
          ? "A launch's brief and hand-back are kept only as their first 280 characters, on the agent's card. Every other call here keeps no arguments or results, only when it ran, how long it took and how big its result was."
          : "The trace keeps no arguments or results, only that a call happened, how long it took and how big its result was."}
      </p>
      <div className="grid grid-cols-[46px_minmax(0,1fr)_44px_38px] gap-x-2 font-mono text-[9px] tracking-[0.12em] text-faint" aria-hidden="true">
        <span>TIME</span>
        <span>AGENT, TOOL</span>
        <span className="text-right">TOOK</span>
        <span className="text-right">SIZE</span>
      </div>
      <ul className="m-0 flex min-h-0 list-none flex-col gap-1 overflow-y-auto p-0 font-mono text-[11px]" data-station-calls>
        {shown.length === 0 ? <li className="text-faint">No call has reached this station yet.</li> : null}
        {shown.map((c) => (
          <li key={c.index} data-call className="grid grid-cols-[46px_minmax(0,1fr)_44px_38px] items-baseline gap-x-2" aria-label={c.isError ? "failed call" : undefined}>
            <span className="text-faint">{shortClock(c.start)}</span>
            <span className="truncate" title={`${agentName(tl.trace, c.agent)} ${c.tool}`}>
              <span style={{ color: MODEL_VARS[tl.trace.agents[c.agent]?.model ?? "other"] }}>{agentName(tl.trace, c.agent)}</span> <span className="text-body">{c.tool}</span>
              {c.isError ? <span className="ml-1.5 rounded-sm bg-error/15 px-1 text-[9px] text-error">ERROR</span> : null}
            </span>
            <span className="text-right text-muted">{c.resolved ? callDuration(c.duration) : "-"}</span>
            <span className="text-right text-muted">{resultSize(c.size)}</span>
          </li>
        ))}
        {started > shown.length ? <li className="text-faint">{started - shown.length} earlier calls not listed</li> : null}
      </ul>
    </aside>
  );
}
