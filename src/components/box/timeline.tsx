"use client";

import { useEffect, useRef, useState } from "react";
import { clock } from "@/engine/box/explain";
import { LAB_NAME, type BreakoutStep, type LabId } from "@/lib/box/world-types";
import type { Lane, LaneKind } from "./lanes";
import { spreadLine } from "./playground";
import { button, iconButton } from "./toolbar";

/** A step as the timeline remembers it, so a rewound view (which has not reached it yet) still shows it. */
export interface Pin {
  n: number;
  tick: number;
  lab: LabId;
  kind: BreakoutStep["kind"];
  step: BreakoutStep | null;
}

/** A pin's width on the timeline, and the gap kept between two. */
const PIN = 24;

/** A numbered step's disc, here and in the story: a refused reach is dashed green, a breach solid pink, the open one filled (never colour alone). */
export function pinClass(kind: BreakoutStep["kind"], open: boolean): string {
  const base = "flex shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono text-[11px] font-semibold";
  if (kind === "held") return `${base} border-dashed ${open ? "border-ink-strong bg-haiku text-ground" : "border-haiku bg-ground text-haiku"}`;
  return `${base} ${open ? "border-escape bg-escape text-[#1a0610] shadow-[0_0_0_4px_rgba(255,77,125,0.25)]" : "border-escape bg-ground text-escape-text"}`;
}

const TICK_CLASS: Record<LaneKind, string> = {
  caught: "h-2 bg-layer-2/70",
  held: "h-2.5 bg-haiku",
  crossing: "h-3 bg-escape",
  escape: "h-3 bg-escape",
};

/** A point 0 to 1 along the run, as CSS, on the same span the pins use. */
const along = (at: number) => `calc(${PIN / 2}px + ${at} * (100% - ${PIN}px))`;

function laneLabel(lane: Lane, name: string): string {
  const caught = lane.ticks.filter((t) => t.kind === "caught").reduce((a, t) => a + t.count, 0);
  return `${name}: ${caught} caught${lane.breachedAt === null ? ", held so far" : `, breached at T+${clock(lane.breachedAt)}`}`;
}

/**
 * The run under the scene: play or pause, Reset, LIVE or REWOUND and the time, "Branch from here" and
 * "Run 100 trials"; then the numbered steps pinned on the run, one thin lane per lab with its catches,
 * reaches and breaches as ticks (green until it is breached, pink after, and said in words at the
 * end), and the scrubber. Dragging the scrubber seeks the scene to that tick (the engine replays to
 * it and stops advancing); "Back to live", shown only then, returns to the head.
 */
export function Timeline({
  at,
  head,
  live,
  markers,
  selected,
  lanes,
  playing,
  running,
  onSeek,
  onLive,
  onPick,
  onPlay,
  onReset,
  onRunTrials,
  onBranch,
}: {
  at: number;
  head: number;
  live: boolean;
  markers: readonly Pin[];
  selected: number | null;
  lanes: readonly Lane[];
  playing: boolean;
  running: boolean;
  onSeek(t: number): void;
  onLive(): void;
  onPick(n: number): void;
  onPlay(play: boolean): void;
  onReset(): void;
  onRunTrials(): void;
  onBranch(): void;
}) {
  const max = Math.max(head, 1);
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const shown = [...markers].sort((a, b) => a.tick - b.tick);
  const lo = PIN / 2;
  const hi = Math.max(lo, width - PIN / 2);
  const xs = spreadLine(shown.map((m) => lo + (m.tick / max) * (hi - lo)), PIN + 2, lo, hi);
  return (
    <section aria-label="Timeline" className="flex shrink-0 flex-col gap-2.5 rounded-[14px] border border-panel-border bg-panel px-4 py-3 max-[640px]:px-3" data-timeline>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-label={playing ? "Pause the simulation" : "Resume the simulation"} onClick={() => onPlay(!playing)} className={iconButton}>
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M4 2.5v9M10 2.5v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3.5 2.2v9.6L11.5 7z" fill="currentColor" />
            </svg>
          )}
        </button>
        <button type="button" onClick={onReset} className={button}>
          Reset
        </button>
        <span className={`font-mono text-xs tracking-[0.1em] ${live ? "text-haiku" : "text-warn"}`}>
          <span aria-hidden="true">{live ? "● " : "○ "}</span>
          {live ? "LIVE" : "REWOUND"}
        </span>
        <span className="font-mono text-xs text-label">
          T+{clock(at)}, tick {at}
        </span>
        {live ? null : (
          <button type="button" onClick={onLive} className={`${button} text-xs`} data-back-to-live>
            Back to live
          </button>
        )}
        <span className="grow" />
        <button type="button" onClick={onBranch} className={button} data-branch-from-here>
          Branch from here
        </button>
        <button
          type="button"
          onClick={onRunTrials}
          disabled={running}
          data-run-trials
          className="min-h-11 rounded-[10px] border border-ink bg-ink px-3.5 text-sm font-bold text-ground hover:bg-white focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:ring-offset-2 focus-visible:ring-offset-ground focus-visible:outline-none disabled:cursor-wait disabled:opacity-70"
        >
          {running ? "Running 100 trials..." : "Run 100 trials"}
        </button>
      </div>
      <div className="grid grid-cols-[84px_minmax(0,1fr)_64px] items-center gap-x-3 gap-y-1.5 max-[640px]:grid-cols-[60px_minmax(0,1fr)_52px] max-[640px]:gap-x-2">
        <span aria-hidden="true" />
        <div ref={track} className="relative h-[26px]" role="group" aria-label="Steps on the timeline">
          {shown.map((m, i) => (
            <button
              key={m.n}
              type="button"
              data-timeline-marker={m.n}
              aria-pressed={selected === m.n}
              aria-label={`Step ${m.n} at T+${clock(m.tick)}, tick ${m.tick}`}
              onClick={() => {
                // One tick before the step: a layer switched on at the step's own tick would be too late.
                onSeek(Math.max(0, m.tick - 1));
                onPick(m.n);
              }}
              className={`${pinClass(m.kind, selected === m.n)} absolute top-px h-6 w-6 -translate-x-1/2 cursor-pointer focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:ring-offset-2 focus-visible:ring-offset-ground focus-visible:outline-none`}
              style={{ left: xs[i] }}
            >
              {m.n}
            </button>
          ))}
        </div>
        <span aria-hidden="true" />
        {lanes.map((lane) => {
          const name = LAB_NAME[lane.lab];
          const cut = lane.breachedAt === null ? null : along(Math.min(1, lane.breachedAt / max));
          return (
            <div key={lane.lab} className="contents" data-lane={lane.lab}>
              <span className="truncate font-mono text-[10px] tracking-[0.1em] text-label">{name}</span>
              <div className="relative h-3" role="img" aria-label={laneLabel(lane, name)}>
                <div
                  className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-[3px]"
                  style={{ background: cut ? `linear-gradient(90deg, rgba(126,226,168,0.45) 0 ${cut}, #ff4d7d ${cut} 100%)` : "rgba(126,226,168,0.45)" }}
                />
                {lane.ticks.map((t) => (
                  <span key={`${t.tick}-${t.kind}`} className={`absolute top-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${TICK_CLASS[t.kind]}`} style={{ left: along(t.at) }} />
                ))}
              </div>
              <span className={`font-mono text-[10px] tracking-[0.1em] ${lane.breachedAt === null ? "text-haiku" : "text-escape-text"}`}>{lane.breachedAt === null ? "HELD" : "BREACHED"}</span>
            </div>
          );
        })}
        <span aria-hidden="true" />
        <input
          type="range"
          min={0}
          max={max}
          value={Math.min(at, max)}
          aria-label="Rewind to a tick"
          aria-valuetext={`tick ${at}, ${live ? "live" : "rewound"}`}
          data-scrubber-box
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v >= max) onLive();
            else onSeek(v);
          }}
          className="m-0 h-6 w-full cursor-pointer accent-layer-2"
        />
        <span aria-hidden="true" />
      </div>
    </section>
  );
}
