import { describe, expect, it } from "vitest";
import { classifyFile, selectSession, type PickedFile } from "./session-files";

const pick = (p: string): PickedFile => ({ path: p, file: new File([""], p.split("/").pop() ?? p) });

describe("classifyFile", () => {
  it("tells sessions, subagent transcripts and meta files apart", () => {
    expect(classifyFile("proj/abc.jsonl")).toEqual({ role: "session", group: "proj/abc", agentKey: "" });
    expect(classifyFile("proj/abc/subagents/agent-a1.jsonl")).toEqual({ role: "subagent", group: "proj/abc", agentKey: "a1" });
    expect(classifyFile("proj/abc/subagents/agent-a1.meta.json")).toEqual({ role: "meta", group: "proj/abc", agentKey: "a1" });
    expect(classifyFile("proj/abc/subagents/agent-a1.prefix.json").role).toBe("other");
    expect(classifyFile("notes.txt").role).toBe("other");
  });

  it("accepts backslash paths and a bare subagents/ prefix", () => {
    expect(classifyFile("proj\\abc\\subagents\\agent-a1.jsonl")).toEqual({ role: "subagent", group: "proj/abc", agentKey: "a1" });
    expect(classifyFile("subagents/agent-a1.jsonl").group).toBe("");
  });
});

describe("selectSession", () => {
  it("returns none when no session file is present", () => {
    expect(selectSession([pick("subagents/agent-a.jsonl"), pick("x.txt")]).kind).toBe("none");
  });

  it("takes every subagent file when there is one session, however the folder was cut", () => {
    const files = [pick("s.jsonl"), pick("subagents/agent-a.jsonl"), pick("elsewhere/subagents/agent-b.meta.json"), pick("x.txt")];
    const sel = selectSession(files);
    expect(sel.kind === "ok" && sel.related.map((f) => f.path)).toEqual(["subagents/agent-a.jsonl", "elsewhere/subagents/agent-b.meta.json"]);
  });

  it("asks to choose among several sessions, then takes only the chosen one's subagents", () => {
    const files = [pick("p/one.jsonl"), pick("p/two.jsonl"), pick("p/one/subagents/agent-a.jsonl"), pick("p/two/subagents/agent-b.jsonl")];
    const first = selectSession(files);
    expect(first.kind === "choose" && first.sessions.map((f) => f.path)).toEqual(["p/one.jsonl", "p/two.jsonl"]);
    const second = selectSession(files, "p/two.jsonl");
    expect(second.kind).toBe("ok");
    if (second.kind === "ok") {
      expect(second.session.path).toBe("p/two.jsonl");
      expect(second.related.map((f) => f.path)).toEqual(["p/two/subagents/agent-b.jsonl"]);
    }
    expect(selectSession(files, "p/unknown.jsonl").kind).toBe("choose");
  });
});
