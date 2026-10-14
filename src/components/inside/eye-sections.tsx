"use client";

import { useMemo } from "react";
import type { InsideApp } from "@/engine/inside/app";
import { agentEye } from "@/engine/inside/agent-eye";
import { clock, compact } from "@/engine/inside/format";
import { waitingShare } from "./charts";
import { lanesOf } from "./trace-memo";
import { useTimeline } from "./use-engine";

const label = "font-mono text-[10px] tracking-[0.12em] text-faint";
const note = "m-0 text-xs leading-snug text-label";

/**
 * What the trace supports about the agent's own view: what it was told (the brief, shown by the
 * card), what came back, who ran beside it, how much of its time was spent waiting on you, and for
 * the orchestrator, where its context was summarised. Text from the session renders as text only.
 */
export function EyeSections({ app, id, returned }: { app: InsideApp; id: number; returned: boolean }) {
  const tl = useTimeline(app);
  const eye = useMemo(() => agentEye(tl.trace, id), [tl, id]);
  const lane = useMemo(() => lanesOf(tl.trace).find((l) => l.agent === id), [tl, id]);
  if (!eye) return null;
  const orchestrator = id === 0;
  const waiting = lane ? lane.segments.reduce((n, s) => (s.kind === "waiting-on-you" ? n + (s.end - s.start) : n), 0) : 0;
  const total = lane ? lane.end - lane.start : 0;

  return (
    <>
      {orchestrator ? null : (
        <>
          <p className={note} data-eye="blank">
            A subagent starts blank. It sees only this: not the conversation before it, not what its siblings are doing.
          </p>
          <div className="flex flex-col gap-1.5" data-eye="report">
            <span className={label}>ONLY THIS CAME BACK</span>
            {eye.report && returned ? (
              <>
                <p className="m-0 rounded-lg bg-white/4 px-2.5 py-2 font-mono text-xs leading-normal text-ink [overflow-wrap:anywhere]">{eye.report.excerpt || "(no text kept)"}</p>
                <p className={note}>
                  Handed back at {clock(eye.report.t)}. Its parent saw this report and nothing else of its work
                  {eye.report.size >= 280 ? "; the trace keeps the first 280 characters" : ""}.{" "}
                  <button
                    type="button"
                    onClick={() => app.seek(eye.report!.t)}
                    className="border-0 bg-transparent p-0 font-mono text-xs text-sonnet underline outline-none focus-visible:ring-2 focus-visible:ring-layer-1"
                  >
                    Go to the report
                  </button>
                </p>
              </>
            ) : eye.report ? (
              <p className={note}>Not back yet. It returns at {clock(eye.report.t)}.</p>
            ) : (
              <p className={note}>It never handed anything back in this trace.</p>
            )}
          </div>
          {eye.siblings.length > 0 ? (
            <p className={note} data-eye="siblings">
              {eye.siblings.length} {eye.siblings.length === 1 ? "sibling" : "siblings"} ran in parallel with it and never saw each other.
            </p>
          ) : null}
        </>
      )}

      {orchestrator && eye.compactions.length > 0 ? (
        <div className="flex flex-col gap-1.5" data-eye="compactions">
          <span className={label}>CONTEXT SUMMARISED</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {eye.compactions.map((c) => (
              <li key={c.t} className="flex flex-col gap-0.5 font-mono text-xs">
                <button
                  type="button"
                  onClick={() => app.seek(c.t)}
                  className="w-fit border-0 bg-transparent p-0 text-left text-escape-text underline outline-none focus-visible:ring-2 focus-visible:ring-layer-1"
                >
                  {clock(c.t)}: {compact(c.preTokens)} to {compact(c.postTokens)} tokens
                </button>
                <span className="font-sans text-[11px] text-label">Earlier detail was summarised here.</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className={note} data-eye="waiting">
        Waiting on you: <span className="font-mono text-ink">{waitingShare(waiting, total)}</span> of its time.
      </p>
    </>
  );
}
