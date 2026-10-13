import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createTraceBuilder, type TraceLimits } from "./build";
import { categorize } from "./categories";
import { feed, fixtureFiles, ORIGINALS_FILE } from "./__fixtures__/read";
import { TRACE_LIMITS, type ParseResult, type SessionTrace } from "./types";
import { validateTrace } from "./validate";

function parseFixture(limits?: Partial<TraceLimits>) {
  const builder = createTraceBuilder(limits);
  feed(builder, fixtureFiles());
  return builder.finish();
}

function traceOf(r: ParseResult): SessionTrace {
  if (!r.ok) throw new Error(`parse failed: ${r.error}`);
  return r.trace;
}

// ---------------------------------------------------------------- hand-built sessions

const T0 = Date.UTC(2000, 0, 1);
const ts = (s: number) => new Date(T0 + s * 1000).toISOString();
const human = (t: number, text = "hello") =>
  JSON.stringify({ type: "user", timestamp: ts(t), origin: { kind: "human" }, message: { role: "user", content: text } });
const assistant = (t: number, id: string, blocks: unknown[], usage?: Record<string, number>, model = "claude-opus-5-5") =>
  JSON.stringify({ type: "assistant", timestamp: ts(t), message: { id, model, content: blocks, usage } });
const text = (s: string) => ({ type: "text", text: s });
const toolUse = (id: string, name: string, input: Record<string, unknown> = {}) => ({ type: "tool_use", id, name, input });
const result = (t: number, id: string, toolUseResult?: unknown, isError?: boolean) =>
  JSON.stringify({
    type: "user",
    timestamp: ts(t),
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: isError }] },
    toolUseResult,
  });
const meta = (toolUseId: string, extra: Record<string, unknown> = {}) => JSON.stringify({ toolUseId, agentType: "general-purpose", ...extra });

interface Session {
  main: string[];
  /** agentId -> transcript lines */
  children?: Record<string, string[]>;
  metas?: Record<string, string>;
}

function build(s: Session, limits?: Partial<TraceLimits>) {
  const b = createTraceBuilder(limits);
  for (const l of s.main) b.line("s.jsonl", l);
  for (const [id, lines] of Object.entries(s.children ?? {})) for (const l of lines) b.line(`s/subagents/agent-${id}.jsonl`, l);
  for (const [id, m] of Object.entries(s.metas ?? {})) b.meta(`s/subagents/agent-${id}.meta.json`, m);
  return b.finish();
}

describe("createTraceBuilder: linking and times", () => {
  it("places a background spawn's return at the child's last record, not at the launch result", () => {
    const r = build({
      main: [
        human(0),
        assistant(1, "m1", [toolUse("TU1", "Agent", { description: "dig", subagent_type: "Explore", run_in_background: true })]),
        result(2, "TU1", { isAsync: true, status: "async_launched", agentId: "aaa" }),
        assistant(3, "m2", [text("waiting")]),
        assistant(120, "m3", [text("done")]),
      ],
      children: { aaa: [assistant(5, "c1", [text("working")]), assistant(100, "c2", [text("finished")])] },
      metas: { aaa: meta("TU1") },
    });
    const t = traceOf(r);
    expect(validateTrace(t)).toEqual([]);
    const a = t.agents[1];
    expect(a).toMatchObject({ background: true, returned: true, spawnT: 1, returnT: 100, childMissing: false, label: "dig", agentType: "Explore" });
    const ret = t.events.find((e) => e.kind === "return");
    expect(ret).toMatchObject({ t: 100, agent: 0, child: 1 });
    expect(t.events[ret?.call ?? -1]).toMatchObject({ kind: "spawn", child: 1, t: 1 });
  });

  it("places a foreground return at the child's last record, falling back to the result's duration", () => {
    const main = (id: string) => [
      human(0),
      assistant(1, "m1", [toolUse("TU1", "Agent", { description: "x" })]),
      result(31, "TU1", { status: "completed", agentId: id, totalDurationMs: 28_000, totalTokens: 900, totalToolUseCount: 3, resolvedModel: "claude-haiku-5-5" }),
    ];
    const withChild = traceOf(build({ main: main("aaa"), children: { aaa: [assistant(2, "c1", [text("hi")]), assistant(20, "c2", [text("bye")])] }, metas: { aaa: meta("TU1") } }));
    expect(withChild.agents[1].returnT).toBe(20);
    const noChild = traceOf(build({ main: main("aaa") }));
    expect(noChild.agents[1]).toMatchObject({ childMissing: true, returned: true, returnT: 29, model: "haiku", toolCalls: 3 });
    expect(noChild.agents[1].usage.input).toBe(900);
    expect(validateTrace(noChild)).toEqual([]);
  });

  it("falls back to the parent's result time for a foreground spawn with no duration, and never for a background one", () => {
    const fg = traceOf(build({ main: [human(0), assistant(1, "m1", [toolUse("TU1", "Agent")]), result(9, "TU1", { status: "completed" })] }));
    expect(fg.agents[1]).toMatchObject({ returned: true, returnT: 9 });
    const bg = traceOf(
      build({
        main: [human(0), assistant(1, "m1", [toolUse("TU1", "Agent", { run_in_background: true })]), result(2, "TU1", { isAsync: true, status: "async_launched" }), assistant(50, "m2", [text("x")])],
      }),
    );
    expect(bg.agents[1]).toMatchObject({ returned: false, returnT: 50, childMissing: true });
    expect(bg.duration).toBe(50);
    expect(bg.events.some((e) => e.kind === "return")).toBe(false);
    expect(validateTrace(bg)).toEqual([]);
  });

  it("links a nested spawn across files and gives it depth 2", () => {
    const t = traceOf(
      build({
        main: [human(0), assistant(1, "m1", [toolUse("TU1", "Agent", { description: "outer" })]), result(60, "TU1", { status: "completed", agentId: "aaa" })],
        children: {
          aaa: [assistant(2, "c1", [toolUse("TU2", "Agent", { description: "inner" })]), result(30, "TU2", { status: "completed", agentId: "bbb" }), assistant(50, "c2", [text("ok")])],
          bbb: [assistant(10, "d1", [toolUse("T3", "Read")]), result(11, "T3"), assistant(25, "d2", [text("fin")])],
        },
        metas: { aaa: meta("TU1"), bbb: meta("TU2", { parentAgentId: "aaa", spawnDepth: 2 }) },
      }),
    );
    expect(validateTrace(t)).toEqual([]);
    expect(t.agents.map((a) => [a.id, a.parent, a.depth])).toEqual([[0, -1, 0], [1, 0, 1], [2, 1, 2]]);
    const spawn = t.events.find((e) => e.kind === "spawn" && e.child === 2);
    expect(spawn?.agent).toBe(1);
    expect(t.events.find((e) => e.kind === "return" && e.child === 2)).toMatchObject({ agent: 1, t: 25 });
    expect(t.events.filter((e) => e.agent === 2 && e.kind === "call")).toHaveLength(1);
  });

  it("clamps a child's clock skew into its window and keeps results after their calls", () => {
    const t = traceOf(
      build({
        main: [human(100), assistant(101, "m1", [toolUse("TU1", "Agent")]), result(120, "TU1", { status: "completed", agentId: "aaa" })],
        // The child's clock starts 40 s before the spawn and runs 30 s past its last record.
        children: { aaa: [assistant(60, "c1", [toolUse("T1", "Bash")]), result(55, "T1"), assistant(119, "c2", [text("end")])] },
        metas: { aaa: meta("TU1") },
      }),
    );
    expect(validateTrace(t)).toEqual([]);
    const a = t.agents[1];
    for (const e of t.events.filter((x) => x.agent === 1)) {
      expect(e.t).toBeGreaterThanOrEqual(a.spawnT);
      expect(e.t).toBeLessThanOrEqual(a.returnT);
    }
  });

  it("rebases to seconds from the earliest main-file conversation record, ignoring housekeeping before it", () => {
    const t = traceOf(
      build({
        main: [JSON.stringify({ type: "queue-operation", timestamp: ts(-500) }), human(1000), assistant(1010, "m1", [text("hi")])],
      }),
    );
    expect(t.events[0]).toMatchObject({ kind: "prompt", t: 0 });
    expect(t.duration).toBe(10);
  });

  it("sorts events stably and sets the labels, source and flags of an upload", () => {
    const t = traceOf(build({ main: [human(0), assistant(0, "m1", [toolUse("A", "Read"), toolUse("B", "Grep")]), result(0, "A"), result(0, "B")] }));
    expect(t.source).toBe("upload");
    expect(t.truncated).toBe(false);
    expect(t.events.map((e) => e.kind + (e.tool ?? ""))).toEqual(["prompt", "turn", "callRead", "callGrep", "resultRead", "resultGrep"]);
    expect(validateTrace(t)).toEqual([]);
  });
});

describe("createTraceBuilder: copied fields", () => {
  it("counts usage once per message.id, from the record with the largest output_tokens", () => {
    const u = (output: number) => ({ input_tokens: 3, output_tokens: output, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 });
    const t = traceOf(
      build({
        main: [
          human(0),
          assistant(1, "msgA", [text("one")], u(5)),
          assistant(2, "msgA", [toolUse("T1", "Read")], u(50)),
          assistant(3, "msgA", [toolUse("T2", "Grep")], u(20)),
          assistant(4, "msgB", [text("two")], u(9)),
        ],
      }),
    );
    const turns = t.events.filter((e) => e.kind === "turn");
    expect(turns).toHaveLength(2);
    expect(turns[0].usage).toEqual({ input: 3, output: 50, cacheRead: 100, cacheWrite: 7 });
    expect(t.agents[0].usage).toEqual({ input: 6, output: 59, cacheRead: 200, cacheWrite: 14 });
    expect(turns[0].excerpt).toBe("one");
  });

  it("categorizes advisor and web tools, including server tool blocks, and counts calls", () => {
    const t = traceOf(
      build({
        main: [
          human(0),
          assistant(1, "m1", [{ type: "server_tool_use", id: "srv1", name: "advisor", input: {} }, toolUse("W1", "WebFetch"), toolUse("W2", "mcp__chrome-driver__navigate"), toolUse("W3", "mcp__notes__add")]),
          result(2, "W1"),
          result(3, "W2", undefined, true),
        ],
      }),
    );
    const calls = t.events.filter((e) => e.kind === "call");
    expect(calls.map((e) => [e.tool, e.category])).toEqual([
      ["advisor", "advisor"],
      ["WebFetch", "web"],
      ["mcp__chrome-driver__navigate", "web"],
      ["mcp__notes__add", "mcp"],
    ]);
    expect(t.events.filter((e) => e.kind === "result").map((e) => e.isError)).toEqual([false, true]);
    expect(t.agents[0].toolCalls).toBe(4);
  });

  it("takes prompt text only from human origin and a turn's first text block", () => {
    const t = traceOf(
      build({
        main: [
          human(0, "  first\nline  "),
          JSON.stringify({ type: "user", timestamp: ts(1), origin: { kind: "task-notification" }, message: { role: "user", content: "not a prompt" } }),
          JSON.stringify({ type: "user", timestamp: ts(2), message: { role: "user", content: "also not" } }),
          assistant(3, "m1", [{ type: "thinking", thinking: "secret thoughts", signature: "sig" }, text("  the   visible\ntext "), text("second block")]),
        ],
      }),
    );
    expect(t.events.filter((e) => e.kind === "prompt")).toEqual([{ t: 0, agent: 0, kind: "prompt", excerpt: "first\nline" }]);
    expect(t.events.find((e) => e.kind === "turn")?.excerpt).toBe("the visible text");
    expect(JSON.stringify(t)).not.toMatch(/secret thoughts|sig/);
  });

  it("never copies cwd, branch, classifier context, attachments, thinking or tool bodies", () => {
    const rec = (o: Record<string, unknown>) => JSON.stringify({ cwd: "SENTINEL-CWD", gitBranch: "SENTINEL-BRANCH", serverClassifierContext: { x: "SENTINEL-CLASSIFIER" }, ...o });
    const t = traceOf(
      build({
        main: [
          rec({ type: "user", timestamp: ts(0), origin: { kind: "human" }, message: { role: "user", content: "go" } }),
          rec({ type: "attachment", timestamp: ts(1), attachment: { content: "SENTINEL-ATTACH" } }),
          rec({ type: "assistant", timestamp: ts(2), message: { id: "m", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "T", name: "Bash", input: { command: "SENTINEL-COMMAND" } }] } }),
          rec({ type: "user", timestamp: ts(3), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "T", content: "SENTINEL-OUTPUT" }] }, toolUseResult: { stdout: "SENTINEL-STDOUT" } }),
          rec({ type: "file-history-snapshot", snapshot: { a: "SENTINEL-HISTORY" } }),
          rec({ type: "bridge-session", id: "SENTINEL-BRIDGE" }),
        ],
      }),
    );
    expect(JSON.stringify(t)).not.toContain("SENTINEL");
  });

  it("treats html in a prompt as text", () => {
    const t = traceOf(build({ main: [human(0, "<img src=x onerror=alert(1)>")] }));
    expect(t.events[0].excerpt).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("createTraceBuilder: report and errors", () => {
  it("counts malformed lines and unknown record types, and ignores blank lines", () => {
    const b = createTraceBuilder();
    for (const l of [human(0), "", "   ", "{not json", "42", JSON.stringify({ type: "brand-new-type", timestamp: ts(1) }), JSON.stringify({ nothing: 1 }), JSON.stringify({ type: "attachment" })]) b.line("s.jsonl", l);
    const r = b.finish();
    expect(r.report).toEqual({ linesRead: 6, malformedLines: 2, overlongLines: 0, unknownTypes: 2, capsHit: [] });
    expect(r.ok).toBe(true);
  });

  it("reports no-session-file, several-session-files and no-conversation", () => {
    const only = createTraceBuilder();
    only.line("s/subagents/agent-a.jsonl", human(0));
    expect(only.finish()).toMatchObject({ ok: false, error: "no-session-file" });

    const two = createTraceBuilder();
    two.line("a.jsonl", human(0));
    two.line("b.jsonl", human(0));
    expect(two.finish()).toMatchObject({ ok: false, error: "several-session-files" });

    const empty = createTraceBuilder();
    empty.line("a.jsonl", JSON.stringify({ type: "attachment", timestamp: ts(0) }));
    expect(empty.finish()).toMatchObject({ ok: false, error: "no-conversation" });
    expect(createTraceBuilder().finish()).toMatchObject({ ok: false, error: "no-session-file" });
  });
});

describe("createTraceBuilder: caps", () => {
  const busy = (n: number) => ({
    main: [human(0), ...Array.from({ length: n }, (_, i) => assistant(i + 1, `m${i}`, [toolUse(`T${i}`, "Read")])), ...Array.from({ length: n }, (_, i) => result(n + i + 1, `T${i}`))],
  });

  it("skips and counts lines over the byte limit", () => {
    const r = build({ main: [human(0), assistant(1, "m", [text("x".repeat(500))]), assistant(2, "n", [text("short")])] }, { lineBytes: 300 });
    expect(r.report.overlongLines).toBe(1);
    expect(r.report.capsHit).toContain("line-bytes");
    const t = traceOf(r);
    expect(t.truncated).toBe(true);
    expect(t.events.filter((e) => e.kind === "turn")).toHaveLength(1);
  });

  it("caps events, keeping room for every return", () => {
    const spawnMany = {
      main: [human(0), ...Array.from({ length: 6 }, (_, i) => assistant(i + 1, `m${i}`, [toolUse(`S${i}`, "Agent", { description: `a${i}` })])), ...Array.from({ length: 6 }, (_, i) => result(20 + i, `S${i}`, { status: "completed" }))],
    };
    const t = traceOf(build(spawnMany, { events: 14 }));
    expect(t.events.length).toBeLessThanOrEqual(14);
    expect(t.truncated).toBe(true);
    expect(validateTrace(t)).toEqual([]);
    const big = build(busy(40), { events: 25 });
    expect(big.report.capsHit).toContain("events");
    expect(traceOf(big).events.length).toBeLessThanOrEqual(25);
    expect(validateTrace(traceOf(big))).toEqual([]);
  });

  it("caps agents, dropping the spawns past the limit", () => {
    const main = [human(0), ...Array.from({ length: 6 }, (_, i) => assistant(i + 1, `m${i}`, [toolUse(`S${i}`, "Agent")])), ...Array.from({ length: 6 }, (_, i) => result(20 + i, `S${i}`, { status: "completed" }))];
    const r = build({ main }, { agents: 3 });
    const t = traceOf(r);
    expect(t.agents).toHaveLength(3);
    expect(r.report.capsHit).toContain("agents");
    expect(t.truncated).toBe(true);
    expect(validateTrace(t)).toEqual([]);
  });

  it("caps files: later files are refused and never read", () => {
    const b = createTraceBuilder({ files: 2 });
    expect(b.accepts("s.jsonl")).toBe(true);
    expect(b.accepts("s/subagents/agent-a.jsonl")).toBe(true);
    expect(b.accepts("s/subagents/agent-b.jsonl")).toBe(false);
    b.line("s.jsonl", human(0));
    b.line("s/subagents/agent-b.jsonl", human(0));
    expect(b.finish().report.capsHit).toEqual(["files"]);
  });

  it("caps excerpts per item and in total", () => {
    const long = "w".repeat(2000);
    const per = traceOf(build({ main: [human(0, long), assistant(1, "m", [text(long)])] }));
    expect(per.events.find((e) => e.kind === "prompt")?.excerpt).toHaveLength(TRACE_LIMITS.prompt);
    expect(per.events.find((e) => e.kind === "turn")?.excerpt).toHaveLength(TRACE_LIMITS.excerpt);

    const short = traceOf(build({ main: [human(0, long), assistant(1, "m", [text(long)])] }, { prompt: 50, excerpt: 20 }));
    expect(short.events.find((e) => e.kind === "prompt")?.excerpt).toHaveLength(50);
    expect(short.events.find((e) => e.kind === "turn")?.excerpt).toHaveLength(20);

    const r = build({ main: [human(0, "a".repeat(60)), assistant(1, "m1", [text("b".repeat(60))]), assistant(2, "m2", [text("c".repeat(60))])] }, { excerptBytes: 100 });
    const total = traceOf(r).events.reduce((n, e) => n + (e.excerpt?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(100);
    expect(r.report.capsHit).toContain("excerpt-bytes");
    expect(traceOf(r).truncated).toBe(true);
  });

  it("never splits a surrogate pair when it cuts an excerpt", () => {
    const t = traceOf(build({ main: [human(0, "x" + "\u{1D11E}".repeat(10))] }, { prompt: 4 }));
    expect(t.events[0].excerpt).toBe("x\u{1D11E}");
  });
});

// ---------------------------------------------------------------- the scrubbed real session

describe("the scrubbed fixture", () => {
  const result = parseFixture();
  const trace = traceOf(result);

  it("parses to a valid trace", () => {
    expect(validateTrace(trace)).toEqual([]);
    expect(trace.source).toBe("upload");
    expect(trace.truncated).toBe(false);
    expect(result.report.capsHit).toEqual([]);
  });

  it("reports the one injected malformed line and the one injected unknown record type", () => {
    expect(result.report.malformedLines).toBe(1);
    expect(result.report.unknownTypes).toBe(1);
    expect(result.report.overlongLines).toBe(0);
    expect(result.report.linesRead).toBeGreaterThan(500);
  });

  it("builds the agent tree: fan-out, a nested spawn, background spawns and spawns without a transcript", () => {
    expect(trace.agents.length).toBeGreaterThanOrEqual(10);
    expect(trace.agents.filter((a) => a.parent === 0).length).toBeGreaterThanOrEqual(8);
    const nested = trace.agents.filter((a) => a.depth === 2);
    expect(nested.length).toBeGreaterThanOrEqual(1);
    for (const n of nested) expect(trace.agents[n.parent].depth).toBe(1);
    expect(trace.agents.filter((a) => a.background).length).toBeGreaterThanOrEqual(5);
    expect(trace.agents.filter((a) => a.childMissing).length).toBeGreaterThanOrEqual(1);
    expect(trace.agents.map((a) => a.model)).toEqual(expect.arrayContaining(["opus", "sonnet", "haiku"]));
    expect(trace.agents.every((a) => a.label.length > 0 && a.label.length <= 80)).toBe(true);
  });

  it("returns each background child at its returnT, after the launch result that ends the spawn call", () => {
    const backgrounded = trace.agents.filter((a) => a.background && a.returned && !a.childMissing);
    expect(backgrounded.length).toBeGreaterThanOrEqual(3);
    for (const a of backgrounded) {
      const ret = trace.events.find((e) => e.kind === "return" && e.child === a.id);
      expect(ret?.t).toBe(a.returnT);
      expect(ret?.agent).toBe(a.parent);
      expect(trace.events[ret?.call ?? -1]).toMatchObject({ kind: "spawn", child: a.id, t: a.spawnT });
      // A child that ran for a while does not return the moment it launched.
      expect(a.returnT).toBeGreaterThan(a.spawnT);
    }
    // At least one background child outlives the spawn by more than a launch round trip.
    expect(Math.max(...backgrounded.map((a) => a.returnT - a.spawnT))).toBeGreaterThan(10);
  });

  it("counts usage once per message.id", () => {
    const records: { id: string; file: string }[] = [];
    for (const f of fixtureFiles()) {
      if (!f.path.endsWith(".jsonl")) continue;
      for (const line of f.text.split("\n")) {
        try {
          const rec = JSON.parse(line);
          if (rec.type === "assistant" && rec.message?.id && !String(rec.message.model).startsWith("<")) records.push({ id: rec.message.id, file: f.path });
        } catch {
          // the injected malformed line
        }
      }
    }
    const distinct = new Set(records.map((r) => `${r.file}\0${r.id}`)).size;
    expect(records.length).toBeGreaterThan(distinct); // the fixture really repeats message ids
    const linked = trace.agents.filter((a) => !a.childMissing).length;
    expect(linked).toBeGreaterThan(1);
    expect(trace.events.filter((e) => e.kind === "turn").length).toBeLessThanOrEqual(distinct);
    expect(trace.events.filter((e) => e.kind === "turn").length).toBeGreaterThan(distinct * 0.9);
    const sum = trace.events.reduce((n, e) => n + (e.kind === "turn" ? (e.usage?.output ?? 0) : 0), 0);
    expect(trace.agents.reduce((n, a) => n + (a.childMissing ? 0 : a.usage.output), 0)).toBe(sum);
  });

  it("categorizes advisor, web and mcp calls", () => {
    const calls = trace.events.filter((e) => e.kind === "call");
    expect(calls.filter((e) => e.category === "advisor")).not.toHaveLength(0);
    expect(calls.filter((e) => e.category === "web")).not.toHaveLength(0);
    expect(calls.filter((e) => e.category === "mcp")).not.toHaveLength(0);
    for (const c of calls) expect(c.category).toBe(c.tool === "advisor" ? "advisor" : categorize(c.tool ?? ""));
    for (const r of trace.events.filter((e) => e.kind === "result")) expect(trace.events[r.call ?? -1].kind).toBe("call");
  });

  it("keeps the injected html prompt as plain text, in an excerpt only", () => {
    const prompts = trace.events.filter((e) => e.kind === "prompt");
    expect(prompts.map((p) => p.excerpt)).toContain("<img src=x onerror=alert(1)>");
    const outside = trace.events.map((e) => ({ ...e, excerpt: undefined }));
    expect(JSON.stringify(outside)).not.toContain("<img");
    expect(JSON.stringify({ ...trace, events: [] })).not.toContain("<img");
  });

  it("copies no sentinel and none of the original values the scrub script replaced", () => {
    const json = JSON.stringify(trace);
    expect(json).not.toContain("FIXTURE-SECRET");
    for (const word of ["BadCodes", "badcodes", "C:\\Users", "@gmail", ".claude-badcodesgg"]) expect(json).not.toContain(word);
    if (fs.existsSync(ORIGINALS_FILE)) {
      const originals = JSON.parse(fs.readFileSync(ORIGINALS_FILE, "utf8")) as string[];
      expect(originals.length).toBeGreaterThan(100);
      expect(originals.filter((o) => json.includes(o))).toEqual([]);
    }
  });

  it("holds none of the original values, the author's name, a path, an email or a profile folder in the fixture files", () => {
    const all = fixtureFiles().map((f) => f.text).join("\n");
    for (const word of ["BadCodes", "badcodes", "C:\\\\Users", "C:\\Users", "@gmail", ".claude-badcodesgg"]) expect(all).not.toContain(word);
    expect(all).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9-]+\.[a-z]{2,}/);
    expect(all).toContain("FIXTURE-SECRET-CWD");
    if (fs.existsSync(ORIGINALS_FILE)) {
      const originals = JSON.parse(fs.readFileSync(ORIGINALS_FILE, "utf8")) as string[];
      expect(originals.filter((o) => all.includes(o))).toEqual([]);
    }
  });

  it("stays valid under every cap, tightened to trigger", () => {
    const cases: [string, Partial<TraceLimits>, string][] = [
      ["line-bytes", { lineBytes: 3000 }, "line-bytes"],
      ["events", { events: 120 }, "events"],
      ["agents", { agents: 5 }, "agents"],
      ["files", { files: 6 }, "files"],
      ["excerpt-bytes", { excerptBytes: 400 }, "excerpt-bytes"],
    ];
    for (const [name, limits, cap] of cases) {
      const r = parseFixture(limits);
      expect(r.report.capsHit, name).toContain(cap);
      const t = traceOf(r);
      expect(t.truncated, name).toBe(true);
      expect(validateTrace(t), name).toEqual([]);
    }
    expect(traceOf(parseFixture({ events: 120 })).events.length).toBeLessThanOrEqual(120);
    expect(traceOf(parseFixture({ agents: 5 })).agents.length).toBeLessThanOrEqual(5);
    expect(traceOf(parseFixture({ excerptBytes: 400 })).events.reduce((n, e) => n + (e.excerpt?.length ?? 0), 0)).toBeLessThanOrEqual(400);
  });

  it("gives the same trace whatever order the files arrive in", () => {
    const files = fixtureFiles();
    const reversed = createTraceBuilder();
    feed(reversed, [files[0], ...files.slice(1).reverse()]);
    expect(traceOf(reversed.finish())).toEqual(trace);
  });
});
