/** Whether a query string asks for the Results view (`?view=results`). */
export const isResultsQuery = (search: string): boolean => new URLSearchParams(search).get("view") === "results";

/** A path-and-query with the Results view's query added or removed, everything else kept. */
export function withResultsView(href: string, on: boolean): string {
  const u = new URL(href, "http://x");
  if (on) u.searchParams.set("view", "results");
  else u.searchParams.delete("view");
  return u.pathname + u.search + u.hash;
}
