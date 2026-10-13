/** Plain words and numbers for the import screen. Pure, so each is tested without a browser. */

import { TRACE_LIMITS, type ParseError, type ParseReport, type SessionTrace } from "@/lib/trace/types";

const UNITS = ["B", "KB", "MB", "GB", "TB"];

function unitFor(n: number): number {
  let i = 0;
  for (let v = n; v >= 1024 && i < UNITS.length - 1; v /= 1024) i++;
  return i;
}

/** One decimal under 100 ("9.4 MB"), none from 100 up ("118 MB", "640 KB"), and no trailing ".0". */
function scaled(n: number, unit: number): string {
  const v = n / 1024 ** unit;
  return unit === 0 || v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
}

export function formatSize(bytes: number): string {
  const u = unitFor(bytes);
  return `${scaled(bytes, u)} ${UNITS[u]}`;
}

/** "41.2 of 118 MB": both numbers in the total's unit. */
export function formatProgress(bytes: number, total: number): string {
  const u = unitFor(total);
  return `${scaled(Math.min(bytes, total), u)} of ${scaled(total, u)} ${UNITS[u]}`;
}

/** Whole percent read, 0 to 100; 0 while the total is unknown. */
export function percentRead(bytes: number, total: number): number {
  return total > 0 ? Math.min(100, Math.floor((bytes / total) * 100)) : 0;
}

export interface ErrorCopy {
  title: string;
  body: string;
}

/** The three failures a visitor can meet; `several-session-files` opens the chooser instead. */
export function errorCopy(error: ParseError): ErrorCopy {
  switch (error) {
    case "no-conversation":
      return {
        title: "Nothing to replay in that file",
        body: "It is a .jsonl file, but it holds no prompts or replies. Try another session from the same folder.",
      };
    case "read-failed":
      return {
        title: "Could not read that file",
        body: "The browser stopped partway, or the file moved while it was read. Nothing was uploaded. Try again.",
      };
    case "several-session-files":
    case "no-session-file":
      return {
        title: "That is not a session file",
        body: "Pick a .jsonl file from the projects folder, or the folder that holds one. Nothing was uploaded.",
      };
  }
}

/** "2 lines skipped, 1 unknown record", or null when the parse was clean. */
export function reportNote(report: ParseReport): string | null {
  const skipped = report.malformedLines + report.overlongLines;
  const parts: string[] = [];
  if (skipped > 0) parts.push(`${skipped.toLocaleString("en-US")} ${skipped === 1 ? "line" : "lines"} skipped`);
  if (report.unknownTypes > 0) parts.push(`${report.unknownTypes.toLocaleString("en-US")} unknown ${report.unknownTypes === 1 ? "record" : "records"}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

export const truncatedCopy = `Swarm plays up to ${TRACE_LIMITS.events.toLocaleString("en-US")} events and ${TRACE_LIMITS.agents.toLocaleString("en-US")} agents. Everything after that point is left out.`;

/** How many subagents the session started whose transcripts were not in the picked files. */
export function missingChildren(trace: SessionTrace): number {
  return trace.agents.filter((a) => a.childMissing).length;
}

export function missingCopy(n: number): string {
  return `This session started ${n} ${n === 1 ? "subagent" : "subagents"}, but ${n === 1 ? "its file was" : "their files were"} not included. Choose the session's folder to add ${n === 1 ? "it" : "them"}.`;
}

/** "6 agents", "1 agent", "no agents". */
export function agentsCopy(n: number): string {
  return n === 0 ? "no agents" : `${n} ${n === 1 ? "agent" : "agents"}`;
}
