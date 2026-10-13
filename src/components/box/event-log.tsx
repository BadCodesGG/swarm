"use client";

import { useState } from "react";
import { clock } from "@/engine/box/explain";
import type { LogEntry } from "@/engine/box/tally";

type Filter = "all" | "caught" | "escaped";
/** Lines shown at once; the log keeps more. */
const SHOWN = 5;

/** The event log, newest first, with All / Caught / Escaped filters. */
export function EventLog({ log, caught, escaped }: { log: readonly LogEntry[]; caught: number; escaped: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  const lines = log.filter((e) => filter === "all" || e.kind === filter).slice(0, SHOWN);
  const chip = (value: Filter, label: string, tone: string) => (
    <button
      type="button"
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
      className={`min-h-11 rounded-full border-0 px-3 focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none ${
        filter === value ? "bg-control text-ink-strong" : `bg-transparent hover:bg-white/5 ${tone}`
      }`}
    >
      {label}
    </button>
  );
  return (
    <section aria-label="Event log" className="box-border flex flex-col gap-2 rounded-[14px] border border-panel-border bg-panel px-3.5 py-3 text-xs leading-[1.45]">
      <div role="group" aria-label="Filter events" className="flex flex-wrap gap-1 font-mono text-[11px]">
        {chip("all", "All", "text-label")}
        {chip("caught", `Caught ${caught}`, "text-label")}
        {chip("escaped", `Escaped ${escaped}`, "text-escape-text")}
      </div>
      <div className="flex flex-col gap-2">
        {lines.length === 0 ? <p className="m-0 text-faint">Nothing yet.</p> : null}
        {lines.map((e) => (
          <p key={e.id} className={`m-0 ${e.kind === "escaped" ? "text-[#ffb3c6]" : "text-muted"}`} data-log={e.kind}>
            <span className="font-mono text-faint">{clock(e.tick)}</span> {e.text}
          </p>
        ))}
      </div>
    </section>
  );
}
