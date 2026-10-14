import { describe, expect, it } from "vitest";
import { leavesPage } from "./leaves-page";

describe("leavesPage", () => {
  const here = "https://swarm.test/inside?source=medium&seed=1&t=4";
  const click = (href: string | null, over: Partial<{ target: string; button: number; modified: boolean }> = {}) => ({ href, target: "", button: 0, modified: false, ...over });

  it("is true for a plain click on a link to another page of the site", () => {
    expect(leavesPage(click("https://swarm.test/box?from=inside&agents=6"), here)).toBe(true);
    expect(leavesPage(click("/about"), here)).toBe(true);
  });

  it("is false for a link that stays on this page", () => {
    expect(leavesPage(click("https://swarm.test/inside?source=large"), here)).toBe(false);
    expect(leavesPage(click("#timeline"), here)).toBe(false);
  });

  it("is false when the click is not a link or opens elsewhere", () => {
    expect(leavesPage(click(null), here)).toBe(false);
    expect(leavesPage(click("https://example.com/"), here)).toBe(false);
    expect(leavesPage(click("/box", { target: "_blank" }), here)).toBe(false);
    expect(leavesPage(click("/box", { modified: true }), here)).toBe(false);
    expect(leavesPage(click("/box", { button: 1 }), here)).toBe(false);
  });
});
