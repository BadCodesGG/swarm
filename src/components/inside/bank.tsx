"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import type { InsideApp } from "@/engine/inside/app";
import { CATEGORY_LABELS, clock, compact, MODEL_NAMES, MODEL_VARS, shortClock } from "@/engine/inside/format";
import { buildInstruments, type LogLine } from "@/engine/inside/instruments";
import { STATIONS, type StationCategory } from "@/engine/inside/layout";
import { agentName, rosterAt } from "@/engine/inside/roster";
import type { ModelFamily, ToolCategory } from "@/lib/trace/types";
import { arcPath, radarPoints, sparkPath, toolRows } from "./charts";
import { lanesOf } from "./trace-memo";
import { useEngineSnapshot, useTimeline } from "./use-engine";

/** The instruments are O(log n) reads; React hears about them about ten times a second. */
const BANK_MS = 100;
const SERIES = 60;
const RADAR: ModelFamily[] = ["opus", "sonnet", "haiku", "fable"];

const TOOL_TONE: Partial<Record<ToolCategory, string>> = {
  web: "var(--sonnet)",
  edit: "var(--haiku)",
  agents: "var(--fable)",
  advisor: "var(--opus)",
  plan: "var(--opus)",
  shell: "var(--ink)",
  files: "var(--body)",
};

interface LiveAgent {
  id: number;
  label: string;
  model: ModelFamily;
  tokens: number;
}

interface BankSnap {
  key: string;
  t: number;
  live: number;
  spawned: number;
  calls: number;
  rate: number;
  context: { tokens: number; fraction: number };
  toolMix: Record<ToolCategory, number>;
  modelMix: Record<ModelFamily, number>;
  agents: LiveAgent[];
  log: LogLine[];
}

function useBank(app: InsideApp): BankSnap {
  const tl = useTimeline(app);
  const ins = useMemo(() => buildInstruments(tl), [tl]);
  const read = useCallback((): BankSnap => {
    const t = app.time();
    const { spawned, active } = ins.agentsAt(t);
    const toolMix = ins.toolMixAt(t);
    const agents = rosterAt(tl, t)
      .filter((e) => e.id > 0 && e.status === "working")
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 6)
      .map((e) => ({ id: e.id, label: e.label, model: e.model, tokens: e.tokens }));
    const data = {
      t,
      live: Math.max(0, active - 1),
      spawned,
      calls: Object.values(toolMix).reduce((n, x) => n + x, 0),
      rate: ins.tokensPerMinuteAt(t),
      context: ins.contextAt(t),
      toolMix,
      modelMix: ins.modelMixAt(t),
      agents,
      log: ins.logAt(t, 6),
    };
    // The playhead alone does not change the picture (the sparklines' "now" marker aside, which a
    // 10 Hz poll catches by its own value changing): the key is the numbers the panels print.
    const key = JSON.stringify({ ...data, t: Math.round(t), log: data.log.map((l) => [l.t, l.text]), rate: Math.round(data.rate / 100) });
    return { ...data, key };
  }, [app, tl, ins]);
  return useEngineSnapshot(read, (a, b) => a.key === b.key, BANK_MS);
}

const frame = "flex h-[132px] min-w-0 flex-col gap-1.5 overflow-hidden rounded-[10px] border border-panel-border bg-panel px-3 py-2.5 font-mono";

function Panel({ title, value, valueClass = "", children, label }: { title: string; value?: ReactNode; valueClass?: string; children: ReactNode; label: string }) {
  return (
    <section aria-label={label} className={frame}>
      <header className="flex items-baseline justify-between text-[9px] tracking-[0.16em] text-faint">
        <span>{title}</span>
        <span className={valueClass}>{value}</span>
      </header>
      {children}
    </section>
  );
}

/** The six instruments. `onStation` makes the tool-mix rows buttons that open a station's call list. */
export function BankPanels({ app, onStation, narrow = false, id }: { app: InsideApp; onStation: (key: StationCategory) => void; narrow?: boolean; id: string }) {
  const tl = useTimeline(app);
  const s = useBank(app);
  const ins = useMemo(() => buildInstruments(tl), [tl]);
  const rateSeries = useMemo(() => ins.tokensPerMinuteSeries(SERIES), [ins]);
  const ctxSeries = useMemo(() => Array.from({ length: SERIES }, (_, i) => ins.contextAt((i / (SERIES - 1)) * tl.duration).fraction), [ins, tl]);
  const compactions = useMemo(() => lanesOf(tl.trace).find((l) => l.agent === 0)?.compactions ?? [], [tl]);
  const duration = tl.duration || 1;
  const nowX = Math.min(200, Math.max(0, (s.t / duration) * 200));

  const rows = toolRows(s.toolMix);
  const totalTokens = RADAR.reduce((n, m) => n + s.modelMix[m], 0);
  const radar = radarPoints(
    RADAR.map((m) => s.modelMix[m]),
    100,
    56,
    40,
  );
  const pct = (m: ModelFamily) => (totalTokens > 0 ? Math.round((s.modelMix[m] / totalTokens) * 100) : 0);
  const lastCompaction = [...compactions].reverse().find((c) => c.t <= s.t);
  const ctxPct = Math.round(s.context.fraction * 100);

  return (
    <div id={id} data-bank className={`grid gap-2 ${narrow ? "grid-cols-2" : "grid-cols-6"}`}>
      <Panel title="AGENTS" label="Agents running" value={`${s.live} live`} valueClass="text-haiku">
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[10px] text-body">
          {s.agents.length === 0 ? <li className="text-faint">none running</li> : null}
          {s.agents.map((a) => (
            <li key={a.id} className="flex items-center gap-1.5">
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: MODEL_VARS[a.model] }} />
              <span className="min-w-0 grow truncate">{a.label}</span>
              <span className="text-faint">{compact(a.tokens)}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="TOOL MIX" label="Tool mix" value={`${s.calls} calls`}>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[10px] text-muted">
          {rows.length === 0 ? <li className="text-faint">no calls yet</li> : null}
          {rows.map((r) => {
            const body = (
              <>
                <span className="w-11 shrink-0 text-left">{CATEGORY_LABELS[r.key].toLowerCase()}</span>
                <span className="h-[5px] grow bg-control">
                  <span className="block h-full" style={{ width: `${Math.max(4, r.share * 100)}%`, background: TOOL_TONE[r.key] ?? "var(--body)" }} />
                </span>
                <span className="w-7 shrink-0 text-right text-faint">{r.count}</span>
              </>
            );
            const station = (STATIONS as readonly string[]).includes(r.key);
            return (
              <li key={r.key}>
                {station ? (
                  <button
                    type="button"
                    data-tool-row={r.key}
                    aria-label={`Open the ${r.key} station: ${r.count} calls`}
                    onClick={() => onStation(r.key as StationCategory)}
                    className="-mx-1 flex w-[calc(100%+8px)] items-center gap-2 rounded-sm border-0 bg-transparent px-1 text-[10px] text-muted outline-none hover:bg-white/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-layer-1"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex items-center gap-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="MODEL MIX" label="Model mix by tokens" value="by tokens">
        <svg
          role="img"
          aria-label={totalTokens > 0 ? `Model mix: ${RADAR.map((m) => `${MODEL_NAMES[m]} ${pct(m)}%`).join(", ")}` : "Model mix: no tokens yet"}
          viewBox="0 0 200 112"
          className="min-h-0 w-full grow"
        >
          <polygon points="100,16 140,56 100,96 60,56" fill="none" stroke="var(--rule)" strokeWidth="0.6" />
          <polygon points="100,36 120,56 100,76 80,56" fill="none" stroke="var(--rule)" strokeWidth="0.4" />
          <line x1="100" y1="16" x2="100" y2="96" stroke="var(--rule)" strokeWidth="0.4" />
          <line x1="60" y1="56" x2="140" y2="56" stroke="var(--rule)" strokeWidth="0.4" />
          {totalTokens > 0 ? (
            <>
              <polygon points={radar.map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(79,216,235,0.2)" stroke="var(--sonnet)" strokeWidth="1.2" />
              {radar.map((p, i) => (
                <circle key={RADAR[i]} cx={p.x} cy={p.y} r="2.4" fill={MODEL_VARS[RADAR[i]]} />
              ))}
            </>
          ) : null}
          <text x="100" y="9" textAnchor="middle" fontSize="8" fill="var(--opus)">
            OPUS {pct("opus")}
          </text>
          <text x="146" y="59" fontSize="8" fill="var(--sonnet)">
            SONNET {pct("sonnet")}
          </text>
          <text x="100" y="108" textAnchor="middle" fontSize="8" fill="var(--haiku)">
            HAIKU {pct("haiku")}
          </text>
          <text x="54" y="59" textAnchor="end" fontSize="8" fill="var(--fable)">
            FABLE {pct("fable")}
          </text>
        </svg>
      </Panel>

      <Panel title="TOKENS / MIN" label="Tokens per minute" value={compact(s.rate)} valueClass="text-ink-strong">
        <svg role="img" aria-label={`Token rate across the run, now ${compact(s.rate)} a minute`} viewBox="0 0 200 84" preserveAspectRatio="none" className="min-h-0 w-full grow">
          <path d={`${sparkPath(rateSeries, 200, 80)}L200 80L0 80Z`} fill="rgba(79,216,235,0.1)" stroke="none" />
          <path d={sparkPath(rateSeries, 200, 80)} fill="none" stroke="var(--sonnet)" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
          <line x1={nowX} y1="0" x2={nowX} y2="84" stroke="var(--opus)" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        </svg>
      </Panel>

      <Panel title="CONTEXT" label="Orchestrator context" value="orchestrator">
        <svg
          role="img"
          aria-label={`Orchestrator context ${ctxPct} percent of the window${lastCompaction ? `, compacted from ${compact(lastCompaction.preTokens)} to ${compact(lastCompaction.postTokens)}` : ""}`}
          viewBox="0 0 200 112"
          className="min-h-0 w-full grow"
        >
          <path d={arcPath(100, 44, 36, 1)} fill="none" stroke="var(--control)" strokeWidth="7" strokeLinecap="round" />
          <path d={arcPath(100, 44, 36, s.context.fraction)} fill="none" stroke={s.context.fraction >= 0.8 ? "var(--escape-text)" : "var(--opus)"} strokeWidth="7" strokeLinecap="round" />
          <text x="100" y="50" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--ink-strong)">
            {ctxPct}
          </text>
          <text x="100" y="62" textAnchor="middle" fontSize="7" fill="var(--label)">
            % OF WINDOW, {compact(s.context.tokens)}
          </text>
          <path d={sparkPath(ctxSeries, 200, 22, 76)} fill="none" stroke="var(--label)" strokeWidth="0.9" />
          {compactions.map((c) => (
            <line key={c.t} x1={(c.t / duration) * 200} y1="74" x2={(c.t / duration) * 200} y2="100" stroke="var(--escape-text)" strokeWidth="1" strokeDasharray="2 2" />
          ))}
          <line x1={nowX} y1="74" x2={nowX} y2="100" stroke="var(--opus)" strokeWidth="0.8" />
          <text x="100" y="110" textAnchor="middle" fontSize="7.5" fill={lastCompaction ? "var(--escape-text)" : "var(--faint)"}>
            {lastCompaction ? `compacted ${compact(lastCompaction.preTokens)} to ${compact(lastCompaction.postTokens)}` : compactions.length > 0 ? "compacts later in the run" : "no compaction in this run"}
          </text>
        </svg>
      </Panel>

      <Panel title="LOG" label="Live log" value="live">
        <ul className="m-0 flex list-none flex-col gap-1 overflow-hidden p-0 text-[10px] text-muted" data-log>
          {s.log.length === 0 ? <li className="text-faint">nothing yet</li> : null}
          {s.log.map((l, i) => (
            <li key={`${l.t}-${i}`} className="truncate">
              <span className="text-rule">{shortClock(l.t)}</span> <span style={{ color: MODEL_VARS[tl.trace.agents[l.agent]?.model ?? "other"] }}>{agentName(tl.trace, l.agent)}</span> {l.text}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/** The bank's bar: the toggle and, while collapsed, one row of numbers; `children` (the toolbar) sit at the right. */
export function BankBar({ app, open, onToggle, children, controls }: { app: InsideApp; open: boolean; onToggle: () => void; children?: ReactNode; controls: string }) {
  const s = useBank(app);
  const tl = useTimeline(app);
  const last = s.log[s.log.length - 1];
  return (
    <div className="flex min-w-0 items-center gap-x-4 gap-y-1 font-mono">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controls}
        data-bank-toggle
        onClick={onToggle}
        className="pointer-events-auto flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-panel-border bg-panel px-2.5 text-[10px] tracking-[0.14em] text-label outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-layer-1"
      >
        INSTRUMENTS
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true" className={open ? "rotate-180" : ""}>
          <path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open ? null : (
        <dl className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-3.5 gap-y-0.5 text-[11px]" aria-label="Instruments, summary" data-bank-summary>
          <Num label="LIVE" value={`${s.live}`} />
          <Num label="CALLS" value={`${s.calls}`} />
          <Num label="TOK/MIN" value={compact(s.rate)} />
          <Num label="CTX" value={`${Math.round(s.context.fraction * 100)}%`} />
          {last ? (
            <span className="hidden min-w-0 max-w-[34ch] truncate text-faint lg:inline">
              {clock(last.t)} {agentName(tl.trace, last.agent)} {last.text}
            </span>
          ) : null}
        </dl>
      )}
      <div className="grow" />
      {children}
    </div>
  );
}

function Num({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="text-[9px] tracking-[0.14em] text-faint">{label}</dt>
      <dd className="m-0 tabular-nums text-ink">{value}</dd>
    </div>
  );
}
