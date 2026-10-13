import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TraceBuilder } from "../build";

export const FIXTURE_DIR = import.meta.dirname;

/** Where `scripts/scrub-fixture.mjs` leaves the list of original values it replaced (outside the repo). */
export const ORIGINALS_FILE = path.join(os.tmpdir(), "swarm-fixture-originals.json");

export interface FixtureFile {
  /** Relative path, `subagents/` prefix kept, as a folder pick would give it. */
  path: string;
  text: string;
}

/** The scrubbed session first, then its subagent transcripts and meta files. */
export function fixtureFiles(): FixtureFile[] {
  const sub = path.join(FIXTURE_DIR, "session", "subagents");
  const files: FixtureFile[] = [{ path: "session.jsonl", text: fs.readFileSync(path.join(FIXTURE_DIR, "session.jsonl"), "utf8") }];
  for (const f of fs.readdirSync(sub).sort()) {
    files.push({ path: `session/subagents/${f}`, text: fs.readFileSync(path.join(sub, f), "utf8") });
  }
  return files;
}

/** Feeds files to a builder the way the worker does: `.meta.json` whole, everything else by line. */
export function feed(builder: TraceBuilder, files: readonly FixtureFile[]): void {
  for (const f of files) {
    if (f.path.endsWith(".meta.json")) builder.meta(f.path, f.text);
    else for (const line of f.text.split("\n")) builder.line(f.path, line);
  }
}
