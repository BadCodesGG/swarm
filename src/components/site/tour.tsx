"use client";

import { useId, useState } from "react";
import { Modal, dialogButton, dialogPrimary } from "./modal";
import type { ActId } from "./tour-state";

interface Step {
  title: string;
  body: string;
}

/** Plain words, no names of real companies or techniques. */
export const TOURS: Record<ActId, { name: string; steps: Step[] }> = {
  inside: {
    name: "Act 1, Inside",
    steps: [
      {
        title: "A session, replayed as a swarm",
        body: "The bright core is the orchestrator, the one voice that plans. Each coloured dot is a subagent it sent out, and the rings are the tool stations their calls fly to. Web calls leave through the boundary.",
      },
      {
        title: "Drive the replay",
        body: "Press Space to play or pause, Left and Right to scrub, and 1, 2 or 3 for speed. The timeline along the bottom shows prompts, spawns and tool calls across the whole session.",
      },
      {
        title: "Look closer",
        body: "Click any agent, or press A, to read its brief. D hands the camera back to the director. Load your own session from the top bar: it is read in this browser and goes nowhere. Press ? at any time for every key.",
      },
    ],
  },
  box: {
    name: "Act 2, The Box",
    steps: [
      {
        title: "A simulation, start to finish",
        body: "Three fictional labs hold abstract agents doing abstract work. Nothing here is a real system or a real technique, and no AI is called. A few agents carry a hidden goal of getting out.",
      },
      {
        title: "Layers, and what gets through",
        body: "Each ring is a layer of containment. Switch layers off and watch what gets caught. Numbered markers mark the steps of a breakout: click one, or press 1 to 9, to open its card.",
      },
      {
        title: "Make it yours",
        body: "Pick a preset, then Watch, Defend, or Play as the agent. Edit the world, rewind along the timeline, and read the debrief. Press ? at any time for the keys.",
      },
    ],
  },
};

/** The first-visit tour: a few steps, skippable at any point, closed by Escape. */
export function Tour({ act, onDone }: { act: ActId; onDone(): void }) {
  const { name, steps } = TOURS[act];
  const [at, setAt] = useState(0);
  const id = useId();
  const step = steps[at];
  const last = at === steps.length - 1;

  return (
    <Modal labelledBy={`${id}-title`} describedBy={`${id}-body`} onClose={onDone} data-dialog={`tour-${act}`}>
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <p className="m-0 font-mono text-[11px] tracking-[0.16em] text-label" data-tour-progress>
          {name.toUpperCase()} / STEP {at + 1} OF {steps.length}
        </p>
        <h2 id={`${id}-title`} className="m-0 text-xl leading-snug font-bold tracking-[-0.01em] text-ink-strong" data-tour-title>
          {step.title}
        </h2>
        <p id={`${id}-body`} className="m-0 text-[15px] leading-[1.55] text-body">
          {step.body}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onDone} className={dialogButton} data-tour-skip>
            Skip tour
          </button>
          <span className="grow" />
          {at > 0 ? (
            <button type="button" onClick={() => setAt(at - 1)} className={dialogButton} data-tour-back>
              Back
            </button>
          ) : null}
          <button type="button" data-autofocus onClick={() => (last ? onDone() : setAt(at + 1))} className={dialogPrimary} data-tour-next>
            {last ? "Start exploring" : "Next"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
