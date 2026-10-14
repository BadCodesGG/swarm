"use client";

import { useEffect, useMemo, useState } from "react";
import type { InsideApp } from "@/engine/inside/app";
import type { AgentAnchor, InsideOverlay } from "@/engine/inside/overlay-api";
import { compact, MODEL_NAMES, MODEL_VARS } from "@/engine/inside/format";
import { LABEL_GAP, placeCallouts, type Callout, type Rect } from "./callouts";

/** `search "..."` for WebSearch, `fetch "..."` for WebFetch, the bare tool name otherwise. */
export function probeVerb(tool: string): string {
  if (tool === "WebSearch") return "search";
  if (tool === "WebFetch") return "fetch";
  if (tool.startsWith("mcp__")) return tool.split("__").pop() || tool;
  return tool.toLowerCase();
}

/** Below this viewport width the labels thin out (the HUD's phone layout starts here too). */
const NARROW = 640;

const shorten = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}...` : s);

const statOf = (tokens: number) => `${compact(tokens)} tok`;
const modelLine = (a: AgentAnchor) => `${MODEL_NAMES[a.model].toLowerCase()} ${statOf(a.tokens)}`;

/** The text boxes the callouts must stay clear of, estimated at the mono face's advance. */
function takenRects(o: InsideOverlay, narrow: boolean): Rect[] {
  const rects: Rect[] = o.stations.map((l) => {
    const w = (l.key.length + 3) * 7.4;
    return { x: l.x - l.ax * w, y: l.y - l.ay * 13, w, h: 13 };
  });
  if (!narrow) rects.push({ x: o.boundary.x - 70, y: o.boundary.y - 14, w: 70, h: 14 });
  for (const p of o.probes) rects.push({ x: p.x + 10, y: p.y - 7, w: 190, h: 14 });
  return rects;
}

/**
 * Station, boundary and web probe labels, placed over the canvas at the scene's projected points.
 * Session text arrives here only as React text.
 */
export function InsideLabels({ app }: { app: InsideApp }) {
  const [o, setO] = useState<InsideOverlay>(() => app.overlay());

  useEffect(() => {
    let raf = 0;
    let seen = -1;
    const poll = () => {
      const next = app.overlay();
      if (next.version !== seen) {
        seen = next.version;
        setO(next);
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [app]);

  // On a phone the scene is small: only the lit stations keep a label, and the probes and boundary
  // text give way, so nothing clips at the edge.
  const narrow = o.width > 0 && o.width < NARROW;
  const stations = narrow ? o.stations.filter((s) => s.active) : o.stations;

  // The annotated star chart: a few clouds on thin leaders, placed clear of every other label.
  const callouts = useMemo(
    () =>
      placeCallouts(o.anchors, (a) => modelLine(a).length + (a.live ? 0 : 7), o.core, {
        width: o.width,
        height: o.height,
        bounds: { x: o.frame.x + 10, y: o.frame.y + 10, w: o.frame.w - 20, h: o.frame.h - 20 },
        avoid: takenRects(o, narrow),
      }),
    [o, narrow],
  );
  const orchestratorLabelled = callouts.some((c) => c.anchor.id === 0);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden font-mono text-[11px] leading-none tracking-[0.08em]" aria-hidden>
      {narrow ? null : (
        <span
          className="absolute text-[10px] tracking-[0.2em] text-faint"
          style={{ left: o.boundary.x, top: o.boundary.y, transform: "translate(-100%, -100%)" }}
        >
          BOUNDARY
        </span>
      )}
      {orchestratorLabelled ? null : (
        <span
          className="absolute text-[10px] font-semibold tracking-[0.2em] text-[#ffd59a]"
          style={{ left: o.core.x, top: o.core.y + 36 * o.scale, transform: "translate(-50%, 0)", textShadow: "0 0 3px #070910, 0 1px 6px #070910, 0 0 12px rgba(7, 9, 16, 0.9)" }}
        >
          ORCHESTRATOR
        </span>
      )}
      <svg className="absolute inset-0" width={o.width} height={o.height} data-callouts>
        {callouts.map((c) => (
          <g key={c.anchor.id} stroke={MODEL_VARS[c.anchor.model]} fill={MODEL_VARS[c.anchor.model]}>
            <line x1={c.from.x} y1={c.from.y} x2={c.to.x} y2={c.to.y} strokeWidth={1} strokeOpacity={0.55} />
            <line x1={c.to.x} y1={c.to.y} x2={c.to.x + (c.side === "start" ? LABEL_GAP - 4 : 4 - LABEL_GAP)} y2={c.to.y} strokeWidth={1} strokeOpacity={0.55} />
            <circle cx={c.from.x} cy={c.from.y} r={2} stroke="none" />
          </g>
        ))}
      </svg>
      {callouts.map((c) => (
        <CalloutLabel key={c.anchor.id} c={c} />
      ))}
      {stations.map((s) => (
        <span
          key={s.key}
          className="absolute whitespace-nowrap"
          style={{ left: s.x, top: s.y, transform: `translate(${-s.ax * 100}%, ${-s.ay * 100}%)` }}
          data-station={s.key}
        >
          <span className={s.active ? "text-body" : "text-label"}>{s.key.toUpperCase()}</span>
          {narrow ? null : <span className="ml-1.5 text-faint">{s.count}</span>}
        </span>
      ))}
      {(narrow ? [] : o.probes).map((p) => (
        <span
          key={p.id}
          className="absolute overflow-hidden text-ellipsis whitespace-nowrap"
          style={{ left: p.x + 10, top: p.y, maxWidth: Math.max(o.width - p.x - 22, 40), transform: "translate(0, -50%)" }}
          data-probe={p.id}
        >
          <span className="text-body">{probeVerb(p.tool)}</span>
          {p.query ? <span className="ml-1.5 text-label">&quot;{shorten(p.query, 34)}&quot;</span> : null}
        </span>
      ))}
    </div>
  );
}

/** One callout: the agent's name over its model and live token count, set off the leader's end. */
function CalloutLabel({ c }: { c: Callout }) {
  const a = c.anchor;
  const x = c.to.x + (c.side === "start" ? LABEL_GAP : -LABEL_GAP);
  return (
    <span
      className="absolute flex flex-col gap-[3px] whitespace-nowrap"
      style={{
        left: x,
        top: c.to.y,
        transform: `translate(${c.side === "start" ? "0" : "-100%"}, -50%)`,
        textAlign: c.side === "start" ? "left" : "right",
        textShadow: "0 0 3px #070910, 0 1px 6px #070910",
      }}
      data-callout={a.id}
    >
      <span className="text-[10px] tracking-[0.14em] text-body">{shorten(a.name, 24).toUpperCase()}</span>
      <span className="text-[10px] tracking-[0.06em] text-label">
        <span style={{ color: MODEL_VARS[a.model] }}>{MODEL_NAMES[a.model].toLowerCase()}</span> {statOf(a.tokens)}
        {a.live ? "" : " (done)"}
      </span>
    </span>
  );
}
