import type { ReactNode } from "react";

/**
 * The right rail: the lab tabs, that lab's layers (`children`), the world editor while Edit world is
 * on, the lab's cast under a disclosure, and the way to the results.
 */
export function DefencesRail({ tabs, children, builder, cast, castOf }: { tabs: ReactNode; children: ReactNode; builder?: ReactNode; cast: ReactNode; castOf: string }) {
  return (
    <aside aria-label="Defences" className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-[14px] border border-panel-border bg-panel p-4" data-defences-rail>
      <span className="font-mono text-[10px] tracking-[0.14em] text-label uppercase">Defences</span>
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
        <a href="#results" className="flex min-h-11 items-center text-[13px] text-layer-2 hover:text-layer-1 focus-visible:rounded focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none" data-open-results>
          Open results <span aria-hidden="true">&nbsp;{"→"}</span>
        </a>
      </div>
    </aside>
  );
}
