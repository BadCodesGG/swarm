"use client";

import type { InsideApp } from "@/engine/inside/app";
import { getImported } from "@/engine/inside/imported";
import { generateTrace, type SampleSize } from "@/lib/trace/generate";
import { useTimeline } from "./use-engine";

const SIZES: { size: SampleSize; label: string }[] = [
  { size: "small", label: "Small" },
  { size: "medium", label: "Medium" },
  { size: "large", label: "Large" },
];

/** Which sample a trace is, from its label ("Sample large, seed 4"); null for an upload. */
export function sampleSize(label: string, source: string): SampleSize | null {
  if (source !== "sample") return null;
  return SIZES.find((s) => label.startsWith(`Sample ${s.size}`))?.size ?? null;
}

/** SAMPLE Small / Medium / Large: swaps the trace without rebuilding the renderer, and keeps `?source=` in step. */
export function SourceSwitcher({ app, narrow }: { app: InsideApp; narrow: boolean }) {
  const { trace } = useTimeline(app);
  const current = sampleSize(trace.label, trace.source);
  const upload = trace.source === "upload";
  // Offered again after a trip to a sample, while the parsed session is still in memory.
  const held = getImported();

  const chooseUpload = () => {
    if (!held || upload) return;
    app.setTrace(held);
    const url = new URL(window.location.href);
    url.searchParams.set("source", "upload");
    url.searchParams.delete("t");
    url.searchParams.delete("select");
    window.history.replaceState(null, "", url);
  };

  const choose = (size: SampleSize) => {
    if (size === current) return;
    app.setTrace(generateTrace(app.params.seed, size));
    const url = new URL(window.location.href);
    url.searchParams.set("source", size);
    url.searchParams.delete("t");
    url.searchParams.delete("select");
    window.history.replaceState(null, "", url);
  };

  return (
    <div
      role="group"
      aria-label="Session source"
      className={`pointer-events-auto rounded-xl border border-[rgba(150,172,214,0.18)] bg-[rgba(12,16,28,0.78)] p-1 backdrop-blur-[10px] ${
        narrow ? "grid grid-cols-[auto_repeat(3,minmax(0,1fr))] items-center" : "flex items-center"
      }`}
    >
      <span className={`font-mono text-[10px] tracking-[0.14em] text-faint ${narrow ? "pr-2 pl-1.5" : "pr-2.5 pl-2"}`}>SAMPLE</span>
      {SIZES.map(({ size, label }) => (
        <button
          key={size}
          type="button"
          aria-pressed={current === size}
          onClick={() => choose(size)}
          className={`min-h-11 rounded-[9px] border-0 text-sm outline-none focus-visible:ring-2 focus-visible:ring-layer-1 ${narrow ? "" : "px-4"} ${
            current === size ? "bg-control font-semibold text-ink-strong shadow-[inset_0_0_0_1px_rgba(255,181,77,0.35)]" : "bg-transparent text-label hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
      {upload || held ? (
        <button
          type="button"
          aria-pressed={upload}
          onClick={chooseUpload}
          className={`min-h-11 rounded-[9px] border-0 text-sm outline-none focus-visible:ring-2 focus-visible:ring-layer-1 ${narrow ? "col-span-4 mt-1" : "ml-1 px-4"} ${
            upload ? "bg-control font-semibold text-ink-strong shadow-[inset_0_0_0_1px_rgba(255,181,77,0.35)]" : "bg-transparent text-label hover:text-ink"
          }`}
        >
          Your session
        </button>
      ) : null}
    </div>
  );
}
