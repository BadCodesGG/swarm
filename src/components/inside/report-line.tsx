"use client";

import { useCallback, useMemo } from "react";
import type { InsideApp } from "@/engine/inside/app";
import { agentEye } from "@/engine/inside/agent-eye";
import { shortClock, MODEL_VARS } from "@/engine/inside/format";
import { useEngineSnapshot, useSelection, useTimeline } from "./use-engine";

interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const sameLine = (a: Line | null, b: Line | null) => (a === null || b === null ? a === b : [a.x1, a.y1, a.x2, a.y2].every((v, i) => Math.abs(v - [b.x1, b.y1, b.x2, b.y2][i]) < 1));

/**
 * The selected subagent's handback: a thin line from its cloud to its parent's, drawn once it has
 * returned. It is the only thing the parent received from it, so the line says so.
 */
export function ReportLine({ app }: { app: InsideApp }) {
  const tl = useTimeline(app);
  const id = useSelection(app);
  const eye = useMemo(() => (id > 0 ? agentEye(tl.trace, id) : null), [tl, id]);
  const parent = id > 0 ? (tl.trace.agents[id]?.parent ?? -1) : -1;
  const report = eye?.report ?? null;

  const read = useCallback((): Line | null => {
    if (!report || parent < 0 || app.time() < report.t) return null;
    const a = app.cloudOf(id);
    const b = app.cloudOf(parent);
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    // Start and end on the cloud edges, not their centres, when the clouds are far enough apart.
    const cut = len > a.r + b.r + 8 ? 1 : 0;
    const ux = dx / (len || 1);
    const uy = dy / (len || 1);
    return { x1: a.x + ux * a.r * 0.8 * cut, y1: a.y + uy * a.r * 0.8 * cut, x2: b.x - ux * b.r * 0.8 * cut, y2: b.y - uy * b.r * 0.8 * cut };
  }, [app, id, parent, report]);
  const line = useEngineSnapshot(read, sameLine, 50);

  if (!line || !report) return null;
  const colour = MODEL_VARS[tl.trace.agents[id]?.model ?? "other"];
  const mx = (line.x1 + line.x2) / 2;
  const my = (line.y1 + line.y2) / 2;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden font-mono text-[10px] leading-none tracking-[0.08em]" aria-hidden data-report-line>
      <svg className="absolute inset-0 size-full">
        <defs>
          <marker id="report-head" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0L8 4L0 8Z" fill={colour} />
          </marker>
        </defs>
        <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={colour} strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.8" markerEnd="url(#report-head)" />
      </svg>
      <span className="absolute whitespace-nowrap text-body" style={{ left: mx, top: my, transform: "translate(-50%, -140%)", textShadow: "0 0 3px #070910, 0 1px 6px #070910" }}>
        REPORT {shortClock(report.t)}
      </span>
    </div>
  );
}
