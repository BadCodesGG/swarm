import type { Metadata } from "next";
import ImportScreen from "@/components/inside/import-screen";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Load your session",
  description: "Replay your own Claude Code session as a swarm. The file is read in your browser and never uploaded.",
  path: "/inside/load",
});

export default function LoadPage() {
  return <ImportScreen />;
}
