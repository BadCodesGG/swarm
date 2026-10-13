/**
 * Rebuilds src/lib/trace/calibration.json from local Claude Code sessions.
 *
 *   npx tsx scripts/calibrate.mjs <projects dir> [<projects dir>...]
 *
 * Each directory is a `projects` folder: one folder per project holding `<session-id>.jsonl` and, per
 * session, `<session-id>/subagents/agent-*.jsonl` with an `agent-*.meta.json` beside each. Every
 * session goes through the same builder an upload does, then `collectStats` folds the trace in.
 *
 * The output is quantiles and probability tables only. The script refuses to write if any string value
 * or key in it is not a known category (see `assertCleanStats`), so no tool, server, plugin or agent
 * name, excerpt, path or id can reach the repo. A directory that does not exist is skipped.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createTraceBuilder } from "../src/lib/trace/build.ts";
import { createCollector, serializeStats } from "../src/lib/trace/stats.ts";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "trace", "calibration.json");

async function feedLines(builder, file, abs) {
  const rl = readline.createInterface({ input: fs.createReadStream(abs, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) builder.line(file, line);
}

/** Reads one session and its subagent files; returns the trace, or null when it holds no conversation. */
async function readSession(projectDir, id) {
  const builder = createTraceBuilder();
  await feedLines(builder, `${id}.jsonl`, path.join(projectDir, `${id}.jsonl`));
  const subDir = path.join(projectDir, id, "subagents");
  if (fs.existsSync(subDir)) {
    for (const name of fs.readdirSync(subDir).sort()) {
      const abs = path.join(subDir, name);
      const rel = `${id}/subagents/${name}`;
      if (name.endsWith(".meta.json")) builder.meta(rel, fs.readFileSync(abs, "utf8"));
      else if (name.endsWith(".jsonl")) await feedLines(builder, rel, abs);
    }
  }
  const result = builder.finish();
  return result.ok ? result.trace : null;
}

async function main(dirs) {
  const collector = createCollector();
  let sessions = 0;
  let skipped = 0;
  let agents = 0;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      console.log(`skip (not found): ${path.basename(path.dirname(dir))}/${path.basename(dir)}`);
      continue;
    }
    for (const project of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const projectDir = path.join(dir, project.name);
      for (const f of fs.readdirSync(projectDir, { withFileTypes: true })) {
        if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
        const trace = await readSession(projectDir, f.name.slice(0, -".jsonl".length));
        if (!trace) {
          skipped++;
          continue;
        }
        collector.add(trace);
        sessions++;
        agents += trace.agents.length;
      }
    }
  }
  if (sessions === 0) throw new Error("calibration refused: no sessions were read");
  const stats = collector.finish();
  const json = serializeStats(stats); // throws before anything is written
  fs.writeFileSync(OUT, json);
  console.log(`read ${sessions} sessions (${skipped} without a conversation skipped), ${agents} agents (orchestrators included)`);
  console.log(`      ${stats.read.turns} turns, ${stats.read.calls} calls`);
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error("usage: npx tsx scripts/calibrate.mjs <projects dir> [<projects dir>...]");
  process.exit(2);
}
main(dirs).catch((e) => {
  console.error(e instanceof Error ? e.message : "calibration failed");
  process.exit(1);
});
