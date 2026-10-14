"use client";

import Link from "next/link";
import type { InsideApp } from "@/engine/inside/app";
import { handoffSearch } from "@/lib/box/handoff";
import { useTimeline } from "./use-engine";

/**
 * "Take this swarm into The Box": a link to Act 2 that carries the sample's agent count and model
 * kinds, so the Box's cast is drawn from them. Shown only for a seeded sample; an uploaded session
 * gets no link at all, so nothing of it reaches a URL.
 */
export function Handoff({ app, compact = false }: { app: InsideApp; compact?: boolean }) {
  const tl = useTimeline(app);
  const search = handoffSearch(tl.trace);
  if (search === null) return null;
  return (
    <Link
      href={`/box?${search}`}
      data-handoff
      className="pointer-events-auto flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-escape/40 bg-panel px-2.5 font-mono text-[10px] tracking-[0.1em] text-escape-text outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-layer-1"
    >
      {compact ? "Into The Box" : "Take this swarm into The Box"}
      <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M2 7h9M7.5 3.5 11 7l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}
