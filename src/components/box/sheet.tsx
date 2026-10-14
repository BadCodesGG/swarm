"use client";

import { useId, type ReactNode } from "react";
import { Modal } from "@/components/site/modal";
import { iconButton } from "./toolbar";

/**
 * A bottom sheet: a modal dialog (`site/modal.tsx`: focus moves in and wraps, the page behind is inert,
 * Escape and the close button close it) sitting on the bottom edge, its heading naming it. Focus goes back
 * to `returnFocus` (the tab that opened it) when it closes. The body scrolls, the heading and close stay.
 */
export function Sheet({
  title,
  onClose,
  returnFocus,
  hook,
  children,
}: {
  title: string;
  onClose(): void;
  returnFocus: () => HTMLElement | null;
  /** The `data-sheet` value, so a script can tell which sheet is up. */
  hook: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Modal labelledBy={id} onClose={onClose} placement="bottom" returnFocus={returnFocus} role="dialog" aria-modal={true} data-dialog={`sheet-${hook}`}>
      <div className="flex max-h-[calc(100dvh-72px)] min-h-[min(60dvh,520px)] flex-col" data-sheet={hook}>
        <span aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[rgba(150,172,214,0.35)]" />
        <div className="flex shrink-0 items-center gap-2 px-4 pt-1.5 pb-2">
          <h2 id={id} className="m-0 flex-1 text-lg font-bold text-ink-strong">
            {title}
          </h2>
          <button type="button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose} className={iconButton} data-sheet-close data-autofocus>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </Modal>
  );
}
