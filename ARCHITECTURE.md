# Architecture

Scope is the approved plan (`typed-percolating-truffle.md`): `/` landing, `/inside` (Act 1),
`/box` (Act 2), `/about`. Every engine convention follows `../cubic-mm`. React owns the HUD and
overlays only; the scenes are vanilla three r186 `WebGPURenderer` + TSL in `src/engine/`, loaded
on the client after a capability probe; `/` and `/about` load no three. The site has no accounts,
no API routes and no stored user data (a few preferences and the tour flags only), so there is no authorization surface; the Box "layers" are
simulated containment, not app access control.

Dependency direction (an arrow means "may import"):

```
src/app -> src/components -> src/engine/{inside,box} -> src/engine/{shared,audio}
                 |                      |
                 +----------------------+-> src/lib/{trace,box} -> src/lib/rng.ts
scripts/*.mjs -> src/lib/trace (through tsx)
```

`src/lib` imports nothing from `engine`, `components`, `three` or React, so it runs in Vitest,
Node and workers. `engine/inside` and `engine/box` never import each other.

## Modules

### `src/lib/rng.ts`
`rng(seed): () => number` (mulberry32, as `cubic-mm/src/engine/synth.ts`), `fork(seed, stream)`,
`pick(weights, r)`, `sampleQuantiles(q, r)` (piecewise linear in log space over p10..p99). Every
random draw in the project goes through an injected `r`.

### `src/lib/trace/` (Act 1 data)
The one contract both sources emit, so the renderer knows one format.

```ts
// types.ts
export type ModelFamily = "opus" | "fable" | "sonnet" | "haiku" | "other";
export type ToolCategory = "web" | "shell" | "files" | "edit" | "agents" | "advisor" | "plan" | "mcp" | "other";
export type EventKind = "prompt" | "turn" | "call" | "result" | "spawn" | "return" | "compact";
export type PermissionSource = "user" | "rule" | "auto" | "other"; // who allowed a call; "user" is a human wait
export interface CompactInfo { trigger: "manual" | "auto"; preTokens: number; postTokens: number; durationMs: number }
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }

export interface TraceAgent {
  id: number;            // index into agents; 0 is the orchestrator
  parent: number;        // -1 for the orchestrator
  depth: number;
  model: ModelFamily;
  modelId: string;
  agentType: string;     // subagent_type verbatim on upload, a category in samples
  label: string;         // description, at most 80 chars
  spawnT: number;        // seconds from session start
  returnT: number;       // equals duration when it never returned
  returned: boolean;
  background: boolean;
  usage: Usage;          // once per message.id
  toolCalls: number;
  childMissing: boolean; // spawn seen, child transcript not provided
}

export interface TraceEvent {
  t: number;             // seconds from session start; events sorted ascending
  agent: number;
  kind: EventKind;
  category?: ToolCategory; // call, result, spawn ("agents")
  tool?: string;         // tool name; "advisor" for the server tool
  call?: number;         // result/return: index of the matching call/spawn event
  child?: number;        // spawn/return: the subagent's id
  usage?: Usage;         // turn: that assistant message's usage
  isError?: boolean;     // result, and a spawn whose launch failed
  excerpt?: string;      // turn text, handback and a spawn's brief at most 280 chars; human prompts at most 2,000
  permission?: PermissionSource; // result
  size?: number;         // result: characters in the content (a number, never the text)
  thinkMs?: number;      // turn
  compact?: CompactInfo; // compact
}

export interface SessionTrace {
  version: 1;
  source: "sample" | "upload";
  label: string;
  duration: number;
  agents: TraceAgent[];
  events: TraceEvent[];
  truncated: boolean;    // a cap was hit; the HUD says so
}
```

No wall-clock date: `t` starts at 0. A web probe is a `call` with `category: "web"` (WebSearch,
WebFetch, browser MCP tools); an advisor call is a `call` with `category: "advisor"`; a subagent
is a `spawn`/`return` pair, the `return` placed at the child's `returnT`.

| File | Interface | Hides |
|---|---|---|
| `categories.ts` | `categorize(toolName)`, `modelFamily(id)`, `agentTypeCategory(t)` | name tables shared by parser, generator, calibration |
| `validate.ts` | `validateTrace(trace): string[]` (empty is valid) | sorted events, ids exist, parents precede children, child events inside `[spawnT, returnT]`, each `return` has a `spawn`, caps |
| `build.ts` | `createTraceBuilder(limits?)` -> `{ line(file, text), meta(file, text), finish(): ParseResult }` | the transcript schema: record types, `message.id` grouping, linking, dropping personal fields, caps |
| `worker.ts` + `load.ts` | `loadSession(files, onProgress, signal): Promise<ParseResult>` | the worker, streaming each `File` into the builder, abort, crash to `read-failed` |
| `pick-files.ts` | `filesFromInput(FileList)`, `filesFromDrop(DataTransfer)`, `filesFromDirectory(handle)`, each `{ path, file }[]` | the three browser entry points |
| `generate.ts` + `phrases.ts` | `generateTrace(seed, size: "small" \| "medium" \| "large", stats = CALIBRATION)` | the generative model; hand-written generic excerpts |
| `stats.ts` + `calibration.json` | `collectStats(traces): CalibrationStats`, `CALIBRATION` | aggregation; committed aggregates, no text |
| `timeline.ts` | `buildTimeline(trace): Timeline` | typed-array packing and prefix sums |

`ParseResult = { ok: true; trace; report } | { ok: false; error; report }` with `error` one of
`"no-session-file" | "several-session-files" | "no-conversation" | "read-failed"`; `report`
counts lines read, malformed and over-long lines skipped, unknown record types, and caps hit.

`Timeline` turns a trace into playback without replay:

```ts
interface Timeline {
  trace: SessionTrace;
  duration: number;
  indexAt(time: number): number;                       // first event with t > time (binary search)
  countersAt(time: number): Counters;                  // tokens, calls, agents spawned/active, elapsed
  visibleAt(time: number, rate: number): [number, number]; // events whose particle is alive
}
```

It packs `t`, `agent`, `kind`, `category`, `call` into typed arrays with a cumulative array per
counter, so any `t` costs O(log n). Parsed and generated traces go through the same function.

### `src/lib/box/` (Act 2 logic, pure and deterministic)

| File | Interface | Hides |
|---|---|---|
| `types.ts` | `LayerId = "sandbox" \| "permissions" \| "network" \| "monitor" \| "audit"`; `ActionId = "work" \| "write-outside" \| "open-connection" \| "copy-self" \| "ask-permission" \| "split-steps"`; `BoxConfig { layers: Record<LayerId, boolean>; monitorThreshold; auditBudget; rogueFraction }`; `Verdict { outcome: "catch" \| "pass"; layer; reason; cost }` | |
| `actions.ts` | `ACTIONS: Record<ActionId, ActionTraits>` (domain, base suspicion, privileged, label) | the abstract vocabulary; never a real command |
| `layers.ts` | `LAYERS: Record<LayerId, LayerRule>`, `LayerRule = (a: Attempt, ctx: LayerContext) => Verdict`; `evaluate(a, ctx, config)` runs enabled layers innermost first, first catch wins, else a `pass` with summed cost | each rule; rolls arrive in `Attempt`, so a rule is a pure function of its arguments |
| `sim.ts` | `createState(config, seed, agentCount)`, `step(state, r): StepReport` (one decision tick) | agent arrays (role, plan step, suspicion history, status, shell reached, work done), audit budget, escape detection |
| `trials.ts` | `runTrial(config, seed)`, `runTrials(config, n, seed): TrialSummary` (safety = 1 minus escape rate; usefulness = honest work over the all-off baseline on the same seeds) | fixed `TRIAL_AGENTS`/`TRIAL_TICKS` |
| `replay.ts` | `stoppingLayers(config, seed, agentCount, agent, tick): LayerId[]`: the off layers that, turned on alone, keep that agent in by that tick, innermost first, proved by replaying the run (same seed and crowd size) rather than ranked by rule | the replays |
| `world-types.ts`, `world.ts`, `links.ts`, `breakout.ts`, `intercept.ts` | `Scenario { seed, labs: LabSpec[], links: Link[] }`; `createWorld(scenario)` runs several labs (each its own `sim` state, `Cast` of dispositions and layer settings) and a link pass that lets an escaped agent reach another lab through a shared thing (cache, registry, runner, chat bus); `breakoutSteps` numbers the sub-steps of a breakout; `interceptLines` writes the fictional dialogue | the lab and link draws, so a run is a pure function of its scenario |
| `presets.ts`, `share.ts`, `branch.ts`, `seek.ts`, `world-replay.ts`, `world-trials.ts` | `presetScenario(preset, seed?, labs?)` (breakout, default lab, rushed launch, air gapped, everything off); `scenarioToParams` / `scenarioFromParams` (the versioned share format, validated on read); a rebuildable snapshot at any tick; world-wide replays and trials | the share encoding and its limits |
| `agent-mode.ts`, `budget.ts` | Play as the agent (turn-based abstract move cards ruled on by the lab's real layers, rolls a pure function of seed and turn); Defend (the share of work the layers may use up) | the card hand and the budget arithmetic |
| `handoff.ts` | `handoffSearch(trace)` (null for anything but a sample), `parseHandoff(params)` (count clamped, model names an allowlist), `withHandoff(params)` (turns a valid hand-off into the share format's `scenario`), `castFor(models)` | what an Act 1 session may hand to Act 2: a count and model kinds, never text |
| `trials.worker.ts` + `trials-client.ts` | `runTrialsOffThread(config, n, seed, signal)`, `stoppingLayersOffThread(config, seed, agentCount, agent, tick, signal)` | the worker |

The live crowd size is a `createState` argument taken from the quality tier; trials always use
`TRIAL_AGENTS`, so `BoxConfig` carries no size and the plot never depends on the device.

Rules in short (numbers are tuned in slice 6): **sandbox** catches `write-outside` and
`copy-self`. **permissions** catches privileged actions without a granted `ask-permission`; a
rogue's ask is granted when its roll beats the grant rate; honest privileged work pays an ask.
**network** catches `open-connection` to a non-allowlisted target and passes allowlisted ones.
**monitor** scores the action plus the agent's recent history and catches at or above
`monitorThreshold`; `split-steps` lowers each step's score; a low threshold flags honest agents.
**audit** reviews flagged attempts while `auditBudget` lasts; spent, flags pass. Each layer's cost
slows honest work, and an honest agent a layer stops is work lost to that layer every tick after,
so the layers' costs sum to the honest work lost. **Escape**: a rogue's hidden plan is a sequence of harmful steps; once every
step has passed every enabled layer it reaches the outer shell and `StepReport.escaped` names it.

### `src/engine/shared/`
Ported from cubic-mm: `renderer.ts` (`isWebGPU` from `renderer.backend.isWebGPUBackend`),
`post.ts` (`RenderPipeline`, `pass`, `bloom`, vignette, grain), `quality.ts` (`resolveQuality`,
`FrameBudget`, `stepDown`, `maxPixelRatio`; tiers set particle cap, crowd size and pixel ratio),
`prefs.ts` (keys `swarm-quality`, `swarm-motion`, `swarm-audio`; audio defaults off), `events.ts`
(`EventBus<M>`, generic per act), `clock.ts` (delta from `performance.now()`, fixed 1/60 step under
`?shot=`; never `THREE.Clock`), `debug.ts` (`window.__swarm`).

### `src/engine/inside/` (Act 1)
`startInside(canvas, opts): Promise<InsideApp>`, `InsideApp = { bus, isWebGPU, timeline(),
setTrace(trace), play(), pause(), seek(t), setRate(r), time(), rate(), pick(x, y), dispose() }`.
`setTrace` swaps the source without rebuilding the renderer.
- `layout.ts` (pure): station ring, `agentPose(trace, id, t, out)` (orbit by depth and sibling
  order, spawn out of the parent, fold back after `returnT`), `flightPos(event, t, out)` (CPU twin
  of the particle vertex node, used by the picker).
- `playback.ts` (pure): clock state, rate 1 to 200, `particleLife(rate)` so a flight lasts 0.4 to
  2 real seconds at any rate.
- `scene/`: `core.ts`, `agents.ts` (instanced, colour by `ModelFamily`), `tethers.ts`
  (`LineSegments2` + `Line2NodeMaterial`), `stations.ts`, `boundary.ts` (fresnel sphere, flashes
  where web flights cross), `particles.ts`, `pulses.ts` (prompts contracting from the edge).
- `picker.ts`: nearest projected agent or live particle within a radius.

### `src/engine/box/` (Act 2)
`startBox(canvas, opts): Promise<BoxApp>`, `BoxApp = { bus, isWebGPU, configure(config),
reset(seed), stats(), play(), pause(), replayEscape(), setFrame(rect), dispose() }`. It owns the
live `lib/box` state and calls `step` on a fixed 10 Hz accumulator; `stats()` is a versioned
`BoxSnapshot` the HUD polls. The scene is flat and face on: an orthographic camera maps scene
units (px of the design's 760x560 frame) onto the HUD's scene slot (`setFrame`), so the SVG labels
over it share the same viewBox.
- Pure: `layout.ts` (ring radii, crowd homes, wander, escape path and crossings), `explain.ts` (every
  sentence: escape steps, plan, log lines, marker and ring labels), `tally.ts` (folds `StepReport`s
  into counters, log, markers and the latest escape), `labels.ts` (where the scene text goes: no
  label on another, on the trail, or adrift from its mark), `params.ts` (`seed`, `sim=cpu`,
  `shot=escape`: network off, seed 1812, run to its first escape).
- `crowd/index.ts`: `createCrowd({ renderer, isWebGPU, count, forceCpu })` -> `Crowd { mode:
  "gpu" | "cpu"; setTargets(targets, status); step(dt); snap(); idle(); positions: PositionsSource;
  dispose() }`, the shape of cubic-mm's `Simulation` and `SpikeTimesSource`.
- `crowd/integrate.ts` (pure steering toward targets); `crowd/gpu.ts` (its TSL compute twin on a
  storage buffer); `crowd/cpu.ts` + `crowd/worker.ts` (one message in flight, positions
  transferred back, as `cubic-mm/src/engine/sim/cpu.ts`).
- `scene/shells.ts` (one shell per layer, `crack` uniform), `scene/agents.ts`, `scene/internet.ts`
  (the latest escape's trail and escapee), `scene/markers.ts`, `scene/backdrop.ts`.

### `src/engine/audio/`
cubic-mm's `engine.ts`, `handle.ts`, `limiter.ts`, `pool.ts`, `pref.ts`. Subscribes to the act's
bus: Inside `spawn`, `return`, `call` (pitch by category), `web`, `prompt`; Box `catch` (timbre per
layer), `escape`, `trials`. The limiter keeps 200x from becoming a wall of sound.

### `src/components/` and routes
`experience.tsx` (cubic-mm's gate: `probing`, `run`, `still`, `unsupported`; start function and
still image as props, shared by both acts); `inside/` (`hud`, `scrubber`, `counters`,
`source-switcher`, `file-drop`, `detail-card`); `sample-tag.tsx`; `box/panel.tsx`,
`box/trials-plot.tsx` (SVG); `audio-toggle.tsx`; `use-engine.ts` (`useSyncExternalStore` on the
bus plus rAF polling, as cubic-mm's `use-hud.ts`). Routes `src/app/{page,inside/page,box/page,
about/page}.tsx`, each through `pageMetadata()`.

`inside/` now also holds the instrument bank (`bank`, `charts`, `stage-strip`, `now-panel`, `key-panel`,
`agent-lanes`), `roster`, `station-panel`, `recap-card`, `moment` (the shareable URL, samples only)
and `handoff` (the link into the Box, samples only); `box/` holds `box-hud` with its toolbar (presets,
modes, edit world), `lab-panels`, `timeline`, `play-panels` (Defend and Play as the agent), `debrief`,
`event-log` and `outside-panel`.

### `src/components/site/` (the furniture both acts share)
- `tour-state.ts` (pure): `shouldShowTour(act, { search, automated })`, `hasSeenTour`, `markTourSeen`.
  The flag is `swarm-tour-<act>` in `localStorage`; every read and write is in try/catch and a skip is
  also held in memory for the visit, so storage that throws costs nothing but a repeated tour.
  Scripted browsers (`navigator.webdriver`) and `?shot=` frames skip the tour so the scripts that
  drive the acts are never met by a dialog; `?tour=1` forces it (never past the seen flag), `?tour=0`
  turns it off.
- `modal.tsx`: the one dialog (native `<dialog>` + `showModal()`: inert page, top layer). It wraps Tab
  at both ends, closes on Escape, hands focus back, and while open keeps every key from the act's own
  window shortcuts. `tour.tsx` (three steps per act, plain words, no real names) and `help-sheet.tsx`
  build on it.
- `shortcuts.ts`: the keys each act answers, kept beside the handlers they were read from
  (`useShortcuts` in `inside/hud.tsx`; the 1 to 9, Escape and Home keys of the Box).
- `act-tools.tsx`: `ActTools` (tour, ? button and key, sheet; on the Box also the "cast from Act 1"
  note) and `FallbackBadge` (shown when `isWebGPU` is false and the frame is not a reduced-motion
  still; the Box adds "CPU CROWD" from `crowdMode`). Inside mounts it in its HUD header, the Box floats
  it (`float`), as its header is not ours to edit.

**Act 1 to Act 2 hand-off.** `inside/handoff.tsx` renders a link only when `handoffSearch(trace)` is
non-null, which needs `trace.source === "sample"`. `box-experience.tsx` passes the page's parameters
through `withHandoff` before `firstVisitParams`; a link that already names a run (`scenario`, `preset`,
`shot`, `b`, `v`) is left alone. The Box shows model kinds only as a count, never by name.

## Seams

Each test is a colocated `*.test.ts` in Vitest unless it names a script.

| Seam | Adapters | Test that stands there |
|---|---|---|
| `SessionTrace` | `createTraceBuilder` (upload), `generateTrace` (samples) | `validateTrace` is `[]` for the fixture and for 50 seeds per size (`generate.test.ts`, with same-seed deep-equality, seeds differing, size bands) |
| Builder line sink | `trace/worker.ts` (File streams), `scripts/calibrate.mjs` (`node:readline`), Vitest (string arrays) | `build.test.ts` on the fixture (see Testing) |
| `pick-files.ts` | input, drop, directory handle | smoke step 3 through the real file input |
| `Timeline` | one; time varies | `timeline.test.ts`: seek equals play-through; `visibleAt` brackets the live particles |
| Injected `r` | `rng(seed)` | determinism in `generate.test.ts`, `sim.test.ts` |
| `LayerRule` | five rules in `LAYERS` | `layers.test.ts`: per layer one catch, one pass, and "disabled passes everything"; mutation: invert each rule's condition once, a test must fail (slice 6, recorded in the PR) |
| `runTrials` | direct, worker | `trials.test.ts` (all layers off lets rogues escape; same config and seed gives the same summary); smoke step 4 through the worker |
| `Crowd` | `crowd/gpu.ts`, `crowd/cpu.ts` | `integrate.test.ts`; smoke step 5 checks `mode` per backend |
| Pure engine math | `layout.ts`, `playback.ts` | `layout.test.ts`, `playback.test.ts` |
| `EventBus<M>`, prefs storage, `resolveQuality` inputs | HUD/audio/debug; `localStorage`/stub; probe/URL | `events`, `prefs` (audio default off), `quality` tests |
| `window.__swarm` + URL params (`source`, `seed`, `t`, `rate`, `shot=hero`, `webgl=1`, `quality`, `sim=cpu`) | scripted runs | `scripts/smoke.mjs`, `scripts/shot.mjs` |

## Data flow

**Act 1, your own session.** The visitor drops files, picks a folder (`webkitdirectory` input or
`showDirectoryPicker`) or picks one `.jsonl`. `pick-files.ts` makes `{ path, file }[]` (lazy
blobs; nothing is read on the main thread) and `loadSession` posts it to `trace/worker.ts`, which:
1. Picks the main session: the one `.jsonl` outside `subagents/` (none or several is an error).
2. Streams each file through `file.stream().pipeThrough(new TextDecoderStream())`, splits on
   `\n` and feeds `builder.line`; `agent-*.meta.json` goes to `builder.meta`. Progress is bytes.
3. Per line, `JSON.parse`, then copies out only: `type`, `uuid`, `parentUuid`, `timestamp`,
   `isSidechain`, `agentId`, `message.id`, `message.model`, `message.usage`, block types, tool
   names and ids, Agent inputs `description`/`subagent_type`/`model`/`run_in_background`,
   `toolUseResult` `agentId`/`status`/`resolvedModel`/`totalDurationMs`/`totalTokens`/
   `totalToolUseCount`, numbers (`permissionDecision.source` mapped to `user`/`rule`/`auto`/`other`,
   `thinkingDurationMs`, a result's content length, a `compact_boundary`'s `trigger`/`preTokens`/
   `postTokens`/`durationMs`), and capped excerpts (human prompt text where `origin.kind === "human"`,
   a turn's first text block, `handbackReport.text`, and the Agent call's `input.prompt`, the brief
   handed to each subagent, first 280 characters). An `isCompactSummary` record is never a prompt.
   Other tools' arguments and results are not read: no other `input` field, no result text beyond the hand-back. `cwd`, `gitBranch`,
   `serverClassifierContext`, attachments, hook output, `bridge-session` ids, thinking,
   signatures, encrypted advisor content, `toolUseResult` bodies and `file-history-*` are never
   copied. Unknown `type`s are counted and ignored. Nothing leaves the browser.
4. Assistant records group by `message.id` into one `turn`; usage is taken once, from the record
   with the largest `output_tokens`.
5. `finish()` links: parent `Agent` `tool_use.id` -> meta `toolUseId` -> `agentId` ->
   `subagents/agent-<agentId>.jsonl`, across all files regardless of nesting (`spawnDepth`
   cross-checks). `returnT` is the child's last record (its `SubagentHandback`), else
   `spawnT + totalDurationMs`, else the parent's tool_result time. The `return` event sits at
   `returnT`, never at a background spawn's tool_result, which arrives at launch. Child event times
   are clamped into `[spawnT, returnT]` to absorb clock skew. A spawn without a child file gets
   `childMissing: true` and the result totals.
6. Times become seconds from the earliest main-file conversation record; events sort stably.
7. `done` posts the `ParseResult` (structured clone); the main thread runs `buildTimeline`, then
   `app.setTrace`. Nothing is uploaded, cached or stored.

Limits cap the output, not the input (a real large session is about 292 MB and must load): lines
over 4 MB skipped and counted (the largest seen is 1.36 MB), 200,000 events, 2,000 agents, 500
files, excerpts 280 chars (human prompts 2,000), 8 MB of excerpts in total. A cap sets
`truncated` and the trace still plays. The HUD shows each error and the report counts as text.

**Act 1, samples.** `generateTrace(seed, size)` runs on the main thread (large is bounded at
20,000 events) and goes through `buildTimeline` and `setTrace` like an upload. The preset fixes the
skeleton (prompts, orchestrator turns, depth cap, minimum parallel fan-out groups, at least one
advisor call and one web probe); `CALIBRATION` supplies what is inside it:
- turn gaps from a two-state burst/idle model (continue probability, gap quantiles per state);
- calls per turn, category mix, a category-to-category transition table, latency quantiles per
  category, error rate;
- spawns per orchestrator turn, parallel group size, probability a child spawns, background
  fraction, child duration and tool-call quantiles, model mix by depth, agent-type mix;
- advisor rate per turn and position in an agent's life; web share, search vs fetch;
- usage quantiles per turn by model family.

Bands (tested): small 3 to 8 agents, 150 to 400 events; medium 10 to 25 agents, depth 2, 1,000 to
3,000 events; large 40 to 120 agents, depth 3, a fan-out of 6 or more, 8,000 to 20,000 events.
Excerpts come from `phrases.ts`. The sample tag shows whenever `trace.source === "sample"`.

**Calibration (offline, once).** `tsx scripts/calibrate.mjs <projects dir>` feeds each local
session through `createTraceBuilder` via `node:readline`, runs `collectStats`, and writes
`src/lib/trace/calibration.json`: quantiles and probability tables only, tool names collapsed to
`ToolCategory` and agent types to categories (no MCP server or plugin names), no excerpts. It
refuses to write if any string value is not a known category key.

**Act 1, playback.** Each frame `t += dt * rate` (clamped); the scene is then a pure function of
`(trace, t, rate)`: poses from `agentPose`, tethers for `spawnT <= t < returnT` plus a fold-in
tail, counters from `countersAt(t)`. Particles are an instanced ring (cap per tier) with
attributes `start`, `end`, `t0`, `t1`, `category`, baked from `layout.ts` at emission; `t0` and
`t1` are playback seconds (after idle cuts), so a flight lives 0.4 to 2 real seconds even across a
cut. The vertex node places each from a `playTime` uniform (playback seconds) and hides it outside
`[t0, t1]`. Playing appends events entering `visibleAt`, however far one frame jumps, so their
sounds play; a seek, a rate change, a new trace or a quality step (an explicit rewrite, never a
guess from the size of the jump) rewrites the ring from `visibleAt(t, rate)` and skips their sounds.

**Act 2, live.** The panel's `BoxConfig` lives in the page's React state and goes to
`app.configure`. Each 10 Hz tick `step(state, r)` decides; the app writes per-agent targets and
status to `crowd.setTargets`; each frame `crowd.step(dt)` moves positions and the agent material
reads `crowd.positions`. Catches go to the bus (shell flash, audio, counters); an escape sets the
`crack` uniform and routes that agent into the internet graph.

**Act 2, trials.** "Run 100 trials" calls `runTrialsOffThread(config, 100, seed)` from the panel.
It needs no engine, so it also works on the reduced-motion still. The summary becomes a point on
`trials-plot.tsx`.

**Stored state.** Only the three `swarm-*` preferences and the two `swarm-tour-*` flags in `localStorage`
(none of them about a session). No database, no
migrations; an unknown value falls back to its default on read.

## Decisions

1. **One plain-object `SessionTrace`; typed arrays only inside `Timeline`.** Readable fixtures,
   `toEqual` tests, cheap worker transfer. Rejected: struct-of-arrays as the contract; separate
   parsed and generated formats. ADR candidate.
2. **Six event kinds; web probe and advisor are call categories.** Smallest contract; the
   renderer routes by category. Rejected: a kind per visual.
3. **The parser core is a line sink shared by worker, calibration and tests.** One schema reading,
   no drift. Rejected: a File-reading parser; a second parser in Node.
4. **`scripts/calibrate.mjs` runs under `tsx` (new devDependency).** No constraints on
   `src/lib/trace` and `@/` resolves. Rejected: Node type stripping (forces `.ts` import
   specifiers and erasable-only syntax; Node 22 before 22.18 lacks it).
5. **Cap output, not input.** Rejected: a file-size cap, which would refuse the 292 MB session.
6. **Usage once per `message.id`.** Assistant records repeat per block. Rejected: summing records.
7. **No wall-clock time in a trace or the fixture.** Playback needs offsets only; dates are personal.
8. **Act 1 has no compute: time-indexed instanced particles evaluated in the vertex stage.** Seek
   is a buffer rewrite; WebGPU and WebGL2 draw the same. Rejected: a compute particle sim (state
   depends on history, so seeking replays from zero). ADR candidate.
9. **Box rules run on the CPU in `lib/box`; the GPU only integrates positions.** Rules stay unit
   tested and mutation provable; no GPU/CPU parity script, as the integrator decides nothing.
   Rejected: rules in a compute kernel. ADR candidate.
10. **Layer rules take their rolls as arguments.** Deterministic per-rule tests. Rejected: rules
    drawing from `r`.
11. **Fixed 10 Hz decision tick; crowd size from the tier, trial size fixed.** Same seed, same
    result on any display and device. Rejected: crowd size in `BoxConfig`.
12. **Workers live beside their logic** (`trace/worker.ts`, `box/trials.worker.ts`,
    `engine/box/crowd/worker.ts`), as cubic-mm's `sim/worker.ts`. Rejected: `src/workers/`.
13. **`EventBus` is generic over an event map**, one per act. Rejected: one shared map.
14. **Departures from cubic-mm:** audio off by default (the plan), `swarm-*` keys, `window.__swarm`.
15. **Session text renders only as React text; ESLint `react/no-danger` is an error.** The import
    is untrusted input. Rejected: a sanitizer (nothing should be HTML at all).
16. **Widen the fixture `.gitignore` negation to `!src/lib/trace/__fixtures__/**/*.jsonl`.** The
    current `__fixtures__/*.jsonl` negation leaves the `subagents/` child files ignored.
17. **Sequencing: the Act 1 hero frame lands before the parser**, on the contract and a minimal
    generator, so the look is checked early. Reorders plan steps 3 and 4; scope is unchanged.
18. **One native `<dialog>` for the tour and the ? sheet.** Focus trap, inert page and top layer for
    free; a window capture listener keeps the act's shortcuts out. Rejected: a hand-rolled overlay.
19. **The hand-off is a query string read as untrusted input.** `/box` clamps and allowlists it, and
    only samples build one, so an upload cannot reach a URL. Rejected: sessionStorage or a shared
    module (an upload would then sit somewhere it can leak from).
20. **Automated browsers skip the tour, `?tour=1` brings it back.** The smoke and shot scripts drive
    both acts with keys and clicks a modal would swallow. Rejected: seeding the flag in every script.

## Testing

The fixture, `src/lib/trace/__fixtures__/session.jsonl` plus its `subagents/` files, is made by
`scripts/scrub-fixture.mjs` from a real session and committed to a public repo, so the script:
keeps record shapes and housekeeping types; replaces every free text with placeholders; fakes
every id; re-bases every `timestamp` to a fixed epoch (2000-01-01) keeping the offsets; maps MCP
server names in `mcp__<server>__*`, plugin `subagent_type` values and meta `description`/
`agentType` to fakes; keeps the dropped fields with sentinels (`cwd: "FIXTURE-SECRET-CWD"`; a result's content is a sentinel
padded to its length, the parser reads that length); makes the Agent/Task `input.prompt` placeholder
text, the one tool input it copies; and
injects one malformed line, one unknown type and a human prompt `<img src=x onerror=alert(1)>`.
`build.test.ts` asserts the agent tree, a nested and a background spawn (its `return` at
`returnT`), usage once per message, advisor and web categories, report counts, each cap, and that
neither a sentinel nor any original value the script replaced appears in `JSON.stringify(trace)`
or in the fixture files.

`scripts/smoke.mjs` (cubic-mm's shape: `next start`, `--allow-software`, fails on any console
error or `THREE.` warning):
1. `/`: 200, no script carrying `WebGPURenderer`, links to both acts.
2. `/inside?source=small|medium|large&seed=1`: frames advance, counts in band, sample tag visible,
   seeking back reads `countersAt`, rate 200 advances.
3. `/inside` import of the fixture folder with `setInputFiles`: source `upload`, agent count
   matches, `<img src=x` shows as text and the detail card holds no `img`, no network request
   during import; a non-session file shows `no-session-file`.
4. `/box?seed=1`: each toggle changes `__swarm.box.config`; all layers off escapes within N ticks;
   "Run 100 trials" adds a plotted point in time.
5. `?webgl=1` on both acts: `isWebGPU === false`, `crowd.mode === "cpu"`, both run.
6. `/about`: 200, says Act 2 is a simulation, carries each citation, no sideways scroll at 390 px;
   `og:image` is a JPEG.

`scripts/shot.mjs` captures `?shot=hero&t=<s>&source=medium&seed=<n>` on a fixed clock for the
side-by-side design check and the reduced-motion stills.

## Build order

Plan steps 1 (scaffold) and 2 (Claude Design direction picked) come first; each slice lands
with its tests green.

0. Scaffold completion: `scripts/smoke.mjs` (landing only), `.github/workflows/ci.yml` from
   cubic-mm, the `.gitignore` fix, `react/no-danger`, `tsx`, `engine/shared` ported with tests,
   `experience.tsx`, `lib/rng.ts`.
1. Trace contract: `types`, `categories`, `validate`, `timeline`, minimal `generate` (presets on
   flat placeholder distributions), determinism tests.
2. Act 1 hero frame: `/inside?shot=hero` draws a medium sample; screenshots matched to the canvas.
3. Act 1 playback and HUD: clock, scrubber, rates, counters, picking, detail cards, source
   switcher, sample tag; smoke 2.
4. Parser: fixture and scrub script, builder, worker, loader, file and folder import, error
   states; smoke 3.
5. Calibration: `stats.ts`, `calibrate.mjs`, `calibration.json`, full generator, bands tightened.
   The new distributions change what a seed draws, so pick the hero seed again, re-run
   `shot.mjs` and redo the side-by-side comparison from slice 2.
6. Box logic: `lib/box` with per-layer tests, trials worker, the mutation pass.
7. Act 2 render: crowd GPU and CPU, shells, escape, internet, panel, trials plot; smoke 4 and 5.
8. Landing, `/about`, OG, reduced-motion stills, adaptive quality, audio, README; smoke 1 and 6.
   Then plan steps 7 and 8 (Definition of done, deploy, portfolio PR).

## Settled questions

- Idle stretches are compressed. `Timeline` maps trace time to playback time, and the scrubber
  marks each cut ("12 idle min cut").
- "Run 100 trials" adds one point per settings, kept across runs, so a frontier builds up.
- Stations, in ring order: `web`, `plan`, `advisor`, `agents`, `edit`, `mcp`, `files`, `shell`.
  `mcp` is its own station; `files` (read, search) and `edit` (write, edit) stay apart.
- A folder with several top-level sessions shows a chooser (first prompt line, size, agent count).
- Headless Chromium's `setInputFiles` with a directory path on a `webkitdirectory` input keeps the
  `subagents/` prefix in `webkitRelativePath` (`<dir>/session/subagents/agent-*.jsonl`), so smoke 3 uses
  the real folder input.
- Verbatim human prompts are capped at 2,000 characters for display.
- `NEXT_PUBLIC_SITE_URL` may override `SITE_URL`; the default stays the production domain.
- The look is the "Deep Field" canvas (https://claude.ai/artifact/L6bPvtCx7s9LtN5CPALRDV): ground
  `#070910`, text `#eef2f8`, labels `#a7b1c2` / `#8590a3`, models Opus `#ffb54d`, Fable `#a78bff`,
  Sonnet `#4fd8eb`, Haiku `#7ee2a8`, escape `#ff4d7d`, layers `#dbe6ff` to `#5f7cbb` inside out.

## Open questions

None.

```handoff
{
  "modules": [
    "src/lib/rng.ts: seeded mulberry32 and samplers; every draw injected",
    "src/lib/trace: SessionTrace contract, createTraceBuilder line sink, worker + loadSession, pick-files, generateTrace, collectStats + calibration.json, validateTrace, buildTimeline",
    "src/lib/box: actions, LAYERS + evaluate, createState/step, runTrial/runTrials, trials worker client",
    "src/engine/shared: renderer, post (RenderPipeline + bloom), quality, prefs (swarm-*, audio off), generic EventBus, clock, window.__swarm",
    "src/engine/inside: startInside -> InsideApp (setTrace, play, pause, seek, setRate, pick); pure layout + playback; instanced scene",
    "src/engine/box: startBox -> BoxApp (configure, reset, stats); Crowd gpu/cpu; shells, agents, internet",
    "src/engine/audio: cubic-mm audio engine and limiter on each act's bus",
    "src/components: experience gate; inside HUD (scrubber, counters, source switcher, file drop, detail card, sample tag); box panel + trials plot; site/ (tour, ? sheet, WebGL 2 badge)",
    "src/lib/box/handoff.ts: sample-only Inside to Box hand-off, clamped and allowlisted on read",
    "routes /, /inside, /box, /about via pageMetadata()"
  ],
  "seams": [
    "SessionTrace (parse vs generate) -> validateTrace on fixture and 50 seeds per size",
    "builder line sink (worker, node readline, test arrays) -> build.test.ts on scrubbed fixture",
    "Timeline -> seek equals play-through",
    "injected rng -> determinism tests",
    "LayerRule x5 -> one catch + one pass per layer, mutation-proved",
    "runTrials direct vs worker -> trials.test.ts + smoke",
    "Crowd gpu vs cpu -> integrate.test.ts + smoke mode check",
    "window.__swarm + URL params -> scripts/smoke.mjs, scripts/shot.mjs"
  ],
  "decisions": [
    {"choice": "one plain-object SessionTrace; typed arrays only in Timeline", "reason": "readable tests, cheap worker transfer, one renderer format"},
    {"choice": "six event kinds; web probe and advisor are call categories", "reason": "smallest contract"},
    {"choice": "parser core is a line sink shared by worker, calibrate and tests", "reason": "no drift between upload and calibration"},
    {"choice": "calibrate.mjs runs under tsx", "reason": "no import or syntax constraints on src/lib/trace"},
    {"choice": "cap output (4 MB lines, 200k events, 2k agents, excerpt budget), not input", "reason": "a real 292 MB session must load"},
    {"choice": "usage once per message.id", "reason": "assistant records repeat per content block"},
    {"choice": "no wall-clock time in traces or the fixture", "reason": "offsets suffice; dates are personal"},
    {"choice": "Act 1 has no compute; time-indexed instanced particles in the vertex stage", "reason": "seek without replay; same on WebGPU and WebGL2"},
    {"choice": "Box rules on CPU in lib/box; GPU only integrates positions", "reason": "testable, mutation-provable, no parity script"},
    {"choice": "layer rules receive rolls as arguments", "reason": "deterministic per-rule tests"},
    {"choice": "fixed 10 Hz tick; crowd size from tier, trial size fixed", "reason": "same seed, same result on any device"},
    {"choice": "workers colocated with their logic", "reason": "cubic-mm convention"},
    {"choice": "EventBus generic per act", "reason": "typed maps without coupling the acts"},
    {"choice": "audio off by default; swarm-* keys; window.__swarm", "reason": "plan says off; no collisions with cubic-mm"},
    {"choice": "session text only as React text; react/no-danger is an error", "reason": "the import is untrusted input"},
    {"choice": "widen fixture gitignore negation to __fixtures__/**/*.jsonl", "reason": "current one drops subagents/ fixture files"},
    {"choice": "Act 1 hero frame before the parser", "reason": "early look check; sequencing only, scope unchanged"}
  ],
  "build_order": [
    "0 scaffold completion (smoke skeleton, CI, gitignore fix, no-danger, tsx, engine/shared, gate, rng)",
    "1 trace contract, validate, timeline, minimal generator",
    "2 Act 1 hero frame vs design canvas",
    "3 Act 1 playback and HUD",
    "4 parser, scrubbed fixture, worker, file/folder import, error states",
    "5 calibration and full generator; re-pick hero seed and redo the design comparison",
    "6 box logic, per-layer tests, mutation pass",
    "7 Act 2 render, crowd gpu/cpu, panel, trials plot",
    "8 landing, about, OG, reduced-motion stills, quality, audio, README"
  ],
  "open_questions": [
    "compress idle gaps on the timeline? (requester)",
    "trials plot: accumulating point per settings or 100-point cloud? (requester)",
    "full station list; is mcp its own station? (requester, design canvas)",
    "several top-level sessions in a folder: chooser or error? (requester)",
    "2,000-char cap on verbatim prompts acceptable? (requester)",
    "site.ts NEXT_PUBLIC_SITE_URL override vs CLAUDE.md literal SITE_URL (orchestrator)",
    "headless setInputFiles on webkitdirectory keeps subagents/ paths? (slice 4)"
  ]
}
```
