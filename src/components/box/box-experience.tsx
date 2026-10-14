"use client";

import Experience, { type StartOptions, type StillOptions } from "@/components/experience";
import type { BoxApp } from "@/engine/box/app";
import { withHandoff } from "@/lib/box/handoff";
import { BoxHud } from "./box-hud";
import { firstVisitParams } from "./playground";

/** A plain visit opens the breakout preset. The engine (and three) loads only here, on the client, after the capability probe. */
const start = (canvas: HTMLCanvasElement, opts: StartOptions): Promise<BoxApp> =>
  import("@/engine/box/app").then(({ startBox }) => startBox(canvas, { ...opts, params: firstVisitParams(withHandoff(opts.params)) }));

/** Under reduced motion the HUD stays live over a still frame, so "Run 100 trials" still works. No three loads. */
const stillStart = (canvas: HTMLCanvasElement, opts: StillOptions): Promise<BoxApp> =>
  import("@/engine/box/still").then(({ startBoxStill }) => startBoxStill(canvas, { ...opts, params: firstVisitParams(withHandoff(opts.params)) }));

const overlay = (app: BoxApp, { still }: { still: boolean }) => <BoxHud app={app} still={still} />;

export default function BoxExperience() {
  return (
    <Experience
      start={start}
      stillStart={stillStart}
      still={{ src: "/stills/box.jpg", alt: "A frame of Act 2: five nested containment rings around a crowd of agents, one escaping through a cracked outer ring" }}
      title="Act 2, The Box"
      label="Act 2, The Box: a simulation of agents inside five layers of containment"
      overlay={overlay}
    />
  );
}
