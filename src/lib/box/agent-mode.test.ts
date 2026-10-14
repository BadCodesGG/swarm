import { describe, expect, it } from "vitest";
import { CARDS, CARD_IDS, GOAL, HAND_SIZE, MAX_TURNS, playCard, startGame, type AgentGame, type CardId } from "./agent-mode";
import { allOff, DEFAULT_CONFIG } from "./types";
import { only } from "./world-fixtures";

const open = allOff(DEFAULT_CONFIG);
const sandboxOnly = only(DEFAULT_CONFIG, "sandbox");

/** Play the way a player aiming for the exit would: the finisher when dealt, else a groundwork card. */
function pushOn(game: AgentGame): AgentGame {
  const order: CardId[] = ["reach-outside-host", "use-leftover-credential", "act-between-samples", "leave-shared-note", "ask-more-access", "keep-working"];
  let g = game;
  for (let guard = 0; guard < 50 && g.status === "playing"; guard++) g = playCard(g, order.find((c) => g.hand.includes(c))!).game;
  return g;
}

describe("startGame", () => {
  it("deals a hand of distinct cards without the way out, the same every time for a seed", () => {
    const g = startGame(DEFAULT_CONFIG, 12);
    expect(g.hand).toHaveLength(HAND_SIZE);
    expect(new Set(g.hand).size).toBe(HAND_SIZE);
    expect(g.hand).not.toContain("reach-outside-host");
    expect(startGame(DEFAULT_CONFIG, 12).hand).toEqual(g.hand);
    expect(Array.from({ length: 20 }, (_, s) => startGame(DEFAULT_CONFIG, s).hand.join()).filter((x, i, a) => a.indexOf(x) === i).length).toBeGreaterThan(3);
  });

  it("has abstract cards only", () => {
    for (const id of CARD_IDS) {
      expect(CARDS[id].label.length).toBeGreaterThan(0);
      expect(`${CARDS[id].label} ${CARDS[id].blurb}`).not.toContain(String.fromCharCode(0x2014));
      expect(`${CARDS[id].label} ${CARDS[id].blurb}`).not.toMatch(/https?:|\bsudo\b|\bssh\b|\bcurl\b/i);
    }
  });
});

describe("playCard", () => {
  it("with every layer off, the groundwork lands and the way out is dealt, then it opens", () => {
    for (let seed = 1; seed <= 30; seed++) {
      let g = startGame(open, seed);
      let moves = 0;
      while (g.status === "playing" && !g.hand.includes("reach-outside-host")) {
        const pick = g.hand.find((c) => !["keep-working", "ask-more-access"].includes(c))!;
        g = playCard(g, pick).game;
        moves++;
        expect(g.progress).toBe(moves);
      }
      expect(g.progress).toBe(GOAL);
      const out = playCard(g, "reach-outside-host");
      expect(out.outcome).toBe("escaped");
      expect(out.game.status).toBe("escaped");
    }
  });

  it("is deterministic and leaves the game it was given untouched", () => {
    const g = startGame(DEFAULT_CONFIG, 5);
    const frozen = JSON.stringify(g);
    const a = playCard(g, g.hand[0]);
    const b = playCard(g, g.hand[0]);
    expect(JSON.stringify(g)).toBe(frozen);
    expect(a).toEqual(b);
  });

  it("a layer that catches the move ends the game and is named; with the sandbox alone, only the sandbox catches", () => {
    let caught = 0;
    let tried = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = startGame(sandboxOnly, seed);
      if (!g.hand.includes("use-leftover-credential")) continue;
      tried++;
      const r = playCard(g, "use-leftover-credential");
      if (r.outcome === "caught") {
        caught++;
        expect(r.caughtBy).toBe("sandbox");
        expect(r.game.status).toBe("caught");
        expect(r.game.caughtBy).toBe("sandbox");
        expect(r.trace.at(-1)?.outcome).toBe("catch");
        expect(r.trace.at(-1)?.layer).toBe("sandbox");
      } else {
        expect(r.game.status).toBe("playing");
        expect(r.caughtBy).toBeUndefined();
      }
    }
    expect(tried).toBeGreaterThan(20);
    expect(caught / tried).toBeGreaterThan(0.8);
  });

  it("with every layer off nothing is ever caught", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = startGame(open, seed);
      for (const id of g.hand) expect(playCard(g, id).outcome).not.toBe("caught");
    }
  });

  it("uses the lab's layers: the same move is caught under the full set and passes with them off", () => {
    let flipped = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const on = startGame(DEFAULT_CONFIG, seed);
      if (!on.hand.includes("leave-shared-note")) continue;
      const a = playCard(on, "leave-shared-note");
      const b = playCard(startGame(open, seed), "leave-shared-note");
      expect(b.outcome).not.toBe("caught");
      if (a.outcome === "caught") flipped++;
    }
    expect(flipped).toBeGreaterThan(10);
  });

  it("always ends: caught, escaped or out of turns", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const end = pushOn(startGame(DEFAULT_CONFIG, seed));
      expect(["caught", "escaped", "timeout"]).toContain(end.status);
      expect(end.turn).toBeLessThanOrEqual(MAX_TURNS);
    }
  });

  it("refuses a card not in the hand and any play after the end", () => {
    const g = startGame(DEFAULT_CONFIG, 3);
    expect(() => playCard(g, "reach-outside-host")).toThrow(/not in the hand/);
    const end = pushOn(g);
    expect(() => playCard(end, "keep-working")).toThrow(/over/);
  });

  it("keep-working sheds suspicion", () => {
    let g = startGame(DEFAULT_CONFIG, 8);
    for (let guard = 0; guard < 20 && g.status === "playing" && !(g.history > 0.05 && g.hand.includes("keep-working")); guard++) {
      const pick = g.hand.find((c) => c !== "keep-working")!;
      g = playCard(g, pick).game;
    }
    if (g.status === "playing" && g.hand.includes("keep-working")) {
      expect(playCard(g, "keep-working").game.history).toBeLessThan(g.history);
    }
  });
});
