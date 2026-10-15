"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The right rail: the lab tabs, that lab's layers (`children`), the world editor while Edit world is
 * on, the lab's cast under a disclosure, and the way to the results. When it scrolls, a fade at its foot
 * says more is below, and goes once the end is in view.
 */
export function DefencesRail({
  tabs,
  children,
  builder,
  cast,
  castOf,
  onOpenResults,
  sheet = false,
  lead,
}: {
  tabs: ReactNode;
  children: ReactNode;
  builder?: ReactNode;
  cast: ReactNode;
  castOf: string;
  onOpenResults(): void;
  /** In the phone's Defences sheet: no frame or heading of its own, and `lead` (the Defend card) above the layers. */
  sheet?: boolean;
  lead?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (sheet || !el) return;
    const update = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 2);
    // The rail's own size, and each card's (a disclosure opens, a mode swaps the layers), change what is below.
    const ro = new ResizeObserver(update);
    const watch = () => {
      ro.disconnect();
      ro.observe(el);
      for (const child of el.children) ro.observe(child);
    };
    const mo = new MutationObserver(watch);
    watch();
    mo.observe(el, { childList: true });
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [sheet]);
  const rail = (
    <aside
      ref={ref}
      aria-label="Defences"
      className={sheet ? "flex flex-col gap-3" : "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-[14px] border border-panel-border bg-panel p-4"}
      data-defences-rail
    >
      {sheet ? null : <span className="font-mono text-[10px] tracking-[0.14em] text-label uppercase">Defences</span>}
      {lead}
      {tabs}
      {children}
      {builder}
      <details className="group rounded-xl border border-panel-border" data-cast-details>
        <summary className="flex min-h-11 cursor-pointer items-center justify-between px-3 font-mono text-[10px] tracking-[0.14em] text-label focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none">
          CAST OF {castOf}
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">
            {"▾"}
          </span>
        </summary>
        {cast}
      </details>
      <div className="mt-auto flex flex-col gap-1.5 rounded-xl border border-dashed border-[rgba(150,172,214,0.22)] p-3">
        <span className="font-mono text-[10px] tracking-[0.14em] text-label uppercase">Is this setup any good?</span>
        <span className="text-[13px] leading-[1.45] text-muted">Run 100 trials to plot escapes stopped against useful work kept, beside the other scenarios.</span>
        <a
          href="?view=results"
          onClick={(e) => {
            e.preventDefault();
            onOpenResults();
          }}
          className="flex min-h-11 items-center text-[13px] text-layer-2 hover:text-layer-1 focus-visible:rounded focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none"
          data-open-results
        >
          Open results <span aria-hidden="true">&nbsp;{"→"}</span>
        </a>
      </div>
    </aside>
  );
  if (sheet) return rail;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {rail}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-px bottom-px h-14 rounded-b-[13px] bg-linear-to-t from-panel-solid to-transparent transition-opacity ${more ? "opacity-100" : "opacity-0"}`}
        data-rail-more={more ? "true" : "false"}
      />
    </div>
  );
}
