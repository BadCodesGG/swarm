"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { agentName } from "@/engine/inside/roster";
import type { Timeline } from "@/lib/trace/timeline";
import { describeHit, hitLane, laneHeight, planLanes, type LaneBox, type LaneMark } from "./lane-plan";
import { lanesOf } from "./trace-memo";

/** Token values as hex: a canvas cannot read CSS variables. */
const INK = "#dfe5ee";
const THINK = "#5a6680";
const WAIT = "#ffb54d";
const ERROR = "#ff8aa0";
const RETRY = "#4fd8eb";
const COMPACT = "#ff8aa8";

const BOX_FILL: Record<LaneBox["kind"], string> = { think: THINK, tool: INK, "waiting-on-you": WAIT };
const MARK_FILL: Record<LaneMark["kind"], string> = { error: ERROR, retry: RETRY, compaction: COMPACT, pause: WAIT };

/** Height in CSS px the lanes of a trace take. */
export function lanesHeightFor(tl: Timeline): number {
  return laneHeight(lanesOf(tl.trace).length);
}

/**
 * One thin lane per agent: what it was doing (think, tool, waiting on you; idle left empty), with
 * error ticks, inferred retries, compactions and permission pauses on top. Drawn once per size; a
 * hover names whatever is under the pointer. It sits inside the scrubber, so a click still seeks.
 */
export function AgentLanes({ tl }: { tl: Timeline }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ text: string; x: number } | null>(null);
  const plan = useMemo(() => planLanes(lanesOf(tl.trace), (t) => (tl.playbackDuration > 0 ? tl.toPlayback(t) / tl.playbackDuration : 0)), [tl]);
  const height = laneHeight(plan.rows);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(width * dpr);
    el.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const rowH = plan.rows > 0 ? height / plan.rows : height;
    const gap = rowH >= 3 ? 1 : 0;
    ctx.globalAlpha = 0.9;
    for (const kind of ["think", "tool", "waiting-on-you"] as const) {
      ctx.fillStyle = BOX_FILL[kind];
      ctx.globalAlpha = kind === "think" ? 0.5 : 0.95;
      for (const b of plan.boxes) {
        if (b.kind !== kind) continue;
        ctx.fillRect(b.x0 * width, b.row * rowH, Math.max(1, (b.x1 - b.x0) * width), Math.max(1, rowH - gap));
      }
    }
    ctx.globalAlpha = 1;
    // A compaction crosses every lane; the other marks sit on their own.
    ctx.fillStyle = COMPACT;
    for (const m of plan.marks) if (m.kind === "compaction") ctx.fillRect(Math.round(m.x * width) - 0.5, 0, 1.5, height);
    for (const kind of ["retry", "error"] as const) {
      ctx.fillStyle = MARK_FILL[kind];
      for (const m of plan.marks) {
        if (m.kind !== kind) continue;
        const h = Math.max(3, rowH);
        const y = Math.min(height - h, Math.max(0, m.row * rowH + rowH / 2 - h / 2));
        ctx.fillRect(Math.round(m.x * width) - 1, y, 2, h);
      }
    }
  }, [plan, width, height]);

  return (
    <div className="relative" style={{ height }}>
      <canvas
        ref={canvas}
        data-agent-lanes
        className="block w-full rounded-[2px] bg-white/[0.03]"
        style={{ height }}
        onPointerMove={(e) => {
          if (e.buttons !== 0) return;
          const box = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - box.left) / box.width;
          const hit = hitLane(plan, x, (e.clientY - box.top) / box.height, box.width);
          setHover(hit ? { text: describeHit(hit, (id) => agentName(tl.trace, id)), x } : null);
        }}
        onPointerLeave={() => setHover(null)}
      />
      {hover ? (
        <span
          aria-hidden="true"
          data-lane-readout
          className="pointer-events-none absolute -top-5 z-10 whitespace-nowrap rounded-md border border-panel-border bg-ground/95 px-2 py-0.5 font-mono text-[10px] text-ink"
          style={{ left: `${hover.x * 100}%`, transform: `translateX(-${Math.round(hover.x * 100)}%)` }}
        >
          {hover.text}
        </span>
      ) : null}
    </div>
  );
}

/** What the lane colours mean, as a compact key. */
export function LaneKey() {
  const chip = (c: string, t: string) => (
    <span key={t} className="flex items-center gap-1.5">
      <span className="h-1.5 w-2.5 rounded-[1px]" style={{ background: c }} />
      {t}
    </span>
  );
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[9px] text-faint" aria-hidden="true">
      {chip(THINK, "think")}
      {chip(INK, "tool")}
      {chip(WAIT, "waiting on you")}
      {chip(ERROR, "error")}
      {chip(RETRY, "retry, inferred")}
      {chip(COMPACT, "compaction")}
    </div>
  );
}
