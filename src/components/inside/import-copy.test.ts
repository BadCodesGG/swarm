import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import type { ParseReport } from "@/lib/trace/types";
import { agentsCopy, errorCopy, formatProgress, formatSize, missingChildren, missingCopy, percentRead, reportNote, truncatedCopy } from "./import-copy";

const report = (over: Partial<ParseReport> = {}): ParseReport => ({ linesRead: 10, malformedLines: 0, overlongLines: 0, unknownTypes: 0, capsHit: [], ...over });

describe("sizes", () => {
  it("reads as the design does", () => {
    expect(formatSize(118 * 1024 * 1024)).toBe("118 MB");
    expect(formatSize(9.4 * 1024 * 1024)).toBe("9.4 MB");
    expect(formatSize(640 * 1024)).toBe("640 KB");
    expect(formatSize(12)).toBe("12 B");
    expect(formatSize(3 * 1024)).toBe("3 KB");
  });

  it("shows progress in the total's unit", () => {
    expect(formatProgress(41.2 * 1024 * 1024, 118 * 1024 * 1024)).toBe("41.2 of 118 MB");
    expect(formatProgress(0, 0)).toBe("0 of 0 B");
    expect(formatProgress(5000, 4096)).toBe("4 of 4 KB");
  });

  it("clamps the percentage", () => {
    expect(percentRead(35, 100)).toBe(35);
    expect(percentRead(150, 100)).toBe(100);
    expect(percentRead(5, 0)).toBe(0);
  });
});

describe("copy", () => {
  it("has plain words for each failure and no em dash anywhere", () => {
    const all = (["no-session-file", "no-conversation", "read-failed", "several-session-files"] as const).map(errorCopy);
    expect(all[0].title).toBe("That is not a session file");
    expect(new Set(all.map((c) => c.title)).size).toBe(3);
    for (const c of [...all, { title: truncatedCopy, body: missingCopy(2) }]) expect(c.title + c.body).not.toContain("\u2014");
  });

  it("names the caps from the limits", () => {
    expect(truncatedCopy).toContain("200,000 events");
    expect(truncatedCopy).toContain("2,000 agents");
  });

  it("notes skipped lines and unknown records only when there are some", () => {
    expect(reportNote(report())).toBeNull();
    expect(reportNote(report({ malformedLines: 1, overlongLines: 1, unknownTypes: 1 }))).toBe("2 lines skipped, 1 unknown record");
    expect(reportNote(report({ unknownTypes: 3 }))).toBe("3 unknown records");
  });

  it("counts subagents whose files are missing", () => {
    const trace = generateTrace(1, "small");
    expect(missingChildren(trace)).toBe(0);
    trace.agents[1].childMissing = true;
    trace.agents[2].childMissing = true;
    expect(missingChildren(trace)).toBe(2);
    expect(missingCopy(1)).toContain("1 subagent, but its file was");
    expect(missingCopy(6)).toContain("6 subagents, but their files were");
  });

  it("pluralises agents", () => {
    expect([0, 1, 60].map(agentsCopy)).toEqual(["no agents", "1 agent", "60 agents"]);
  });
});
