"use client";

import { useCallback, type CSSProperties } from "react";
import type { InsideApp } from "@/engine/inside/app";
import { agentInfo, type AgentInfo } from "@/engine/inside/agent-info";
import { CATEGORY_LABELS, clock, compact, MODEL_NAMES, MODEL_VARS, runClock } from "@/engine/inside/format";
import { useEngineSnapshot, useTimeline } from "./use-engine";

/** Bar colours for the most, second and third most used tool categories. */
const MIX_COLOURS = ["#eef2f8", "#8590a3", "#4a5470"];

const key = (i: AgentInfo | null) =>
  i ? [i.id, i.state, Math.floor(i.running), i.tokens, i.calls, i.helpers, i.lastCall?.t, i.mix.map((m) => `${m.category}${m.count}`).join()].join("|") : "";
const sameInfo = (a: AgentInfo | null, b: AgentInfo | null) => key(a) === key(b);

const STATE_PILL = { running: "RUNNING", returned: "RETURNED", waiting: "NOT STARTED" } as const;

const mono = "font-mono";
const sectionLabel = `${mono} text-[10px] tracking-[0.12em] text-faint`;

/** Live numbers for one agent, re-read a few times a second. */
function useAgentInfo(app: InsideApp, id: number): AgentInfo | null {
  const read = useCallback(() => agentInfo(app.timeline(), id, app.time()), [app, id]);
  return useEngineSnapshot(read, sameInfo, 200);
}

/** The selected agent as a one-line collapsed bar (the phone's bottom sheet handle). */
export function AgentBar({ app, id, expanded, onToggle }: { app: InsideApp; id: number; expanded: boolean; onToggle: () => void }) {
  const info = useAgentInfo(app, id);
  if (!info) return null;
  const m = MODEL_VARS[info.model];
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={`Selected agent: ${info.label}`}
      onClick={onToggle}
      style={{ borderColor: `color-mix(in srgb, ${m} 40%, transparent)` }}
      className="pointer-events-auto grid min-h-14 grid-cols-[10px_minmax(0,1fr)_auto_16px] items-center gap-2.5 rounded-[14px] border bg-[rgba(12,16,28,0.86)] px-3.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-layer-1"
    >
      <span className="size-2.5 rounded-full" style={{ background: m, boxShadow: `0 0 10px ${m}` }} />
      <span className="flex min-w-0 flex-col gap-px">
        <span className="truncate text-[15px] font-bold">{info.label}</span>
        <span className={`${mono} truncate text-[11px] text-label`}>
          {MODEL_NAMES[info.model]}, {info.state === "returned" ? "ran" : "running"} {runClock(info.running)}, {info.calls} calls
        </span>
      </span>
      <Pill info={info} />
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className={expanded ? "rotate-180" : ""}>
        <path d="M4 10l4-4 4 4" fill="none" stroke="#a7b1c2" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function Pill({ info }: { info: AgentInfo }) {
  const m = MODEL_VARS[info.model];
  return (
    <span
      className={`${mono} rounded-full px-2 py-[3px] text-[10px] tracking-[0.1em]`}
      style={{ background: `color-mix(in srgb, ${m} 14%, transparent)`, color: `color-mix(in srgb, ${m} 70%, white)` }}
    >
      {STATE_PILL[info.state]}
    </span>
  );
}

/**
 * The selected agent: label, model, state, running time, tokens, calls, helpers, tool mix, the
 * brief it was given and its last call, with Follow and Jump. Session text is React text only.
 */
export function DetailCard({
  app,
  id,
  onClose,
  sheet = false,
}: {
  app: InsideApp;
  id: number;
  onClose: () => void;
  /** Rendered inside the phone's bottom sheet: the sheet supplies the frame. */
  sheet?: boolean;
}) {
  const tl = useTimeline(app);
  const info = useAgentInfo(app, id);
  const readFollow = useCallback(() => app.following(), [app]);
  const following = useEngineSnapshot(readFollow, Object.is, 100);
  if (!info) return null;

  const m = MODEL_VARS[info.model];
  const total = info.mix.reduce((n, x) => n + x.count, 0);
  const top = info.mix.slice(0, 3);
  const parent = tl.trace.agents[id]?.parent ?? 0;
  const frame: CSSProperties = sheet
    ? {}
    : { borderColor: `color-mix(in srgb, ${m} 40%, transparent)`, boxShadow: `0 0 0 1px color-mix(in srgb, ${m} 8%, transparent), 0 18px 48px rgba(0, 0, 0, 0.45)` };

  return (
    <aside
      aria-label="Selected agent"
      data-detail-card
      style={frame}
      className={`pointer-events-auto flex flex-col gap-3.5 ${
        sheet ? "" : "box-border w-80 max-w-full self-end rounded-[14px] border bg-[rgba(12,16,28,0.84)] p-[18px] backdrop-blur-[10px]"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-[7px] size-2.5 shrink-0 rounded-full" style={{ background: m, boxShadow: `0 0 10px ${m}` }} />
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <h2 className="m-0 text-[19px] font-bold tracking-[-0.01em] [overflow-wrap:anywhere]">{info.label}</h2>
          <span className={`${mono} text-xs text-label`}>{MODEL_NAMES[info.model]}</span>
        </div>
        <Pill info={info} />
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="-mt-3 -mr-3 flex size-11 shrink-0 items-center justify-center border-0 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-layer-1"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="#a7b1c2" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <dl className={`${mono} m-0 grid grid-cols-4 gap-2`}>
        <Stat label="running" value={runClock(info.running)} />
        <Stat label="tokens" value={compact(info.tokens)} />
        <Stat label="calls" value={String(info.calls)} />
        <Stat label="helpers" value={String(info.helpers)} />
      </dl>

      <div className="flex flex-col gap-1.5">
        <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-[3px] bg-white/6" role="img" aria-label="Tool mix">
          {top.map((x, i) => (
            <span key={x.category} style={{ flex: `${x.count} 1 0`, background: MIX_COLOURS[i] }} />
          ))}
        </div>
        <div className={`${mono} flex gap-3.5 text-[11px] text-label`}>
          {total === 0 ? (
            <span>no calls yet</span>
          ) : (
            top.map((x) => (
              <span key={x.category}>
                {CATEGORY_LABELS[x.category]} {x.count}
              </span>
            ))
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={sectionLabel}>{parent === 0 ? "BRIEF FROM THE ORCHESTRATOR" : "BRIEF FROM ITS PARENT"}</span>
        <p className="m-0 text-sm leading-normal text-body [overflow-wrap:anywhere]" data-brief>
          {info.brief}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={sectionLabel}>{info.lastCall ? `LAST CALL, ${clock(info.lastCall.t)}` : "LAST CALL"}</span>
        <p className={`${mono} m-0 rounded-lg bg-white/4 px-2.5 py-2 text-xs leading-normal text-ink [overflow-wrap:anywhere]`}>
          {info.lastCall ? info.lastCall.text : "None yet"}
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          aria-pressed={following === id}
          onClick={() => app.follow(following === id ? -1 : id)}
          className="min-h-11 flex-1 rounded-[10px] border-0 text-sm font-bold text-[#0b0718] outline-none focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:ring-offset-2 focus-visible:ring-offset-ground"
          style={{ background: m }}
        >
          {following === id ? "Following" : "Follow"}
        </button>
        <button
          type="button"
          onClick={() => app.seek(info.spawnT)}
          className="min-h-11 flex-1 rounded-[10px] border border-[rgba(150,172,214,0.22)] bg-transparent text-sm text-body outline-none hover:border-[rgba(150,172,214,0.4)] focus-visible:ring-2 focus-visible:ring-layer-1"
        >
          Jump to its start
        </button>
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] text-faint">{label}</dt>
      <dd className="m-0 text-[15px]">{value}</dd>
    </div>
  );
}
