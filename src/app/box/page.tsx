import type { Metadata } from "next";
import BoxExperience from "@/components/box/box-experience";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Act 2, The Box",
  description:
    "A labelled simulation of AI agents in three fictional labs. Switch five containment layers off, defend or play the agent, and plot safety against useful work.",
  path: "/box",
});

export default function BoxPage() {
  return <BoxExperience />;
}
