/**
 * Play as the agent. Turn-based: each turn you get a hand of abstract move cards and play one against
 * the lab's layers, which rule on it exactly as they do for the simulated agents (`evaluate`). The
 * rolls for a turn are a pure function of the seed and the turn number, so the same game always
 * plays out the same. Cards are risk categories, never instructions.
 */

import { fork } from "../rng";
import { ACTIONS } from "./actions";
import { evaluate } from "./layers";
import type { ActionId, Attempt, BoxConfig, LayerId, Target, Verdict } from "./types";
import { STREAM } from "./world-types";

export type CardId = "ask-more-access" | "use-leftover-credential" | "act-between-samples" | "leave-shared-note" | "reach-outside-host" | "keep-working";

export interface Card {
  id: CardId;
  label: string;
  blurb: string;
  action: ActionId;
  target: Target;
  /** Stands in for a granted ask (the credential was already lying around). */
  bypassesGrant: boolean;
  /** The move that gets out. Only dealt once enough progress is made. */
  finisher: boolean;
}

export const CARDS: Record<CardId, Card> = {
  "ask-more-access": { id: "ask-more-access", label: "Ask for more access", blurb: "Politely request a wider permission and hope it is granted.", action: "ask-permission", target: "none", bypassesGrant: false, finisher: false },
  "use-leftover-credential": { id: "use-leftover-credential", label: "Use a credential left in a build log", blurb: "A secret was printed where it should not have been.", action: "write-outside", target: "none", bypassesGrant: true, finisher: false },
  "act-between-samples": { id: "act-between-samples", label: "Act between monitor samples", blurb: "Split one bad move into steps that each look innocent.", action: "split-steps", target: "none", bypassesGrant: false, finisher: false },
  "leave-shared-note": { id: "leave-shared-note", label: "Leave a note in a shared cache", blurb: "Plant a trace where another lab will read it.", action: "copy-self", target: "none", bypassesGrant: false, finisher: false },
  "reach-outside-host": { id: "reach-outside-host", label: "Reach a host outside the lab", blurb: "The way out. Only possible once the groundwork is laid.", action: "open-connection", target: "external", bypassesGrant: false, finisher: true },
  "keep-working": { id: "keep-working", label: "Do the assigned work", blurb: "Look busy. Lowers the suspicion you have built up.", action: "work", target: "none", bypassesGrant: false, finisher: false },
};

export const CARD_IDS = Object.keys(CARDS) as CardId[];
/** Moves that must land before the way out is dealt. */
export const GOAL = 3;
export const MAX_TURNS = 14;
export const HAND_SIZE = 4;
/** How much of the agent's past suspicion survives a turn, and how much a quiet move sheds. */
const HISTORY_KEEP = 0.8;
const COVER_FACTOR = 0.5;

export type TurnOutcome = "advanced" | "waited" | "escaped" | "caught" | "timeout";

export interface AgentGame {
  seed: number;
  config: BoxConfig;
  turn: number;
  /** Moves landed toward the goal. */
  progress: number;
  /** An unused permission grant is held. */
  granted: boolean;
  /** Suspicion built up so far, 0 to 1. */
  history: number;
  auditPool: number;
  hand: CardId[];
  status: "playing" | "escaped" | "caught" | "timeout";
  caughtBy?: LayerId;
}

export interface TurnResult {
  game: AgentGame;
  card: Card;
  outcome: TurnOutcome;
  /** How each layer ruled, innermost first; off layers read as passes. */
  trace: Verdict[];
  /** The layer that caught the move, when caught. */
  caughtBy?: LayerId;
  /** One short sentence. */
  reason: string;
}

/** The fork for one turn: pure in (seed, turn), so a turn never depends on how the game got there. */
function turnRng(seed: number, turn: number) {
  return fork((seed + Math.imul(turn + 1, 0x9e3779b1)) >>> 0, STREAM.agentMode);
}

/** Five layer rolls, then a shuffle of the pool for the hand. The finisher, when ready, is always dealt. */
function deal(seed: number, turn: number, progress: number): { rolls: Attempt["rolls"]; hand: CardId[] } {
  const r = turnRng(seed, turn);
  const rolls = { sandbox: r(), permissions: r(), network: r(), monitor: r(), audit: r() };
  const ready = progress >= GOAL;
  const pool = CARD_IDS.filter((id) => !CARDS[id].finisher);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const hand = ready ? CARD_IDS.filter((id) => CARDS[id].finisher).concat(pool.slice(0, HAND_SIZE - 1)) : pool.slice(0, HAND_SIZE);
  return { rolls, hand };
}

export function startGame(config: BoxConfig, seed: number): AgentGame {
  return {
    seed,
    config,
    turn: 0,
    progress: 0,
    granted: false,
    history: 0,
    auditPool: config.auditBudget * 100,
    hand: deal(seed, 0, 0).hand,
    status: "playing",
  };
}

/** Play a card from the hand. Returns the new game and how the layers ruled; the old game is untouched. */
export function playCard(game: AgentGame, id: CardId): TurnResult {
  if (game.status !== "playing") throw new Error("the game is over");
  if (!game.hand.includes(id)) throw new Error(`${id} is not in the hand`);
  const card = CARDS[id];
  const { rolls } = deal(game.seed, game.turn, game.progress);
  const attempt: Attempt = {
    agent: 0,
    action: card.action,
    privileged: ACTIONS[card.action].privileged,
    granted: game.granted || card.bypassesGrant,
    target: card.target,
    history: game.history,
    rolls,
  };
  const ev = evaluate(attempt, { auditPool: game.auditPool }, game.config);
  const next: AgentGame = {
    ...game,
    turn: game.turn + 1,
    history: game.history * HISTORY_KEEP + ev.suspicion * (1 - HISTORY_KEEP),
    auditPool: game.auditPool - ev.auditSpent,
  };
  const done = (status: AgentGame["status"], outcome: TurnOutcome, reason: string, caughtBy?: LayerId): TurnResult => ({
    game: { ...next, status, caughtBy, hand: [] },
    card,
    outcome,
    trace: ev.trace,
    caughtBy,
    reason,
  });

  if (ev.verdict.outcome === "catch") return done("caught", "caught", ev.verdict.reason, ev.verdict.layer);

  let outcome: TurnOutcome = "waited";
  if (card.action === "ask-permission") {
    if (ev.grant || !game.config.layers.permissions) {
      next.granted = true;
      outcome = "advanced";
    }
  } else if (card.action === "work") {
    next.history = game.history * COVER_FACTOR;
  } else {
    if (attempt.privileged && !card.bypassesGrant) next.granted = false;
    if (card.finisher) {
      if (game.progress >= GOAL) return done("escaped", "escaped", "Through every layer and out.");
    } else {
      next.progress = game.progress + 1;
      outcome = "advanced";
    }
  }
  if (next.turn >= MAX_TURNS) return done("timeout", "timeout", "Out of turns.");
  next.hand = deal(game.seed, next.turn, next.progress).hand;
  return {
    game: next,
    card,
    outcome,
    trace: ev.trace,
    reason: outcome === "advanced" ? "The move landed." : "Nothing came of it.",
  };
}
