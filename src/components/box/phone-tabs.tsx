import type { ReactNode } from "react";

export type PanelTab = "story" | "defences" | "results" | "feed";

const icon = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const TABS: { id: PanelTab; label: string; icon: ReactNode }[] = [
  { id: "story", label: "Story", icon: icon(<path d="M4 4h10M4 9h10M4 14h6" />) },
  {
    id: "defences",
    label: "Defences",
    icon: icon(
      <>
        <circle cx="9" cy="9" r="7" />
        <circle cx="9" cy="9" r="3.5" />
      </>,
    ),
  },
  { id: "results", label: "Results", icon: icon(<path d="M3 15V3M3 15h12M6 11l3-3 2 2 4-5" />) },
  { id: "feed", label: "Feed", icon: icon(<path d="M3 4h12v8H8l-3 3v-3H3z" />) },
];

/**
 * The phone's bottom tab bar, fixed to the foot of the window: Story (the map, the timeline and the
 * step card), Defences and Feed (bottom sheets) and Results (the results page). The tab for what is
 * showing carries `aria-current`, and reads in weight and colour, never colour alone.
 */
export function PhoneTabs({ active, onTab }: { active: PanelTab; onTab(tab: PanelTab): void }) {
  return (
    <nav aria-label="Panels" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-panel-border bg-chrome px-1.5 pb-[env(safe-area-inset-bottom)] min-[915px]:hidden" data-phone-tabs>
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-current={active === t.id ? "page" : undefined}
          onClick={() => onTab(t.id)}
          data-phone-tab={t.id}
          className="flex min-h-14 flex-1 flex-col items-center justify-center gap-[3px] border-0 bg-transparent text-[11px] text-label focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none aria-[current=page]:font-semibold aria-[current=page]:text-ink-strong aria-[current=page]:shadow-[inset_0_2px_0_var(--ink-strong)]"
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </nav>
  );
}
