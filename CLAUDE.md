# CLAUDE.md

Guidance for Claude Code in this repository.

@AGENTS.md

## What this is

"Swarm": a two-act browser experience about AI agent swarms.

- **Act 1, Inside** (`/inside`): replays an AI coding session as a 3D swarm: an orchestrator core,
  subagents spawning and returning, tool calls flying to tool stations, web calls leaving the
  boundary. Sources: seeded sample sessions (small, medium, large), or the visitor's own Claude
  Code session file, parsed in a Web Worker in their browser and never uploaded.
- **Act 2, The Box** (`/box`): a clearly labelled simulation of agents inside layered containment
  (sandbox, permissions, network allowlist, monitor, human audit). Actions are abstract; it never
  shows real commands or techniques.

See `ARCHITECTURE.md` for modules, contracts and data flow.

## Commands

```bash
npm run dev            # Dev server at http://localhost:3000
npm run build          # Production build (the real gate; dev mode hides prerender problems)
npm run lint           # ESLint (Next core-web-vitals + TypeScript)
npm run typecheck      # next typegen, then tsc --noEmit (bare tsc fails on a fresh checkout)
npm run test           # Vitest
npm run test:smoke     # Boots the built site and drives both acts in Chromium
```

## Things that bite

- **Never `ShaderMaterial`, `onBeforeCompile` or `EffectComposer`.** They do not run on the WebGPU
  backend. Materials are TSL node materials.
- **Gate compute on `renderer.backend.isWebGPUBackend`.** The WebGL2 fallback has no real compute;
  lite mode runs the same logic on the CPU.
- **Do not construct `THREE.Clock`.** three 0.186 warns, and the smoke test fails on any `THREE.` warning.
- **Raw session transcripts never enter the repo.** `.gitignore` blocks `*.jsonl` except scrubbed
  fixtures. Sample sessions are generated, and the UI labels them as samples.
- **Session text is untrusted input.** It renders as text only, never as HTML.
- **Any route that sets metadata goes through `pageMetadata()` in `src/lib/site.ts`.** `SITE_URL`
  defaults to the production domain; `NEXT_PUBLIC_SITE_URL` overrides it. The share image is the static `public/og.jpg`.
- **The first-visit tours skip scripted browsers and `?shot=` frames** (so a dialog never meets the smoke and shot scripts); `?tour=1` shows one, and `scripts/smoke-site.mjs` uses it. Any new key an act answers goes in `src/components/site/shortcuts.ts` too.
- **No em dashes** in copy, comments or docs.
