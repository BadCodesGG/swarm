"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A modal dialog on the native `<dialog>`: it traps Tab (wrapping at both ends), makes the page behind it inert and sits in
 * the top layer. Escape calls `onClose`. While it is open no key reaches the act's own window
 * shortcuts (Space, the digits, A and the rest belong to the page under it), and focus goes back to
 * where it was when the dialog closes.
 */
export function Modal({
  labelledBy,
  describedBy,
  onClose,
  closeKey,
  placement = "center",
  returnFocus,
  className = "",
  children,
  ...data
}: {
  /** The dialog's accessible name: the id of its heading. */
  labelledBy: string;
  describedBy?: string;
  onClose(): void;
  /** One more key that closes it (the `?` sheet closes on `?`). */
  closeKey?: string;
  /** "bottom" makes it a bottom sheet: full width, hugging the bottom edge, a click on the dimmed page closes it. */
  placement?: "center" | "bottom";
  /** Where focus goes on close, when the opener is not the element focused at open (a tap does not focus a button in every browser). */
  returnFocus?: () => HTMLElement | null;
  className?: string;
  children: ReactNode;
  "data-dialog"?: string;
  "aria-modal"?: boolean;
  role?: "dialog";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  const back = useRef(returnFocus);
  useEffect(() => {
    close.current = onClose;
    back.current = returnFocus;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    // showModal focuses the first control; the dialog names the one it wants.
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        // Wrap at the ends: the native trap would let focus out to the browser's own controls.
        const stops = [...dialog.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]")].filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0);
        const edge = stops[e.shiftKey ? 0 : stops.length - 1];
        if (stops.length > 0 && (document.activeElement === edge || !dialog.contains(document.activeElement))) {
          e.preventDefault();
          stops[e.shiftKey ? stops.length - 1 : 0].focus();
        }
        return;
      }
      if (e.key === closeKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        close.current();
      }
      // Enter and Space still activate the focused button (that is the default action, not propagation).
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (dialog.open) dialog.close();
      const to = back.current?.() ?? before;
      if (to?.isConnected) to.focus();
    };
  }, [closeKey]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
      onClick={placement === "bottom" ? (e) => e.target === e.currentTarget && close.current() : undefined}
      className={`pointer-events-auto border border-panel-border bg-panel p-0 text-body backdrop:bg-black/55 ${
        placement === "bottom"
          ? "fixed inset-x-0 top-auto bottom-0 m-0 max-h-[calc(100dvh-72px)] w-full max-w-none overflow-hidden rounded-t-[18px] border-b-0 shadow-[0_-20px_40px_rgba(0,0,0,0.5)]"
          : "m-auto max-h-[calc(100dvh-24px)] w-[min(30rem,calc(100vw-24px))] overflow-y-auto rounded-[16px] shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
      } ${className}`}
      {...data}
    >
      {children}
    </dialog>
  );
}

export const dialogButton =
  "pointer-events-auto inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[rgba(150,172,214,0.22)] bg-transparent px-4 text-sm text-body hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none";

export const dialogPrimary =
  "pointer-events-auto inline-flex min-h-11 items-center justify-center rounded-[10px] bg-ink px-5 text-sm font-semibold text-ground hover:bg-white focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:ring-offset-2 focus-visible:ring-offset-panel focus-visible:outline-none";
