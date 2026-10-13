/**
 * File naming for a Claude Code session folder, shared by the builder (roles), the worker (picking the
 * session) and the tests. A session is `<dir>/<id>.jsonl`; its subagents live in
 * `<dir>/<id>/subagents/agent-<agentId>.jsonl` with an `agent-<agentId>.meta.json` beside each.
 */

export type FileRole = "session" | "subagent" | "meta" | "other";

export interface FileInfo {
  role: FileRole;
  /** The session this file belongs to: `<dir>/<id>` for a session and for its subagent folder. */
  group: string;
  /** The `agentId` a subagent or meta file is named for; empty otherwise. */
  agentKey: string;
}

/** A picked file with the path it had in the folder (`subagents/` prefixes kept). */
export interface PickedFile {
  path: string;
  file: File;
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function stripAgent(name: string, ext: string): string {
  const stem = name.slice(0, name.length - ext.length);
  return stem.startsWith("agent-") ? stem.slice("agent-".length) : stem;
}

export function classifyFile(path: string): FileInfo {
  const parts = normalizePath(path).split("/");
  const name = parts[parts.length - 1] ?? "";
  const folder = parts.lastIndexOf("subagents");
  if (folder >= 0 && folder < parts.length - 1) {
    const group = parts.slice(0, folder).join("/");
    if (name.endsWith(".meta.json")) return { role: "meta", group, agentKey: stripAgent(name, ".meta.json") };
    if (name.endsWith(".jsonl")) return { role: "subagent", group, agentKey: stripAgent(name, ".jsonl") };
    return { role: "other", group, agentKey: "" };
  }
  if (name.endsWith(".jsonl")) {
    const dir = parts.slice(0, -1);
    return { role: "session", group: [...dir, name.slice(0, -".jsonl".length)].join("/"), agentKey: "" };
  }
  return { role: "other", group: "", agentKey: "" };
}

export type Selection =
  | { kind: "none" }
  | { kind: "choose"; sessions: PickedFile[] }
  | { kind: "ok"; session: PickedFile; related: PickedFile[] };

/**
 * Picks the main session and the subagent and meta files that belong to it. With one session every
 * subagent file is its own, wherever the folder was cut. With several, `pick` (a session path) must
 * name one, and only the files under that session's `subagents/` folder come along.
 */
export function selectSession(files: readonly PickedFile[], pick?: string): Selection {
  const infos = files.map((f) => ({ f, info: classifyFile(f.path) }));
  const sessions = infos.filter((x) => x.info.role === "session");
  if (sessions.length === 0) return { kind: "none" };
  let chosen = sessions[0];
  if (sessions.length > 1) {
    const want = pick === undefined ? undefined : normalizePath(pick);
    const hit = want === undefined ? undefined : sessions.find((s) => normalizePath(s.f.path) === want);
    if (!hit) return { kind: "choose", sessions: sessions.map((s) => s.f) };
    chosen = hit;
  }
  const only = sessions.length === 1;
  const related = infos
    .filter((x) => (x.info.role === "subagent" || x.info.role === "meta") && (only || x.info.group === chosen.info.group))
    .map((x) => x.f);
  return { kind: "ok", session: chosen.f, related };
}

/** Subagent transcripts that belong to a session, for the chooser. */
export function countSubagents(files: readonly PickedFile[], session: PickedFile, onlySession: boolean): number {
  const group = classifyFile(session.path).group;
  let n = 0;
  for (const f of files) {
    const info = classifyFile(f.path);
    if (info.role === "subagent" && (onlySession || info.group === group)) n++;
  }
  return n;
}
