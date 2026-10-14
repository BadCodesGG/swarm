"use client";

import { useCallback, useState } from "react";
import type { InsideApp } from "@/engine/inside/app";
import { narrate } from "@/engine/inside/narrate";
import { SampleTag, TruncatedNote, UploadMissingNote } from "./sample-tag";
import { useEngineSnapshot, useTimeline } from "./use-engine";

const same = (a: string, b: string) => a === b;

/** The plain-English NOW panel: what the live agents are doing at the playhead. */
export function NowPanel({ app, narrow }: { app: InsideApp; narrow: boolean }) {
  const tl = useTimeline(app);
  // The trace this panel opened on: the note goes once the visitor switches to another.
  const [first] = useState(tl.trace);
  const read = useCallback(() => narrate(app.timeline(), app.time()), [app]);
  const text = useEngineSnapshot(read, same, 250);

  return (
    <section
      aria-label="What is happening now"
      className={`pointer-events-auto flex flex-col rounded-[14px] border border-panel-border ${
        narrow ? "gap-1.5 bg-panel px-3.5 py-3" : "gap-2.5 bg-panel p-[18px] backdrop-blur-[10px]"
      }`}
    >
      <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-opus">
        <span className="size-1.5 rounded-full bg-opus shadow-[0_0_8px_var(--opus)]" />
        NOW
      </span>
      <p data-narration className={`m-0 text-body [text-wrap:pretty] ${narrow ? "text-sm leading-[1.45]" : "text-[15px] leading-normal"}`}>
        {text}
      </p>
      <SampleTag trace={tl.trace} />
      <TruncatedNote trace={tl.trace} />
      <UploadMissingNote show={app.uploadMissing && tl.trace === first} />
    </section>
  );
}
