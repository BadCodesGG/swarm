"use client";

import { useEffect, useState } from "react";
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

/**
 * Where the desktop toolbar sheds as its section narrows. The section is the container, and a container query reads
 * its content box, which is the bar's own width (the centre column less 34 px of padding and border; 426 px at the
 * column's floor of 460). Live and rewound differ (REWOUND and "Back to live" take 117 px more), so each state has its
 * own thresholds: the controls' measured natural width plus 12 px (with the tick count showing, 587 live and 712
 * rewound at three digits, 14 px more at five). The tick count goes first, then the time, then "from here", then
 * (rewound only) the buttons and gaps tighten and the state tag shrinks, so one row holds at the floor. The phone's
 * compact timeline has no container and keeps the full labels.
 */
const SHED = {
  live: { tick: "@max-[613px]:hidden", time: "@max-[495px]:hidden", branch: "@max-[439px]:sr-only", bar: "", tag: "", glyph: "" },
  rewound: {
    tick: "@max-[739px]:hidden",
    time: "@max-[612px]:hidden",
    branch: "@max-[556px]:sr-only",
    bar: "@max-[496px]:gap-1 @max-[496px]:[&_button]:px-2 @max-[496px]:[&_button]:text-xs",
    tag: "@max-[496px]:text-[10px] @max-[496px]:tracking-[0.06em]",
    glyph: "@max-[496px]:hidden",
  },
} as const;

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
  compact = false,
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
  /** The phone's: one row of play, pins, scrubber and LIVE, the actions under it, no lanes. */
  compact?: boolean;
}) {
  const max = Math.max(head, 1);
  // The pins' track: a callback ref, since the compact layout mounts a new element (an observer left on the old one reads 0 as it leaves the page).
  const [track, setTrack] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!track) return;
    const ro = new ResizeObserver(() => setWidth(track.clientWidth));
    ro.observe(track);
    return () => ro.disconnect();
  }, [track]);
  const shown = [...markers].sort((a, b) => a.tick - b.tick);
  const lo = PIN / 2;
  const hi = Math.max(lo, width - PIN / 2);
  // Each pin's own place on the track (its tick, where the lanes put their marks), then spread so two never overlap.
  const tickXs = shown.map((m) => lo + (m.tick / max) * (hi - lo));
  const xs = spreadLine(tickXs, PIN + 2, lo, hi);
  const playButton = (
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
  );
  const shed = SHED[live ? "live" : "rewound"];
  const liveTag = (
    <span className={`font-mono text-xs tracking-[0.1em] ${live ? "text-haiku" : "text-warn"} ${shed.tag}`}>
      <span aria-hidden="true" className={shed.glyph}>
        {live ? "● " : "○ "}
      </span>
      {live ? "LIVE" : "REWOUND"}
    </span>
  );
  const backToLive = live ? null : (
    <button type="button" onClick={onLive} className={`${button} text-xs`} data-back-to-live>
      Back to live
    </button>
  );
  // In a narrow desktop column the label shortens to "Branch"; the full name stays for a screen reader. One span holds the
  // whole label: a flex button would make the inner span its own item and drop the space before "from".
  const branchButton = (
    <button type="button" onClick={onBranch} className={button} data-branch-from-here>
      <span>
        Branch<span className={shed.branch}> from here</span>
      </span>
    </button>
  );
  const trialsButton = (
    <button
      type="button"
      onClick={onRunTrials}
      disabled={running}
      data-run-trials
      className="min-h-11 rounded-[10px] border border-ink bg-ink px-3.5 text-sm font-bold text-ground hover:bg-white focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:ring-offset-2 focus-visible:ring-offset-ground focus-visible:outline-none disabled:cursor-wait disabled:opacity-70"
    >
      {running ? "Running 100 trials..." : "Run 100 trials"}
    </button>
  );
  const pins = (
    <div ref={setTrack} className="relative h-[26px]" role="group" aria-label="Steps on the timeline">
      {shown.map((m, i) => (
        <button
          key={m.n}
          type="button"
          data-timeline-marker={m.n}
          data-tick-x={tickXs[i].toFixed(2)}
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
  );
  const scrubber = (
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
  );

  if (compact) {
    return (
      <section aria-label="Timeline" className="flex shrink-0 flex-col gap-2 rounded-[14px] border border-panel-border bg-panel px-3 py-2.5" data-timeline>
        {/* Both rows carry the toolbar hook: scripts/sweep-box.mjs checks no control sits over another. */}
        <div className="flex items-center gap-2" data-timeline-bar="scrub">
          {playButton}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {pins}
            {scrubber}
          </div>
          {liveTag}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 [&_button]:px-2.5 [&_button]:text-[13px]" data-timeline-bar="actions">
          {backToLive}
          <button type="button" onClick={onReset} className={button}>
            Reset
          </button>
          {branchButton}
          {trialsButton}
        </div>
      </section>
    );
  }

  // One row at every desktop width (scripts/sweep-box.mjs checks them all, scripts/smoke-box.mjs 1440 and 915): the
  // section is a container, and as it narrows the buttons tighten, then the controls shed in SHED's order (the top
  // bar's TIME counter shows the time too).
  return (
    <section aria-label="Timeline" className="@container flex shrink-0 flex-col gap-2.5 rounded-[14px] border border-panel-border bg-panel px-4 py-3" data-timeline>
      <div className={`flex flex-wrap items-center gap-1.5 @max-[699px]:[&_button]:px-2.5 ${shed.bar}`} data-timeline-bar>
        {playButton}
        <button type="button" onClick={onReset} className={button}>
          Reset
        </button>
        {liveTag}
        <span className={`font-mono text-xs whitespace-nowrap text-label ${shed.time}`}>
          T+{clock(at)}
          <span className={shed.tick}>, tick {at}</span>
        </span>
        {backToLive}
        <span className="grow" />
        {branchButton}
        {trialsButton}
      </div>
      <div className="grid grid-cols-[84px_minmax(0,1fr)_64px] items-center gap-x-3 gap-y-1.5">
        <span aria-hidden="true" />
        {pins}
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
                  <span
                    key={`${t.tick}-${t.kind}`}
                    data-lane-tick={t.tick}
                    className={`absolute top-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${TICK_CLASS[t.kind]}`}
                    style={{ left: along(Math.min(1, t.tick / max)) }}
                  />
                ))}
              </div>
              <span className={`font-mono text-[10px] tracking-[0.1em] ${lane.breachedAt === null ? "text-haiku" : "text-escape-text"}`}>{lane.breachedAt === null ? "HELD" : "BREACHED"}</span>
            </div>
          );
        })}
        <span aria-hidden="true" />
        {scrubber}
        <span aria-hidden="true" />
      </div>
    </section>
  );
}
