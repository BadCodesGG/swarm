"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InsideApp } from "@/engine/inside/app";
import { canShareMoment } from "@/engine/inside/params";
import { leavesPage, momentSearch, type MomentState } from "./moment-url";
import { sampleSize } from "./source-switcher";
import { useTimeline } from "./use-engine";

/** The address bar follows the moment no oftener than this. */
const SYNC_MS = 1000;

function momentOf(app: InsideApp): MomentState {
  const tl = app.timeline();
  return { size: sampleSize(tl.trace.label, tl.trace.source), seed: app.params.seed, t: app.time(), select: app.selected(), follow: app.following() };
}

/** The URL of the current moment, or null for a session that must not be linked (an upload). */
export function momentUrl(app: InsideApp): string | null {
  const search = momentSearch(window.location.search, app.timeline().trace, momentOf(app));
  if (search === null) return null;
  const url = new URL(window.location.href);
  url.search = search;
  return url.toString();
}

/**
 * Keeps `t`, `select` and `follow` (and the sample and seed) in the address bar with
 * `history.replaceState`, once a second. Samples only: an uploaded session never writes to the URL.
 * Applies a `follow` the page opened with, which the engine leaves to the HUD.
 */
export function useMomentSync(app: InsideApp) {
  useEffect(() => {
    if (app.params.follow !== null && canShareMoment(app.timeline().trace)) app.follow(app.params.follow);
  }, [app]);

  useEffect(() => {
    if (app.params.shot) return;
    // Once a link to another page is clicked the sync stops: a replaceState while the router is
    // still loading that page would put it back on this one (a slow device never left /inside).
    let leaving = false;
    const onClick = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      const click = { href: a ? a.href : null, target: a?.target ?? "", button: e.button, modified: e.ctrlKey || e.metaKey || e.shiftKey || e.altKey };
      if (leavesPage(click, window.location.href)) leaving = true;
    };
    document.addEventListener("click", onClick, true);
    const id = window.setInterval(() => {
      if (leaving) return;
      const next = momentUrl(app);
      if (next === null || next === window.location.href) return;
      window.history.replaceState(null, "", next);
    }, SYNC_MS);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("click", onClick, true);
    };
  }, [app]);
}

/** "Copy link to this moment": shown only for a sample session. */
export function CopyMoment({ app, compact = false }: { app: InsideApp; compact?: boolean }) {
  const tl = useTimeline(app);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    const url = momentUrl(app);
    if (url === null) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // No clipboard permission: select the link in a throwaway field instead.
      const field = document.createElement("textarea");
      field.value = url;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      field.remove();
    }
    setState(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2000);
  }, [app]);

  if (!canShareMoment(tl.trace)) return null;
  return (
    <button
      type="button"
      data-copy-moment
      aria-label="Copy link to this moment"
      onClick={copy}
      className="pointer-events-auto flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-panel-border bg-panel px-2.5 font-mono text-[10px] tracking-[0.1em] text-label outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-layer-1"
    >
      <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M5.5 8.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.7.7M8.5 5.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l.7-.7" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      <span aria-live="polite">{state === "copied" ? "Link copied" : state === "failed" ? "Copy failed" : compact ? "Copy link" : "Copy link to this moment"}</span>
    </button>
  );
}
