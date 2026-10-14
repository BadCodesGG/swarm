"use client";

import { useCallback, type KeyboardEvent } from "react";
import type { InsideApp } from "@/engine/inside/app";
import { compact, MODEL_NAMES, MODEL_VARS, runClock } from "@/engine/inside/format";
import { rosterAt, type RosterEntry, type RosterStatus } from "@/engine/inside/roster";
import { useEngineSnapshot, useSelection, useTimeline } from "./use-engine";

const STATUS: Record<RosterStatus, { text: string; tone: string }> = {
  waiting: { text: "NOT STARTED", tone: "text-faint" },
  working: { text: "WORKING", tone: "text-haiku" },
  done: { text: "DONE", tone: "text-label" },
  failed: { text: "FAILED", tone: "text-error" },
};

const keyOf = (rows: RosterEntry[]) => rows.map((e) => `${e.status}${e.tokens}${Math.floor(e.activeTime)}`).join(",");

/** Selecting from the roster follows too: the camera goes to the agent and stays. */
export function pickFromRoster(app: InsideApp, id: number) {
  app.select(id);
  app.follow(id);
}

/**
 * Every agent: model, brief excerpt, tokens, active time and status. A row selects the agent and
 * follows it. Arrow keys move between rows; session text renders as text only.
 */
export function Roster({ app, onClose }: { app: InsideApp; onClose: () => void }) {
  const tl = useTimeline(app);
  const selected = useSelection(app);
  const read = useCallback(() => rosterAt(tl, app.time()), [app, tl]);
  const rows = useEngineSnapshot(read, (a, b) => keyOf(a) === keyOf(b), 250);
  const readFollow = useCallback(() => app.following(), [app]);
  const following = useEngineSnapshot(readFollow, Object.is, 100);

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-roster-row]")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : Math.min(buttons.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)));
    buttons[next]?.focus();
    e.preventDefault();
  };

  return (
    <section aria-label="Roster" data-roster className="pointer-events-auto flex min-h-0 flex-1 flex-col rounded-[14px] border border-panel-border bg-[rgba(12,16,28,0.78)] backdrop-blur-[10px]">
      <header className="flex items-center justify-between px-[18px] pt-1.5">
        <span className="font-mono text-[10px] tracking-[0.14em] text-label">
          ROSTER <span className="text-faint">{rows.length} agents</span>
        </span>
        <button
          type="button"
          aria-label="Close roster"
          onClick={onClose}
          className="-mr-3 flex size-11 items-center justify-center border-0 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-layer-1"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="#a7b1c2" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <ul onKeyDown={onKeyDown} className="m-0 flex min-h-0 list-none flex-col gap-px overflow-y-auto p-0 pb-2">
        {rows.map((e) => {
          const on = selected === e.id;
          const st = STATUS[e.status];
          const m = MODEL_VARS[e.model];
          return (
            <li key={e.id}>
              <button
                type="button"
                data-roster-row={e.id}
                aria-current={on ? "true" : undefined}
                aria-label={`${e.id === 0 ? "Orchestrator" : e.label}, ${MODEL_NAMES[e.model]}, ${st.text.toLowerCase()}: select and follow`}
                onClick={() => pickFromRoster(app, e.id)}
                className={`flex w-full flex-col gap-0.5 border-0 border-l-2 px-[18px] py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-layer-1 ${
                  on ? "bg-white/6" : "bg-transparent hover:bg-white/4"
                }`}
                style={{ borderLeftColor: on ? m : "transparent" }}
              >
                <span className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: m, boxShadow: e.status === "working" ? `0 0 8px ${m}` : "none", opacity: e.status === "waiting" ? 0.35 : 1 }} />
                  <span className="min-w-0 grow truncate text-[13px] font-semibold text-ink">{e.id === 0 ? "Orchestrator" : e.label}</span>
                  <span className={`shrink-0 font-mono text-[9px] tracking-[0.1em] ${st.tone}`}>{following === e.id ? "FOLLOWING" : st.text}</span>
                </span>
                <span className="flex gap-2.5 whitespace-nowrap pl-4 font-mono text-[10px] text-label">
                  <span style={{ color: m }}>{MODEL_NAMES[e.model].toLowerCase()}</span>
                  <span>{compact(e.tokens)} tok</span>
                  <span>{runClock(e.activeTime)} active</span>
                </span>
                {e.excerpt ? <span className="line-clamp-2 pl-4 text-[11px] leading-snug text-muted [overflow-wrap:anywhere]">{e.excerpt}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
