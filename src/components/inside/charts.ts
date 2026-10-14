/** Geometry and number formatting for the instrument panels. Pure. */

import { compact } from "@/engine/inside/format";
import type { ToolCategory } from "@/lib/trace/types";

export interface Pt {
  x: number;
  y: number;
}

/** A radar polygon: axis i points at angle -90 degrees plus i turns; the biggest value reaches `r`. */
export function radarPoints(values: readonly number[], cx: number, cy: number, r: number): Pt[] {
  const max = Math.max(...values, 0);
  return values.map((v, i) => {
    const a = -Math.PI / 2 + (i / values.length) * Math.PI * 2;
    const k = max > 0 ? v / max : 0;
    return { x: Math.round((cx + Math.cos(a) * r * k) * 100) / 100, y: Math.round((cy + Math.sin(a) * r * k) * 100) / 100 };
  });
}

/** An SVG polyline path through `values` across `w` x `h` from `top` down, the largest at the top. */
export function sparkPath(values: readonly number[], w: number, h: number, top = 0): string {
  const max = Math.max(...values, 0);
  const n = values.length;
  return values
    .map((v, i) => {
      const x = n > 1 ? (i / (n - 1)) * w : 0;
      const y = top + (max > 0 ? h - (v / max) * h : h);
      return `${i === 0 ? "M" : "L"}${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`;
    })
    .join("");
}

/** A gauge arc of 240 degrees opening downward, filled to `fraction`; "" at zero. */
export function arcPath(cx: number, cy: number, r: number, fraction: number): string {
  const f = Math.min(1, Math.max(0, fraction));
  if (f <= 0) return "";
  const start = (150 * Math.PI) / 180;
  const sweep = (240 * Math.PI) / 180;
  const end = start + sweep * f;
  const p = (a: number) => `${Math.round((cx + Math.cos(a) * r) * 100) / 100} ${Math.round((cy + Math.sin(a) * r) * 100) / 100}`;
  return `M ${p(start)} A ${r} ${r} 0 ${sweep * f > Math.PI ? 1 : 0} 1 ${p(end)}`;
}

export interface ToolRow {
  key: ToolCategory;
  count: number;
  /** 0..1 against the biggest row. */
  share: number;
}

/** The used tool categories, biggest first, at most `max`. */
export function toolRows(mix: Record<ToolCategory, number>, max = 6): ToolRow[] {
  const rows = (Object.entries(mix) as [ToolCategory, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max);
  const top = rows[0]?.[1] ?? 0;
  return rows.map(([key, count]) => ({ key, count, share: top > 0 ? count / top : 0 }));
}

/** `<0.1s`, `3.2s`, `2m05s`. */
export function callDuration(seconds: number): string {
  if (seconds < 0.05) return "<0.1s";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  return `${m}m${String(Math.round(seconds % 60)).padStart(2, "0")}`.replace(/m(\d\d)$/, "m$1s");
}

/** Characters in a result: `950`, `12.4k`, or `-` when the trace did not keep it. */
export function resultSize(size: number | undefined): string {
  return size === undefined ? "-" : compact(size);
}

/** The share of an agent's lane spent waiting on the human, as a percent string. */
export function waitingShare(waiting: number, total: number): string {
  if (!(total > 0) || !(waiting > 0)) return "0%";
  const p = (waiting / total) * 100;
  return p < 1 ? "<1%" : `${Math.round(p)}%`;
}
