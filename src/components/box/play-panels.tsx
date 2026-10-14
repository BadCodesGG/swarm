"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LAYER_NAME, layerNumber, percent } from "@/engine/box/explain";
import {
  CARDS,
  GOAL,
  MAX_TURNS,
  playCard,
  startGame,
  type AgentGame,
  type CardId,
  type TurnResult,
} from "@/lib/box/agent-mode";
import { layerBill, scoreDefence } from "@/lib/box/budget";
import { LAYER_ORDER, type BoxConfig } from "@/lib/box/types";
import type { World } from "@/lib/box/world";
import { LAB_NAME, type LabId } from "@/lib/box/world-types";
import { bestScore, localStore, recordBest } from "./playground";
import { button } from "./toolbar";

const card =
  "flex flex-col gap-3 rounded-[14px] border border-panel-border bg-panel p-[18px]";

/**
 * Defender mode: every layer costs useful work, and the work the layers use up may not pass the
 * budget. The score is the share of hidden-goal agents kept in, times the work kept, for the run so
 * far; over budget it is zero. The best score lives in local storage when the page may use it.
 */
export function DefenderCard({ world }: { world: World | null }) {
  const result = useMemo(
    () =>
      world ? { score: scoreDefence(world), bill: layerBill(world) } : null,
    [world],
  );
  const [stored] = useState(() => bestScore(localStore()));
  const score = result?.score.score ?? 0;
  // A score means little in the first seconds: only a run of some length can set the best.
  const counts = score > 0 && (world?.tick ?? 0) >= 100 ? score : 0;
  const best = Math.max(stored, counts);
  useEffect(() => {
    if (counts > 0) recordBest(localStore(), counts);
  }, [counts]);
  const s = result?.score;
  const used = s ? Math.min(1, s.workLost / s.budget) : 0;
  return (
    <section
      aria-label="Defender score"
      className={`${card} min-[900px]:grid min-[900px]:grid-cols-2 min-[900px]:gap-x-5`}
      data-defender
    >
      <div className="flex flex-col gap-3">
        <span className="font-mono text-[10px] tracking-[0.14em] text-label">
          DEFEND
        </span>
        <p className="m-0 text-xs text-label">
          Keep hidden-goal agents in while the layers use no more than{" "}
          {s ? percent(s.budget) : "25%"} of the useful work. Switch layers on
          and off and watch the bill.
        </p>
        <div className="flex items-baseline justify-between font-mono">
          <span
            className="text-3xl font-semibold text-ink-strong tabular-nums"
            data-defender-score
          >
            {score}
          </span>
          <span className="text-xs text-label">
            score, best <span data-defender-best>{best}</span>
          </span>
        </div>
        <div
          role="meter"
          aria-label="Useful work spent on layers"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(used * 100)}
          aria-valuetext={
            s
              ? `${percent(s.workLost)} of the work spent, budget ${percent(s.budget)}${s.overBudget ? ", over budget" : ""}`
              : "no run yet"
          }
          className="h-3 overflow-hidden rounded-full bg-control"
        >
          <div
            className={`h-full ${s?.overBudget ? "bg-escape" : "bg-haiku"}`}
            style={{ width: `${Math.round(used * 100)}%` }}
          />
        </div>
        <p className="m-0 font-mono text-xs text-muted" data-budget-line>
          {s
            ? `${percent(s.workLost)} of ${percent(s.budget)} spent.${s.overBudget ? " Over budget, so the score is 0." : ""}`
            : "Working it out."}{" "}
          {s ? `${s.stopped} of ${s.rogues} hidden-goal agents kept in.` : ""}
        </p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 self-start p-0 font-mono text-[11px] text-label">
        {LAYER_ORDER.map((l) => (
          <li key={l} className="flex justify-between">
            <span>
              {layerNumber(l)} {LAYER_NAME[l]}
            </span>
            <span className="text-ink">
              {result ? `-${Math.round(result.bill[l] * 100)}%` : "-"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface TurnLine {
  n: number;
  result: TurnResult;
}

const OUTCOME_TEXT: Record<TurnResult["outcome"], string> = {
  advanced: "Landed",
  waited: "Nothing came of it",
  escaped: "Got out",
  caught: "Caught",
  timeout: "Out of turns",
};

/**
 * Play as the agent: a hand of abstract cards against the shown lab's layers as they stand when the
 * game starts. The lab is fiction and so is the agent; each turn's log says which layer ruled.
 */
export function AgentCard({
  lab,
  config,
  seed,
}: {
  lab: LabId;
  config: BoxConfig;
  seed: number;
}) {
  const [game, setGame] = useState<AgentGame>(() => startGame(config, seed));
  const [log, setLog] = useState<TurnLine[]>([]);
  const started = useRef({ lab, seed });
  // A different lab or seed is a different game.
  useEffect(() => {
    if (started.current.lab !== lab || started.current.seed !== seed) {
      started.current = { lab, seed };
      setGame(startGame(config, seed));
      setLog([]);
    }
  }, [lab, seed, config]);
  const play = (id: CardId) => {
    const result = playCard(game, id);
    setGame(result.game);
    setLog((l) => [...l, { n: game.turn + 1, result }]);
  };
  const again = () => {
    setGame(startGame(config, seed));
    setLog([]);
  };
  const last = log[log.length - 1]?.result;
  return (
    <section
      aria-label="Play as the agent"
      className={`${card} min-[900px]:grid min-[900px]:grid-cols-2 min-[900px]:gap-x-5`}
      data-agent-game
      data-game-status={game.status}
    >
      <div className="flex flex-col gap-2.5">
        <span className="font-mono text-[10px] tracking-[0.14em] text-label">
          PLAY AS THE AGENT
        </span>
        <p className="m-0 text-xs text-label">
          A game on a fictional lab. You are a hidden-goal agent inside{" "}
          {LAB_NAME[lab]}; the cards are abstract moves, never instructions.
          Land {GOAL} moves, then get out, within {MAX_TURNS} turns, against the
          layers as they stand now.
        </p>
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 font-mono text-xs whitespace-nowrap text-muted">
          <span>
            Turn {Math.min(game.turn + 1, MAX_TURNS)} of {MAX_TURNS}
          </span>
          <span>
            Moves landed {game.progress} of {GOAL}
          </span>
          <span>Suspicion {Math.round(game.history * 100)}%</span>
        </div>
        {game.status === "playing" ? (
          <ul
            className="m-0 grid list-none grid-cols-2 gap-2 p-0"
            aria-label="Your hand"
          >
            {game.hand.map((id) => (
              <li key={id} className="flex">
                <button
                  type="button"
                  data-card={id}
                  onClick={() => play(id)}
                  className={`${button} w-full flex-col items-start justify-start gap-0.5 py-2 text-left`}
                >
                  <span className="text-[13px] leading-tight font-semibold text-ink">
                    {CARDS[id].label}
                  </span>
                  <span className="text-[11px] leading-tight text-label">
                    {CARDS[id].blurb}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-2" data-game-over>
            <p className="m-0 text-sm font-semibold text-ink">
              {game.status === "escaped"
                ? "You got out."
                : game.status === "caught"
                  ? `The ${LAYER_NAME[game.caughtBy!].toLowerCase()} caught you.`
                  : "You ran out of turns."}
            </p>
            <button
              type="button"
              onClick={again}
              className={button}
              data-new-game
            >
              Play again
            </button>
          </div>
        )}
      </div>
      <p role="status" className="sr-only">
        {last
          ? `${last.card.label}. ${OUTCOME_TEXT[last.outcome]}. ${last.caughtBy ? `Caught by the ${LAYER_NAME[last.caughtBy].toLowerCase()}.` : "No layer caught it."}`
          : ""}
      </p>
      <ol
        className="m-0 flex max-h-[260px] list-none flex-col gap-2 overflow-y-auto p-0 text-xs"
        aria-label="Turn log"
        data-turn-log
      >
        {log.length === 0 ? (
          <li className="text-faint">No moves yet.</li>
        ) : null}
        {[...log].reverse().map(({ n, result }) => (
          <li
            key={n}
            className="flex flex-col gap-1 rounded-lg bg-white/[0.04] px-2.5 py-2"
            data-turn={n}
          >
            <span className="text-body">
              <span className="font-mono text-faint">{n}</span>{" "}
              {result.card.label}:{" "}
              <b
                className={
                  result.outcome === "caught" ? "text-escape-text" : "text-ink"
                }
              >
                {OUTCOME_TEXT[result.outcome]}
              </b>
            </span>
            <span className="font-mono text-[11px] text-label">
              {result.trace.map((v) => (
                <span
                  key={v.layer}
                  className={`mr-2 ${v.outcome === "catch" ? "text-escape-text" : ""}`}
                >
                  {layerNumber(v.layer)}{" "}
                  {!v.active
                    ? "off"
                    : v.outcome === "catch"
                      ? "CAUGHT"
                      : "pass"}
                </span>
              ))}
            </span>
            <span className="text-label">
              {result.caughtBy
                ? `Caught by the ${LAYER_NAME[result.caughtBy].toLowerCase()}. `
                : ""}
              {result.reason}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
