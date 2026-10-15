import { describe, expect, it } from "vitest";
import { isResultsQuery, withResultsView } from "./view";

describe("the results view's address", () => {
  it("is open for ?view=results and nothing else", () => {
    expect(isResultsQuery("?view=results")).toBe(true);
    expect(isResultsQuery("?shot=breakout&view=results")).toBe(true);
    expect(isResultsQuery("?view=map")).toBe(false);
    expect(isResultsQuery("")).toBe(false);
  });
  it("adds the query and keeps the rest", () => {
    expect(withResultsView("/box?shot=breakout", true)).toBe("/box?shot=breakout&view=results");
    expect(withResultsView("/box", true)).toBe("/box?view=results");
  });
  it("removes only the query", () => {
    expect(withResultsView("/box?shot=breakout&view=results", false)).toBe("/box?shot=breakout");
    expect(withResultsView("/box?view=results", false)).toBe("/box");
  });
});
