"use client";

import { memo, useMemo, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { InsideApp } from "@/engine/inside/app";
import { clock, idleCutLabel, MODEL_VARS } from "@/engine/inside/format";
import { axisTicks, barHeight, buildLanes, LANE_BINS, type Lanes } from "@/engine/inside/lanes";
import type { IdleCut, Timeline } from "@/lib/trace/timeline";
import { nextRate, RATES, shownRate } from "./rates";
import { useClock, useTimeline } from "./use-engine";

/** Pause bars while playing, a triangle while paused; the design's 48 px round control. */
export function PlayButton({ app, playing, size }: { app: InsideApp; playing: boolean; size: 44 | 48 }) {
  return (
    <button
      type="button"
      aria-label={playing ? "Pause" : "Play"}
      onClick={() => (playing ? app.pause() : app.play())}
      className={`flex shrink-0 items-center justify-center rounded-full bg-ink outline-none transition-transform focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:ring-offset-2 focus-visible:ring-offset-ground active:scale-95 ${
        size === 48 ? "size-12" : "size-11"
      }`}
    >
      {playing ? (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3.5 2v10M10.5 2v10" stroke="#070910" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M4 2.2v9.6L12 7z" fill="#070910" stroke="#070910" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

interface LaneSpec {
  label: string;
  labelClass: string;
  heightPx: number;
  counts: number[];
  color: (bin: number) => string;
}

/** One lane of bars; played bins bright, the rest dim. Re-renders only when the played bin moves. */
const Lane = memo(function Lane({ spec, played }: { spec: LaneSpec; played: number }) {
  const max = Math.max(...spec.counts, 1);
  return (
    <div className="flex items-end gap-0.5" style={{ height: spec.heightPx }}>
      {spec.counts.map((n, i) => {
        const on = n > 0;
        const opacity = i <= played ? (on ? 0.95 : 0.3) : on ? 0.32 : 0.15;
        return <span key={i} className="min-w-0 flex-1 rounded-[1px]" style={{ height: barHeight(n, max, spec.heightPx), background: spec.color(i), opacity }} />;
      })}
    </div>
  );
});

const specs = (lanes: Lanes, only: "tools" | "all"): LaneSpec[] => {
  const tools: LaneSpec = { label: "TOOLS", labelClass: "text-muted", heightPx: only === "tools" ? 26 : 24, counts: lanes.tools, color: () => "var(--muted)" };
  if (only === "tools") return [tools];
  return [
    { label: "PROMPTS", labelClass: "text-warn", heightPx: 18, counts: lanes.prompts, color: () => "var(--opus)" },
    { label: "AGENTS", labelClass: "text-[#c9b8ff]", heightPx: 18, counts: lanes.agents, color: (i) => MODEL_VARS[lanes.agentModel[i]] },
    tools,
  ];
};

/** Where the idle cuts go: a dashed line each, and a label unless it would crowd the previous one. */
function cutMarks(cuts: IdleCut[], span: number) {
  let lastLabel = -1;
  return cuts.map((c) => {
    const at = span > 0 ? c.at / span : 0;
    const label = lastLabel < 0 || at - lastLabel >= 0.14;
    if (label) lastLabel = at;
    return { at, text: label ? idleCutLabel(c.removed) : null };
  });
}

/** Seeks to the pointer's place along `el`; the lanes are one slider. */
function seekFromPointer(app: InsideApp, tl: Timeline, e: ReactPointerEvent<HTMLElement>) {
  const box = e.currentTarget.getBoundingClientRect();
  const frac = box.width > 0 ? Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) : 0;
  app.seek(tl.toTrace(frac * tl.playbackDuration));
}

/**
 * The scrubber: lanes, time axis, the playhead and the idle cuts, as one slider. Pointer drag seeks;
 * the arrow keys step (the HUD's window handler), Home and End jump.
 */
export function Scrubber({ app, only = "all" }: { app: InsideApp; only?: "tools" | "all" }) {
  const tl = useTimeline(app);
  const { t, frac } = useClock(app);
  const bins = only === "tools" ? 60 : LANE_BINS;
  const lanes = useMemo(() => buildLanes(tl, bins), [tl, bins]);
  const laneSpecs = useMemo(() => specs(lanes, only), [lanes, only]);
  const ticks = useMemo(() => axisTicks(tl), [tl]);
  const marks = useMemo(() => cutMarks(tl.cuts, tl.playbackDuration), [tl]);
  const played = Math.min(bins - 1, Math.floor(frac * bins));
  const full = only === "all";

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Home") app.seek(0);
    else if (e.key === "End") app.seek(tl.duration);
    else return;
    e.preventDefault();
  };

  return (
    <div className={full ? "grid min-w-0 grid-cols-[64px_minmax(0,1fr)] items-end gap-x-3" : "min-w-0"}>
      {full ? (
        <div className="flex flex-col gap-1 font-mono text-[10px] tracking-[0.1em]" aria-hidden="true">
          {laneSpecs.map((s) => (
            <span key={s.label} className={`flex items-end ${s.labelClass}`} style={{ height: s.heightPx }}>
              {s.label}
            </span>
          ))}
          <span className="h-[17px]" />
        </div>
      ) : null}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={Math.round(tl.duration)}
        aria-valuenow={Math.round(t)}
        aria-valuetext={`${clock(t)} of ${clock(tl.duration)}`}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromPointer(app, tl, e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromPointer(app, tl, e);
        }}
        className="pointer-events-auto relative flex min-w-0 cursor-pointer touch-none flex-col gap-1 rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent"
        data-scrubber
      >
        {laneSpecs.map((s) => (
          <Lane key={s.label} spec={s} played={played} />
        ))}
        {full ? (
          <div className="relative flex h-[17px] justify-between pt-1 font-mono text-[10px] text-faint" aria-hidden="true">
            {ticks.map((k) => (
              <span
                key={k.label}
                className="absolute whitespace-nowrap"
                style={{ left: `${k.at * 100}%`, transform: k.at < 0.02 ? "none" : k.at > 0.98 ? "translateX(-100%)" : "translateX(-50%)" }}
              >
                {k.label}
              </span>
            ))}
          </div>
        ) : null}
        {marks.map((m, i) => (
          <span key={i} aria-hidden="true" className="pointer-events-none absolute" style={{ left: `${m.at * 100}%`, top: 0, bottom: full ? 17 : 0 }}>
            <span className="absolute inset-y-0 left-0 border-l border-dashed border-rule" />
            {m.text && full ? (
              <span className="absolute -top-[15px] left-0 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] text-label" data-cut>
                {m.text}
              </span>
            ) : null}
          </span>
        ))}
        <span
          aria-hidden="true"
          data-playhead
          className="pointer-events-none absolute w-0.5 -translate-x-1/2 rounded-[1px] bg-white shadow-[0_0_10px_rgba(255,255,255,0.6)]"
          style={{ left: `${frac * 100}%`, top: full ? -2 : -4, bottom: full ? 15 : -4 }}
        />
      </div>
    </div>
  );
}

/** The bottom panel: play, time, speed, the scrubber and the key hints; compact on a phone. */
export function Timeline({ app, narrow }: { app: InsideApp; narrow: boolean }) {
  const tl = useTimeline(app);
  const { t, rate, playing } = useClock(app);

  if (narrow) {
    const shown = shownRate(rate);
    return (
      <section aria-label="Timeline" className="pointer-events-auto flex flex-col gap-2.5 rounded-[14px] border border-panel-border bg-[rgba(12,16,28,0.86)] px-3.5 py-3">
        <Scrubber app={app} only="tools" />
        <div className="flex items-center gap-2.5">
          <PlayButton app={app} playing={playing} size={44} />
          <span className="grow font-mono text-[13px] tabular-nums">
            {clock(t)} <span className="text-faint">/ {clock(tl.duration)}</span>
          </span>
          <button
            type="button"
            aria-label={`Playback speed, ${shown} times`}
            onClick={() => app.setRate(nextRate(rate))}
            className="min-h-11 min-w-14 rounded-[10px] border border-[rgba(150,172,214,0.22)] bg-transparent font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-layer-1"
          >
            {shown}x
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Timeline"
      className="pointer-events-auto flex flex-wrap items-stretch gap-x-5 gap-y-3.5 rounded-[14px] border border-panel-border bg-[rgba(12,16,28,0.86)] px-[18px] py-3.5 backdrop-blur-[10px]"
    >
      <div className="flex flex-col justify-between gap-2.5">
        <div className="flex items-center gap-3">
          <PlayButton app={app} playing={playing} size={48} />
          <span className="flex flex-col gap-0.5 font-mono tabular-nums">
            <span className="text-base text-ink-strong">{clock(t)}</span>
            <span className="text-[11px] text-faint">of {clock(tl.duration)}</span>
          </span>
        </div>
        <div role="group" aria-label="Playback speed" className="flex rounded-[10px] bg-white/4 p-[3px] font-mono text-xs">
          {RATES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={rate === r}
              onClick={() => app.setRate(r)}
              className={`min-h-11 min-w-[52px] rounded-lg border-0 outline-none focus-visible:ring-2 focus-visible:ring-layer-1 ${
                rate === r ? "bg-control font-semibold text-ink-strong" : "bg-transparent text-label hover:text-ink"
              }`}
            >
              {r}x
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-[999_1_480px] self-end pt-4">
        <Scrubber app={app} />
      </div>

      <div className="flex flex-col justify-end gap-1.5 font-mono text-[11px] text-faint">
        <span>
          <span className="text-muted">Space</span> pause
        </span>
        <span>
          <span className="text-muted">Left / Right</span> scrub
        </span>
        <span>
          <span className="text-muted">Click</span> any agent
        </span>
      </div>
    </section>
  );
}
