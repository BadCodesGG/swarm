/**
 * Writes a scrubbed copy of a real Claude Code session for use as the parser fixture.
 *
 *   node scripts/scrub-fixture.mjs <session.jsonl> <outDir> [--originals <file>]
 *
 * It keeps the record shapes and housekeeping types, and replaces every string it does not know to
 * be structural (the policy is default-deny):
 *   - the text the parser copies out (human prompts, a turn's text, handbacks, agent descriptions)
 *     becomes neutral placeholder text;
 *   - every other string becomes `FIXTURE-SECRET-<KEY>`, so a parser that wrongly copies a dropped
 *     field leaks a sentinel the tests look for (`cwd` becomes `FIXTURE-SECRET-CWD`);
 *   - every id is faked consistently (a uuid stays a uuid, `toolu_` stays `toolu_`), also across files;
 *   - timestamps are rebased to 2000-01-01 keeping their offsets;
 *   - MCP server and tool names, plugin agent types and agent descriptions are mapped to fakes.
 * It then injects one malformed line, one unknown record type and a human prompt that is HTML.
 *
 * To keep the fixture small, `--main-lines` keeps only some stretches of the main session and
 * `--child-lines` the first lines of each subagent; only subagents a kept spawn points at are written.
 * The committed fixture came from a session of about 6,600 lines and 25 subagent transcripts, run with
 * `--main-lines 0-260,700-750,1055-1065,1900-1990 --child-lines 70`, which keeps a foreground and
 * background fan-out, a nested spawn, two spawns without a transcript, advisor and web calls.
 *
 * Output: `<outDir>/session.jsonl` and `<outDir>/session/subagents/agent-<id>.{jsonl,meta.json}`.
 * The original values it replaced go to a file in the system temp dir (never the repo) so the tests can
 * prove none survived. The script itself re-reads its output and exits 1 if any did.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const EPOCH = Date.UTC(2000, 0, 1);
export const INJECTED_PROMPT = "<img src=x onerror=alert(1)>";
export const DEFAULT_ORIGINALS = path.join(os.tmpdir(), "swarm-fixture-originals.json");

/** Strings whose value is structure, not content: kept as they are. */
const KEEP_KEYS = new Set([
  "type", "role", "subtype", "stop_reason", "service_tier", "speed", "kind", "operation", "status",
  "level", "decision", "source", "reasonType", "userType", "entrypoint", "effort", "perTurnEffort",
  "permissionMode", "promptSource", "turnOrigin", "version", "inference_geo", "renderedRole", "requestShape",
  "reason",
]);

/** Keys whose string value is an id, faked even when it does not look like one. */
const AGENT_ID_KEYS = new Set(["agentId", "parentAgentId"]);
const ID_KEYS = new Set([
  "uuid", "parentUuid", "sessionId", "promptId", "requestId", "serverClassifierRequest", "leafUuid", "messageId",
  "sourceToolAssistantUUID", "logicalParentUuid", "id", "tool_use_id", "toolUseId", "toolUseID", "sourceToolUseID",
  "commandUuid", "deliveryId", "snapshotMessageId", "refusedMessageId", ...AGENT_ID_KEYS,
]);

const ID_PATTERNS = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^(?:srv)?toolu_[A-Za-z0-9]+$/,
  /^msg_[A-Za-z0-9]+$/,
  /^req_[A-Za-z0-9]+$/,
  /^a[0-9a-f]{16}$/,
];

const BUILTIN_TOOLS = new Set([
  "Agent", "Task", "TaskOutput", "TaskStop", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "Bash", "BashOutput",
  "KillShell", "PowerShell", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Grep", "Glob", "LS", "WebSearch",
  "WebFetch", "TodoWrite", "ToolSearch", "Skill", "ExitPlanMode", "EnterPlanMode", "AskUserQuestion", "Monitor",
  "SubagentHandback", "advisor", "web_search", "web_fetch", "ScheduleWakeup", "SendMessage", "Workflow",
]);
const BUILTIN_AGENT_TYPES = new Set(["general-purpose", "Explore", "Plan", "claude-code-guide", "statusline-setup", "main"]);
const WEB_SERVER = /browser|chrome|playwright|puppeteer|fetch|web/i;
/** Housekeeping records are kept in shape but not in number: the first few of each type per file. */
const HOUSEKEEPING_PER_TYPE = 3;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;

/** Line ranges are [from, to) over the non-blank lines of the main session. */
function inRanges(i, ranges) {
  return ranges.some(([from, to]) => i >= from && i < to);
}

function main() {
  const args = process.argv.slice(2);
  const oi = args.indexOf("--originals");
  const originalsFile = oi >= 0 ? args.splice(oi, 2)[1] : DEFAULT_ORIGINALS;
  const opts = { mainRanges: [[0, Infinity]], childLines: Infinity };
  const mi = args.indexOf("--main-lines");
  if (mi >= 0) {
    opts.mainRanges = args.splice(mi, 2)[1].split(",").map((r) => {
      const [from, to] = r.split("-").map(Number);
      return [from, to];
    });
  }
  const ci = args.indexOf("--child-lines");
  if (ci >= 0) opts.childLines = Number(args.splice(ci, 2)[1]);
  const [src, out] = args;
  if (!src || !out) {
    console.error("usage: node scripts/scrub-fixture.mjs <session.jsonl> <outDir> [--originals <file>] [--main-lines 0-260,700-750] [--child-lines 70]");
    process.exit(2);
  }
  return run(src, out, originalsFile, opts);
}

async function run(src, out, originalsFile, opts) {
  const dir = src.replace(/\.jsonl$/, "");
  const subDir = path.join(dir, "subagents");
  const childFiles = new Map(); // agentId -> transcript path
  const metaByToolUse = new Map(); // parent tool_use id -> agentId
  if (fs.existsSync(subDir)) {
    for (const f of fs.readdirSync(subDir).sort()) {
      const id = f.replace(/^agent-/, "").replace(/\.(meta\.json|jsonl)$/, "");
      if (f.endsWith(".jsonl")) childFiles.set(id, path.join(subDir, f));
      else if (f.endsWith(".meta.json")) {
        const toolUseId = JSON.parse(fs.readFileSync(path.join(subDir, f), "utf8")).toolUseId;
        if (toolUseId) metaByToolUse.set(toolUseId, id);
      }
    }
  }

  // Pass 1: the earliest timestamp anywhere, so offsets between files survive the rebase.
  let base = Infinity;
  for (const file of [src, ...childFiles.values()]) {
    for await (const line of lines(file)) {
      const m = /"timestamp":"(\d{4}-\d\d-\d\dT[^"]+)"/.exec(line);
      if (m) base = Math.min(base, Date.parse(m[1]));
    }
  }
  if (!Number.isFinite(base)) throw new Error("no timestamps in the session");

  const st = makeState(base);
  const outSub = path.join(out, "session", "subagents");
  fs.rmSync(path.join(out, "session"), { recursive: true, force: true });
  fs.rmSync(path.join(out, "session.jsonl"), { force: true });
  fs.mkdirSync(outSub, { recursive: true });

  // Only the transcripts a kept spawn points at are written, starting from the main session.
  const written = [];
  const queue = [{ file: src, id: "", main: true }];
  const done = new Set();
  while (queue.length > 0) {
    const s = queue.shift();
    const target = s.main ? path.join(out, "session.jsonl") : path.join(outSub, `agent-${st.fakeId(s.id)}.jsonl`);
    const parts = [];
    const seen = {};
    let injected = false;
    let index = -1;
    for await (const line of lines(s.file)) {
      index++;
      if (s.main ? !inRanges(index, opts.mainRanges) : index >= opts.childLines) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // a real malformed line is dropped; the one the tests count is injected below
      }
      for (const b of Array.isArray(rec.message?.content) ? rec.message.content : []) {
        const child = b?.type === "tool_use" && b.name === "Agent" ? metaByToolUse.get(b.id) : undefined;
        if (child && childFiles.has(child) && !done.has(child)) {
          done.add(child);
          queue.push({ file: childFiles.get(child), id: child, main: false });
        }
      }
      if (rec.type !== "user" && rec.type !== "assistant" && (seen[rec.type] = (seen[rec.type] ?? 0) + 1) > HOUSEKEEPING_PER_TYPE) continue;
      const scrubbed = st.scrubRecord(rec);
      parts.push(JSON.stringify(scrubbed));
      if (s.main && !injected && rec.type === "user" && rec.origin?.kind === "human") {
        injected = true;
        parts.push(JSON.stringify(injectedPrompt(scrubbed, st)));
        parts.push('{"type":"assistant","message":{"id":"msg_FIXTURE');
        parts.push(JSON.stringify({ type: "fixture-unknown-record", uuid: st.syntheticId(1), timestamp: scrubbed.timestamp }));
      }
    }
    fs.writeFileSync(target, parts.join("\n") + "\n");
    written.push(target);
    if (!s.main) {
      const metaSrc = s.file.replace(/\.jsonl$/, ".meta.json");
      if (fs.existsSync(metaSrc)) {
        const meta = st.scrubRecord(JSON.parse(fs.readFileSync(metaSrc, "utf8")));
        const metaTarget = target.replace(/\.jsonl$/, ".meta.json");
        fs.writeFileSync(metaTarget, JSON.stringify(meta));
        written.push(metaTarget);
      }
    }
  }

  const originals = [...st.originals].filter((o) => !st.kept.has(o) && o.length >= 8 && !(o.length < 25 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(o)));
  fs.writeFileSync(originalsFile, JSON.stringify(originals));

  // Verify: nothing replaced may survive in what was written.
  const text = written.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const leaks = originals.filter((o) => text.includes(o));
  for (const word of ["BadCodes", "badcodes", "C:\\\\Users", "@gmail", ".claude-badcodesgg"]) {
    if (text.includes(word)) leaks.push(word);
  }
  const bytes = written.reduce((n, f) => n + fs.statSync(f).size, 0);
  console.log(`wrote ${written.length} files, ${bytes} bytes, ${done.size} subagent transcripts`);
  console.log(`replaced ${originals.length} distinct original values; originals list at ${originalsFile}`);
  if (leaks.length > 0) {
    console.error(`LEAK: ${leaks.length} original values survive in the output`);
    process.exit(1);
  }
}

async function* lines(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim() !== "") yield line;
}

function injectedPrompt(after, st) {
  const rec = structuredClone(after);
  rec.uuid = st.syntheticId(2);
  rec.parentUuid = after.uuid;
  rec.message = { role: "user", content: INJECTED_PROMPT };
  return rec;
}

function makeState(base) {
  const ids = new Map();
  const counters = {};
  const originals = new Set();
  const kept = new Set();
  const texts = { n: 0 };
  const descs = new Map();
  const servers = new Map();
  const mcpTools = new Map();
  const agentTypes = new Map();
  const plainTools = new Map();

  const hex = (n, len) => n.toString(16).padStart(len, "0");

  /** A stable fake with the same shape as the original id, the same one everywhere it appears. */
  function fakeId(orig, forceUuid = false) {
    const known = ids.get(orig);
    if (known) return known;
    const prefix = /^((?:srv)?[a-z]+_)/.exec(orig)?.[1];
    const form = forceUuid || /^[0-9a-f]{8}-/i.test(orig) ? "uuid" : prefix ?? "agent";
    const n = (counters[form] = (counters[form] ?? 0) + 1);
    let fake;
    if (form === "uuid") fake = `00000000-0000-4000-8000-${hex(n, 12)}`;
    else if (form === "agent") fake = `a${hex(n, 16)}`;
    else fake = `${form}FIXTURE${String(n).padStart(10, "0")}`;
    ids.set(orig, fake);
    originals.add(orig);
    return fake;
  }

  const isId = (s) => ID_PATTERNS.some((re) => re.test(s));

  function placeholder(len) {
    texts.n++;
    const unit = `Fixture text ${texts.n}. Lorem ipsum dolor sit amet. `;
    let s = "";
    const want = Math.min(Math.max(len, 12), 400);
    while (s.length < want) s += unit;
    return s.slice(0, want).trimEnd();
  }

  function mapped(map, orig, make) {
    let v = map.get(orig);
    if (v === undefined) {
      v = make(map.size + 1);
      map.set(orig, v);
      originals.add(orig);
    }
    return v;
  }

  function toolName(name) {
    if (name.startsWith("mcp__")) {
      const [, server = "", ...rest] = name.split("__");
      const fakeServer = mapped(servers, server, (n) => `${WEB_SERVER.test(server) ? "browser-server" : "mcp-server"}-${n}`);
      const fakeTool = mapped(mcpTools, rest.join("__"), (n) => `tool-${n}`);
      return `mcp__${fakeServer}__${fakeTool}`;
    }
    if (BUILTIN_TOOLS.has(name)) {
      kept.add(name);
      return name;
    }
    return mapped(plainTools, name, (n) => `custom-tool-${n}`);
  }

  function agentType(t) {
    if (BUILTIN_AGENT_TYPES.has(t)) {
      kept.add(t);
      return t;
    }
    return mapped(agentTypes, t, (n) => `fixture-plugin:agent-${n}`);
  }

  const rebaseMs = (ms) => EPOCH + (ms - base);

  function sentinel(key, s) {
    originals.add(s);
    const label = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(key) ? key : "VALUE"; // a key can be content too
    return `FIXTURE-SECRET-${label.toUpperCase().replace(/_/g, "-")}`;
  }

  const keys = new Map();
  /** Object keys can hold content too (file paths, question text), so only identifier-like ones stay. */
  function scrubKey(k) {
    if (isId(k)) return fakeId(k);
    if (/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(k) || /^claude-[a-z0-9.-]+$/.test(k)) return k;
    return mapped(keys, k, (n) => `FIXTURE-KEY-${n}`);
  }

  const MODEL_KEYS = new Set(["model", "requestedModel", "advisorModel", "resolvedModel"]);

  /** ctx: { copyText: this string is text the parser copies out; parentType: type of the enclosing block } */
  function scrubString(s, key, ctx) {
    if (ISO.test(s)) return new Date(rebaseMs(Date.parse(s))).toISOString();
    if (ID_KEYS.has(key) || isId(s)) return fakeId(s);
    if (KEEP_KEYS.has(key) && /^[A-Za-z0-9_.:-]{1,40}$/.test(s)) {
      kept.add(s);
      return s;
    }
    if (MODEL_KEYS.has(key)) {
      if (/^(claude-|opus|sonnet|haiku|fable|<synthetic>)/.test(s)) {
        kept.add(s);
        return s;
      }
      return sentinel(key, s);
    }
    if (key === "name" && ctx.parentType?.endsWith("tool_use")) {
      kept.add(s);
      return toolName(s);
    }
    if (key === "subagent_type" || key === "agentType") return agentType(s);
    if (key === "description") return mapped(descs, s, (n) => `Fixture task ${n}`);
    if (key === "text" && ctx.copyText) {
      originals.add(s);
      return placeholder(s.length);
    }
    return sentinel(key, s);
  }

  function scrub(v, key, ctx) {
    if (typeof v === "string") return scrubString(v, key, ctx);
    if (typeof v === "number") return v > 1.5e12 ? rebaseMs(v) : v;
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.slice(0, 3).map((x) => scrub(x, key, ctx));
    const child = { ...ctx, parentType: typeof v.type === "string" ? v.type : undefined };
    if (key === "handbackReport") child.copyText = true;
    const o = {};
    for (const [k, val] of Object.entries(v)) o[scrubKey(k)] = scrub(val, k, child);
    return o;
  }

  /** A message body: the first level of text blocks is what the parser copies, so those become placeholders. */
  function scrubMessage(msg, rec) {
    const human = rec.type === "user" && rec.origin?.kind === "human";
    const copy = rec.type === "assistant" || human;
    const o = {};
    for (const [k, v] of Object.entries(msg)) {
      if (k !== "content") {
        o[scrubKey(k)] = scrub(v, k, { copyText: false });
      } else if (typeof v === "string") {
        originals.add(v);
        o[k] = human ? placeholder(v.length) : sentinel("content", v);
      } else if (Array.isArray(v)) {
        o[k] = v.map((b) => scrubBlock(b, copy));
      } else {
        o[k] = scrub(v, k, { copyText: false });
      }
    }
    return o;
  }

  function scrubBlock(b, copy) {
    if (!b || typeof b !== "object") return b;
    const o = {};
    for (const [k, v] of Object.entries(b)) {
      if (b.type === "text" && k === "text" && typeof v === "string") {
        originals.add(v);
        o[k] = copy ? placeholder(v.length) : sentinel("text", v);
      } else {
        o[scrubKey(k)] = scrub(v, k, { copyText: false, parentType: b.type });
      }
    }
    return o;
  }

  function scrubRecord(rec) {
    const o = {};
    for (const [k, v] of Object.entries(rec)) {
      o[scrubKey(k)] = k === "message" && v && typeof v === "object" && !Array.isArray(v) ? scrubMessage(v, rec) : scrub(v, k, { copyText: false });
    }
    return o;
  }

  /** Ids for the records the script adds itself; they stand for no original. */
  const syntheticId = (n) => `00000000-0000-4000-9000-${hex(n, 12)}`;

  return { scrubRecord, fakeId, syntheticId, originals, kept };
}

await main();
