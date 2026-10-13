"use client";

import { useEffect, useState } from "react";
import type { InsideApp, InsideOverlay } from "@/engine/inside/app";

/** `search "..."` for WebSearch, `fetch "..."` for WebFetch, the bare tool name otherwise. */
export function probeVerb(tool: string): string {
  if (tool === "WebSearch") return "search";
  if (tool === "WebFetch") return "fetch";
  if (tool.startsWith("mcp__")) return tool.split("__").pop() || tool;
  return tool.toLowerCase();
}

const shorten = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}...` : s);

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

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden font-mono text-[11px] leading-none tracking-[0.08em]" aria-hidden>
      <span
        className="absolute text-[10px] tracking-[0.2em] text-faint"
        style={{ left: o.boundary.x, top: o.boundary.y, transform: "translate(-100%, -100%)" }}
      >
        BOUNDARY
      </span>
      <span
        className="absolute text-[10px] tracking-[0.2em] text-faint"
        style={{ left: o.core.x, top: o.core.y + 56 * o.scale, transform: "translate(-50%, 0)" }}
      >
        ORCHESTRATOR
      </span>
      {o.stations.map((s) => (
        <span
          key={s.key}
          className="absolute whitespace-nowrap"
          style={{ left: s.x, top: s.y, transform: `translate(${-s.ax * 100}%, ${-s.ay * 100}%)` }}
          data-station={s.key}
        >
          <span className={s.active ? "text-body" : "text-label"}>{s.key.toUpperCase()}</span>
          <span className="ml-1.5 text-faint">{s.count}</span>
        </span>
      ))}
      {o.probes.map((p) => (
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
