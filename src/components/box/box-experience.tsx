"use client";

import Experience, { type StartOptions } from "@/components/experience";
import type { BoxApp } from "@/engine/box/app";
import { BoxHud } from "./box-hud";

/** The engine (and three) loads only here, on the client, after the capability probe. */
const start = (canvas: HTMLCanvasElement, opts: StartOptions): Promise<BoxApp> =>
  import("@/engine/box/app").then(({ startBox }) => startBox(canvas, opts));

const overlay = (app: BoxApp) => <BoxHud app={app} />;

export default function BoxExperience() {
  return (
    <Experience
      start={start}
      still={{ src: "/stills/box.png", alt: "A frame of Act 2: five nested containment rings around a crowd of agents, one escaping through a cracked outer ring" }}
      title="Act 2, The Box"
      label="Act 2, The Box: a simulation of agents inside five layers of containment"
      overlay={overlay}
    />
  );
}
