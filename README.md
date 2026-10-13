# Swarm

**Inside an AI: watch an agent swarm think, then see what happens when one tries to leave the box.**

**Live: [swarm.badcodes.dev](https://swarm.badcodes.dev)**

An AI that does real work is not one mind. It is a swarm: one voice that plans, and many that search,
read, write and report back. Swarm is an experiment in two acts, drawn live in the browser with
WebGPU (and WebGL 2 where WebGPU is missing).

## The two acts

**Act 1, Inside** (`/inside`) replays an AI coding session as a 3D swarm: the orchestrator at the
core, subagents spawning out of it and folding back when they return, every tool call flying to a
station for its kind, and every web call leaving the boundary. Scrub it, run it at up to 200x, and
click any agent for what it was doing.

It plays one of three sample sessions (small, medium, large), or your own Claude Code session. The
samples are generated from a seed: their shape follows statistics measured from real sessions, but
every prompt and line of text in them is hand-written and generic, and the player labels them as
samples.

**Act 2, The Box** (`/box`) is a clearly labelled **simulation**. A crowd of abstract agents works
inside five layers of containment (sandbox, permissions, network allowlist, monitor, human audit),
and a few of them have a hidden goal of getting out. Switch layers off and see what gets caught and
what escapes; "Run 100 trials" plots each setup as safety against useful work. Actions are
abstract: the Box never shows a real command, technique or host. Each layer is grounded in
published AI control research; the [about page](https://swarm.badcodes.dev/about) cites it.

## Your session stays on your device

You can load a Claude Code session file (`~/.claude/projects/<project>/<session-id>.jsonl`) or its
folder. It is parsed in a Web Worker in your browser and held in memory for that tab only: it is
never uploaded, never stored, and gone on reload. The site has no API routes and no server code that
could receive it. Session text is untrusted input and is only ever rendered as text.

Raw transcripts never enter this repository: `.gitignore` blocks `*.jsonl` except the scrubbed test
fixture under `src/lib/trace/__fixtures__/`, which `scripts/scrub-fixture.mjs` made with every free
text, id and name replaced and every timestamp moved to a fixed epoch.

## Sound, motion and quality

- Sound is **off by default**. The speaker button in each act turns it on; the choice is remembered
  (`swarm-audio` in localStorage). Every sound is synthesised in Web Audio, through a rate limiter
  and a soft limiter so a 200x replay never becomes a wall of noise.
- Under `prefers-reduced-motion`, each act opens on a still frame instead of the live scene, with a
  way in. The Box keeps its controls there, and "Run 100 trials" still works.
- Quality starts at hi or lite from the device, and on "auto" steps down a tier (hi, mid, lite)
  by itself while frames run slow.

## Running it

Node 22 or 24.

```bash
git clone https://github.com/BadCodesGG/swarm.git
cd swarm
npm install
npm run dev            # http://localhost:3000
```

Checks:

```bash
npm run lint           # ESLint
npm run typecheck      # generates the Next route types, then tsc --noEmit
npm run test           # Vitest: trace contract and parser, generator, box rules, layout, playback, audio, quality
npm run build          # production build
npm run test:smoke     # boots the build and drives the landing page, both acts, the import and /about in Chromium
```

The smoke test needs a build first and Playwright's Chromium (`npx playwright install chromium`).
On a machine without a GPU, `npm run test:smoke -- --allow-software`.

Images, all from the production build (`npm run build` first):

```bash
node scripts/shot.mjs       # Act 1 hero frame into .shots/
node scripts/shot-box.mjs   # Act 2 escape frame into .shots/
node scripts/stills.mjs     # the reduced-motion stills, public/stills/*.jpg
node scripts/og.mjs         # the share card, public/og.jpg (1200x630, under 300 KB)
```

The share card is the static `public/og.jpg`; `NEXT_PUBLIC_SITE_URL` overrides its origin (default
`https://swarm.badcodes.dev`). [ARCHITECTURE.md](ARCHITECTURE.md) describes the modules, contracts
and data flow.

## Credits

Act 2 draws on:

- Ryan Greenblatt, Buck Shlegeris, Kshitij Sachan, Fabien Roger. [AI Control: Improving Safety
  Despite Intentional Subversion](https://arxiv.org/abs/2312.06942). 2023.
- Aryan Bhatt, Cody Rushing, Adam Kaufman, Tyler Tracy, Vasil Georgiev, David Matolcsi, Akbir Khan,
  Buck Shlegeris. [Ctrl-Z: Controlling AI Agents via Resampling](https://arxiv.org/abs/2504.10374). 2025.
- Jonathan Kutasov, Yuqi Sun, Paul Colognese, Teun van der Weij, Linda Petrini, Chen Bo Calvin Zhang,
  John Hughes, Xiang Deng, Henry Sleight, Tyler Tracy, Buck Shlegeris, Joe Benton. [SHADE-Arena:
  Evaluating Sabotage and Monitoring in LLM Agents](https://arxiv.org/abs/2506.15740). 2025.
- Anthropic. [Making Claude Code more secure and autonomous with
  sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing). 2025.

Built with [three.js](https://threejs.org) (WebGPURenderer and TSL) and [Next.js](https://nextjs.org).
The engine conventions, the audio engine and the quality ladder come from its sister project,
[One Cubic Millimetre](https://github.com/BadCodesGG/cubic-mm). Type is Schibsted Grotesk and
JetBrains Mono.

## Licence

The code is MIT, see [LICENSE](LICENSE). What it does not cover, and the terms for the BadCodes name
and logo, are listed in [NOTICE](NOTICE).

Built by [BadCodes](https://badcodes.dev).
