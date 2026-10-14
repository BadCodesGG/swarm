"use client";

import { useEffect, useMemo, useState } from "react";
import type { InsideApp } from "@/engine/inside/app";
import type { AgentAnchor, InsideOverlay } from "@/engine/inside/overlay-api";
import { compact, MODEL_NAMES, MODEL_VARS } from "@/engine/inside/format";
import { inRect, LABEL_GAP, placeCallouts, placeFarLabels, type Callout, type FarLabel, type Rect } from "./callouts";

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
function takenRects(o: InsideOverlay): Rect[] {
  const rects: Rect[] = o.stations.map((l) => {
    const w = (l.key.length + 3) * 7.4;
    return { x: l.x - l.ax * w, y: l.y - l.ay * 13, w, h: 13 };
  });
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
  // Nothing is labelled under the HUD's chrome: a station or probe the camera has carried out of
  // the director's free frame (Follow, a manual orbit) keeps its ring but loses its text.
  const stations = o.stations.filter((s) => inRect(s, o.frame) && (!narrow || s.active));
  const probes = narrow ? [] : o.probes.filter((p) => inRect(p, o.frame));

  // The annotated star chart: the clusters near the focus on thin leaders, placed clear of every other
  // label, and a faint small tag under each far one. Nothing is labelled that is off screen or behind
  // the camera (the engine leaves those out of `anchors`).
  const { callouts, tags } = useMemo(() => {
    const bounds = { x: o.frame.x + 10, y: o.frame.y + 10, w: o.frame.w - 20, h: o.frame.h - 20 };
    const near = o.anchors.filter((x) => x.far < 0.4);
    const taken = takenRects(o);
    const placed = placeCallouts(near, (x) => modelLine(x).length + (x.live ? 0 : 7), { x: o.frame.x + o.frame.w / 2, y: o.frame.y + o.frame.h / 2 }, {
      width: o.width,
      height: o.height,
      bounds,
      avoid: taken,
    });
    const far = narrow ? [] : o.anchors.filter((x) => x.far >= 0.4);
    return { callouts: placed, tags: placeFarLabels(far, [...taken, ...placed.map((c) => c.box)], bounds) };
  }, [o, narrow]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden font-mono text-[11px] leading-none tracking-[0.08em]" aria-hidden>
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
      {tags.map((t) => (
        <FarTag key={t.anchor.id} t={t} />
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
      {probes.map((p) => (
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
      <span className={a.focus ? "text-[10px] tracking-[0.14em] text-ink-strong" : "text-[10px] tracking-[0.14em] text-body"}>{shorten(a.name, 24).toUpperCase()}</span>
      <span className="text-[10px] tracking-[0.06em] text-label">
        <span style={{ color: MODEL_VARS[a.model] }}>{MODEL_NAMES[a.model].toLowerCase()}</span> {statOf(a.tokens)}
        {a.live ? "" : " (done)"}
      </span>
    </span>
  );
}

/** A far cluster's tag: just its name, small and faint, in the model's colour. */
function FarTag({ t }: { t: FarLabel }) {
  return (
    <span
      className="absolute whitespace-nowrap text-[9px] tracking-[0.12em]"
      style={{ left: t.box.x, top: t.box.y, color: MODEL_VARS[t.anchor.model], opacity: 0.45, textShadow: "0 0 3px #070910" }}
      data-far-tag={t.anchor.id}
    >
      {shorten(t.anchor.name, 18).toUpperCase()}
    </span>
  );
}
