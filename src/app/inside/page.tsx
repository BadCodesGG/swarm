import type { Metadata } from "next";
import InsideExperience from "@/components/inside/inside-experience";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Act 1, Inside",
  description: "Replay an AI coding session as a swarm: an orchestrator, subagents spawning and returning, tool calls in flight and web probes leaving the boundary.",
  path: "/inside",
});

export default function InsidePage() {
  return <InsideExperience />;
}
