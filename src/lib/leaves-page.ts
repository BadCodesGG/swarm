/** The parts of a click that decide whether it leaves the page. */
export interface LinkClick {
  /** The anchor's resolved `href`, or null when the click was not on a link. */
  href: string | null;
  target: string;
  button: number;
  modified: boolean;
}

/**
 * Does this click start a navigation away from the page in this tab? Both acts act on it: the
 * engine stops (a software-rendered scene otherwise holds the main thread for most of a minute and
 * the router cannot finish), and Act 1's moment sync stops (a `replaceState` while the router is
 * still loading the next page would put it back here).
 */
export function leavesPage(click: LinkClick, here: string): boolean {
  if (click.href === null || click.button !== 0 || click.modified || (click.target !== "" && click.target !== "_self")) return false;
  const from = new URL(here);
  const to = new URL(click.href, here);
  return to.origin === from.origin && to.pathname !== from.pathname;
}

/** The same, read off a DOM click event. */
export function clickLeavesPage(e: MouseEvent): boolean {
  const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
  return leavesPage({ href: a ? a.href : null, target: a?.target ?? "", button: e.button, modified: e.ctrlKey || e.metaKey || e.shiftKey || e.altKey }, window.location.href);
}
