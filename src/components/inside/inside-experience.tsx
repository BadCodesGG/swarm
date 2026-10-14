"use client";

import Experience, { type StartOptions } from "@/components/experience";
import type { InsideApp } from "@/engine/inside/app";
import { Hud } from "./hud";
import { InsideLabels } from "./labels";
import { ReportLine } from "./report-line";

/** The engine (and three) loads only here, on the client, after the capability probe. */
const start = (canvas: HTMLCanvasElement, opts: StartOptions): Promise<InsideApp> =>
  import("@/engine/inside/app").then(({ startInside }) => startInside(canvas, opts));

const overlay = (app: InsideApp) => (
  <>
    <InsideLabels app={app} />
    {app.params.hud ? <ReportLine app={app} /> : null}
    {app.params.hud ? <Hud app={app} /> : null}
  </>
);

export default function InsideExperience() {
  return (
    <Experience
      start={start}
      still={{ src: "/stills/inside.jpg", alt: "A frame of Act 1: an orchestrator core with subagents, tool stations and web probes" }}
      title="Act 1, Inside"
      label="Act 1, Inside: a replay of an AI coding session as a swarm"
      overlay={overlay}
    />
  );
}
