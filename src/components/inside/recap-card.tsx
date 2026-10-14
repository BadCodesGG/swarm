"use client";

import { useEffect, useState } from "react";
import type { InsideApp } from "@/engine/inside/app";
import { clock, compact, MODEL_NAMES, MODEL_VARS, runClock } from "@/engine/inside/format";
import { MODEL_FAMILIES } from "@/lib/trace/categories";
import { recapOf } from "./trace-memo";
import { useTimeline } from "./use-engine";

/** Within this many trace seconds of the end the run counts as finished. */
const END_SLACK = 0.5;

/** True once playback has reached the end of the run and the visitor has not dismissed the recap; leaving the end (a seek, a new trace) re-arms it. */
export function useRecapVisible(app: InsideApp): [boolean, () => void] {
  const [state, setState] = useState({ atEnd: false, dismissed: false });
  useEffect(() => {
    const id = window.setInterval(() => {
      const tl = app.timeline();
      const atEnd = tl.duration > 0 && app.time() >= tl.duration - END_SLACK;
      setState((prev) => (prev.atEnd === atEnd ? prev : { atEnd, dismissed: atEnd ? prev.dismissed : false }));
    }, 100);
    return () => window.clearInterval(id);
  }, [app]);
  return [state.atEnd && !state.dismissed, () => setState((prev) => ({ ...prev, dismissed: true }))];
}

const share = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)}%` : "0%");

/** The end-of-run recap: what the run was, from the trace's own numbers. Dismissable. */
export function RecapCard({ app, onClose, sheet = false }: { app: InsideApp; onClose: () => void; sheet?: boolean }) {
  const tl = useTimeline(app);
  const r = recapOf(tl.trace);
  const tokens = MODEL_FAMILIES.reduce((n, m) => n + r.tokensByModel[m], 0);
  const time = r.time.think + r.time.tool + r.time.waiting;
  const wait = r.longestWait;

  return (
    <aside
      aria-label="Run recap"
      data-recap
      className={`pointer-events-auto flex min-h-0 flex-col gap-3 overflow-y-auto border-panel-border ${
        sheet ? "rounded-[14px] border bg-[rgba(12,16,28,0.9)] p-3.5" : "box-border w-80 max-w-full rounded-[14px] border bg-[rgba(12,16,28,0.84)] p-[18px] backdrop-blur-[10px]"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <span className="font-mono text-[10px] tracking-[0.14em] text-opus">THE RUN, IN BRIEF</span>
          <h2 className="m-0 text-[17px] font-bold tracking-[-0.01em]">{clock(tl.duration)} end to end</h2>
        </div>
        <button
          type="button"
          aria-label="Dismiss recap"
          onClick={onClose}
          className="-mt-3 -mr-3 flex size-11 shrink-0 items-center justify-center border-0 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-layer-1"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="#a7b1c2" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <dl className="m-0 grid grid-cols-4 gap-2 font-mono">
        <Stat label="spawned" value={String(r.agentsSpawned)} />
        <Stat label="peak at once" value={String(r.peakParallel)} />
        <Stat label="failed calls" value={String(r.failedCalls)} />
        <Stat label="compactions" value={String(r.compactions)} />
      </dl>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] tracking-[0.12em] text-faint">TOKENS BY MODEL</span>
        <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-[3px] bg-white/6" role="img" aria-label="Tokens by model">
          {MODEL_FAMILIES.filter((m) => r.tokensByModel[m] > 0).map((m) => (
            <span key={m} style={{ flex: `${r.tokensByModel[m]} 1 0`, background: MODEL_VARS[m] }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3.5 gap-y-0.5 font-mono text-[11px] text-label">
          {MODEL_FAMILIES.filter((m) => r.tokensByModel[m] > 0).map((m) => (
            <span key={m}>
              <span style={{ color: MODEL_VARS[m] }}>{MODEL_NAMES[m]}</span> {compact(r.tokensByModel[m])}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] tracking-[0.12em] text-faint">LONGEST WAIT</span>
        <p className="m-0 text-[13px] leading-snug text-body">
          {wait ? (
            <>
              {wait.text}: <span className="font-mono">{runClock(wait.duration)}</span>, from {clock(wait.t)}.
            </>
          ) : (
            "Nothing waited on you in this run."
          )}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] tracking-[0.12em] text-faint">WHERE THE AGENT-TIME WENT</span>
        <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-[3px] bg-white/6" role="img" aria-label="Think, tool and waiting time">
          <span style={{ flex: `${r.time.think} 1 0`, background: "var(--rule)" }} />
          <span style={{ flex: `${r.time.tool} 1 0`, background: "var(--ink)" }} />
          <span style={{ flex: `${r.time.waiting} 1 0`, background: "var(--opus)" }} />
        </div>
        <div className="flex flex-wrap gap-x-3.5 gap-y-0.5 font-mono text-[11px] text-label">
          <span>thinking {share(r.time.think, time)}</span>
          <span>tools {share(r.time.tool, time)}</span>
          <span className="text-opus">waiting on you {share(r.time.waiting, time)}</span>
        </div>
      </div>
      <p className="m-0 font-mono text-[10px] text-faint">{compact(tokens)} tokens in all</p>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] text-faint">{label}</dt>
      <dd className="m-0 text-[17px]">{value}</dd>
    </div>
  );
}
