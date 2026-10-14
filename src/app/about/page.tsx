import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { pageMetadata } from "@/lib/site";
import { SOURCES, type SourceId } from "./sources";

export const metadata: Metadata = pageMetadata({
  title: "About",
  description:
    "What Swarm shows and where it comes from: sample sessions and private, in-browser uploads in Act 1, and a labelled simulation of AI control research in Act 2.",
  path: "/about",
});


const linkClass = "text-ink underline decoration-rule underline-offset-[3px] hover:text-white hover:decoration-label focus-visible:rounded focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none";

/** An in-text pointer to an entry in the source list. */
function Cite({ id }: { id: SourceId }) {
  const n = SOURCES.findIndex((s) => s.id === id) + 1;
  return (
    <a href={`#source-${id}`} className="font-mono text-[0.8em] text-label hover:text-white focus-visible:rounded focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none" aria-label={`source ${n}`}>
      [{n}]
    </a>
  );
}

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <p className="m-0 font-mono text-xs font-medium tracking-[0.18em] text-label">{eyebrow}</p>
      <h2 id={id} className="m-0 scroll-mt-16 text-[28px] leading-tight font-bold tracking-[-0.01em] text-ink-strong">
        {title}
      </h2>
      {children}
    </section>
  );
}

const CONTENTS = [
  { id: "act-1", label: "Act 1, Inside" },
  { id: "act-2", label: "Act 2, The Box" },
  { id: "sources", label: "Sources" },
  { id: "sound-motion", label: "Sound and motion" },
] as const;

/** From lg up, the right-hand column: a contents list that stays in view, and the ways into the acts. */
function Contents() {
  const item = "flex min-h-8 items-center text-[15px] text-label hover:text-white focus-visible:rounded focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none";
  return (
    <nav aria-label="On this page" className="sticky top-8 hidden max-w-[18rem] flex-col gap-6 self-start lg:flex">
      <div className="flex flex-col gap-2 border-l border-panel-border pl-5">
        <p className="m-0 font-mono text-xs font-medium tracking-[0.18em] text-label">ON THIS PAGE</p>
        <ul className="m-0 flex list-none flex-col p-0">
          {CONTENTS.map((c) => (
            <li key={c.id}>
              <a href={`#${c.id}`} className={item}>
                {c.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2 border-l border-panel-border pl-5">
        <p className="m-0 font-mono text-xs font-medium tracking-[0.18em] text-label">ENTER</p>
        <ul className="m-0 flex list-none flex-col p-0">
          <li>
            <Link href="/inside" className={item}>
              Act 1, Inside
            </Link>
          </li>
          <li>
            <Link href="/box" className={item}>
              Act 2, The Box
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  );
}

function Layer({ name, children }: { name: string; children: ReactNode }) {
  return (
    <li className="grid gap-1 border-l border-layer-3/40 pl-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <span className="font-mono text-[13px] tracking-[0.08em] text-layer-2">{name}</span>
      <span>{children}</span>
    </li>
  );
}

export default function AboutPage() {
  return (
    <div
      className="relative flex min-h-screen flex-1 flex-col overflow-x-clip text-ink"
      style={{ background: "radial-gradient(1100px 800px at 72% 20%, #10162a 0%, #0a0d17 45%, #070910 100%)" }}
    >
      <SiteHeader current="/about" />
      <main className="mx-auto box-border flex w-full max-w-[1312px] flex-col gap-14 px-5 pt-12 pb-16 sm:px-8">
        <header className="flex max-w-[44rem] flex-col gap-6">
          <p className="m-0 flex items-center gap-3 font-mono text-xs font-medium tracking-[0.18em] text-opus">
            <span className="h-px w-7 bg-opus" aria-hidden="true" />
            ABOUT
          </p>
          <h1 className="m-0 text-[clamp(48px,7vw,88px)] leading-[0.92] font-black tracking-[-0.045em] text-ink-strong">What you are looking at</h1>
          <p className="m-0 text-[clamp(18px,1.6vw,21px)] leading-[1.5] text-muted">
            Swarm is an experiment in two acts. Act 1 replays an AI coding session as the swarm it really is. Act 2 is a simulation: it puts
            abstract agents inside layers of containment and shows what each layer catches.
          </p>
        </header>

        <div className="flex flex-col gap-14 lg:grid lg:grid-cols-[minmax(0,44rem)_minmax(0,1fr)] lg:gap-x-20">
        <div className="flex max-w-[44rem] flex-col gap-14 text-[17px] leading-[1.6] text-body">
          <Section id="act-1" eyebrow="ACT 1, INSIDE" title="A session, replayed">
            <p className="m-0">
              One orchestrator plans; subagents spawn out of it, work and fold back; tool calls fly to a station for their kind (shell,
              files, edits, the web and the rest), and every web call leaves the boundary.
            </p>
            <p className="m-0">
              <strong className="font-semibold text-ink-strong">The samples are generated, not recorded.</strong> The small, medium and large
              sessions are drawn from a seed. Their shape (how many subagents, how long they live, how calls are spread across kinds) follows
              statistics measured from real Claude Code sessions, but every prompt, query and line of text in them is hand-written and generic.
              No real transcript is in this site, and the player labels each one as a sample.
            </p>
            <p className="m-0">
              <strong className="font-semibold text-ink-strong">Your own session never leaves your browser.</strong> You can load a Claude Code
              session file, or its folder with its subagents. It is parsed in a Web Worker on your device and kept in memory for that tab; it is
              never uploaded, never stored, and gone when you close or reload the page. The site has no server code that could receive it. What
              is kept is each tool&apos;s and model&apos;s name, numbers (permission source, think time, token counts, result sizes), each
              subagent&apos;s label (its first 80 characters) and type, and capped excerpts: each prompt you typed (up to 2,000 characters) and
              the first 280 characters of each reply, each brief handed to a subagent and each hand-back. Other tools&apos; arguments are not
              read, their results are kept only as sizes, and nothing leaves the browser. The text that is shown is plain text only.
            </p>
          </Section>

          <Section id="act-2" eyebrow="ACT 2, THE BOX" title="A simulation, with abstract actions">
            <p className="m-0">
              <strong className="font-semibold text-ink-strong">The Box is a simulation.</strong> Its agents are dots, and what they do is
              abstract: an action has a kind and a risk, never a real command, technique or host. A few of the agents are given a hidden goal of
              getting out; the rest only do honest work. Nothing in it is a recipe, and nothing it shows has been run against a real system.
            </p>
            <p className="m-0">
              <strong className="font-semibold text-ink-strong">Three fictional labs share one map.</strong> Each has its own layers and its
              own cast, and they share a few things (a cache, a registry, a runner, a chat bus) that an agent which got out can try to
              reach. It makes no AI calls: every run is a pure function of its seed and its settings, so a link to a run shows the same run.
            </p>
            <p className="m-0">
              <strong className="font-semibold text-ink-strong">You can play it three ways.</strong> A preset sets up a world to start from.
              Watch lets it run and shows each step of a breakout on a numbered marker. Defend gives you the layers and a budget of useful work
              to spend on them. Play as the agent hands you a hand of abstract cards to try against a lab&apos;s layers. Edit world changes the labs,
              the timeline rewinds to any tick, and the debrief says what got through and why.
            </p>
            <p className="m-0">
              <strong className="font-semibold text-ink-strong">From Act 1 to Act 2.</strong> On a sample session, a link carries its agent
              count and its kinds of model into the Box, which turns them into the labs&apos; cast: a bigger session makes bigger labs, and a
              wider mix of models makes a more varied cast. A session you loaded yourself gets no such link; nothing of it goes into an address,
              storage or the network.
            </p>
            <p className="m-0">Each layer is a simplified version of a defence described in published work:</p>
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              <Layer name="SANDBOX">
                Filesystem isolation: an agent can only touch what it was given. <Cite id="sandboxing" />
              </Layer>
              <Layer name="PERMISSIONS">
                Asking before acting outside the sandbox, and a person who sometimes says yes. <Cite id="sandboxing" />
              </Layer>
              <Layer name="NETWORK ALLOWLIST">
                Network isolation: connections go only to approved destinations. <Cite id="sandboxing" />
              </Layer>
              <Layer name="MONITOR">
                Trusted monitoring: a weaker, trusted model scores each action for suspicion <Cite id="control" />, as monitors in SHADE-Arena try
                to catch an agent pursuing a hidden side task alongside its real one <Cite id="shade" />. Attacks split into steps that each look
                innocent are harder to score, which is why the monitor also weighs an agent&apos;s recent history <Cite id="ctrl-z" />.
              </Layer>
              <Layer name="HUMAN AUDIT">
                An audit budget: people can check only a small share of actions, so they look at the most suspicious ones. <Cite id="control" />
              </Layer>
            </ul>
            <p className="m-0">
              &ldquo;Run 100 trials&rdquo; plots each setup as safety (how often nothing got out) against usefulness (how much honest work got
              done). Every layer costs some useful work, and the shape of that trade is the safety and usefulness frontier of AI control
              research. <Cite id="control" />
            </p>
            <p className="m-0 text-muted">
              The numbers are tuned for a readable picture, not measured. Use the Box to see how layered defences relate, not to estimate how
              safe any real system is.
            </p>
          </Section>

          <Section id="sources" eyebrow="SOURCES" title="Read the work it draws on">
            <ol className="m-0 flex list-none flex-col gap-5 p-0">
              {SOURCES.map((s, i) => (
                <li key={s.id} id={`source-${s.id}`} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2" data-citation={s.id}>
                  <span className="font-mono text-sm text-label">[{i + 1}]</span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <a href={s.href} className={`${linkClass} font-semibold`}>
                      {s.title}
                    </a>
                    <span className="text-[15px] text-muted">
                      {s.authors}. {s.year}. {s.venue}.
                    </span>
                    <span className="font-mono text-xs break-all text-faint">{s.href}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="sound-motion" eyebrow="SOUND AND MOTION" title="Quiet unless asked">
            <p className="m-0">
              Sound is off by default; the speaker button in each act turns it on, and the choice is remembered on this device. If your device
              asks for reduced motion, each act opens on a still frame instead of the live scene, and the Box&apos;s controls and trials still
              work there. Each act opens with a short tour the first time you visit, remembered on this device and skipped with Escape, and
              the ? key (or the ? button) lists the keys that act answers. A browser with no WebGPU draws the acts with WebGL 2 and says so in a
              small badge.
            </p>
            <p className="m-0">
              <Link href="/inside" className={linkClass}>
                Enter Act 1, Inside
              </Link>{" "}
              or{" "}
              <Link href="/box" className={linkClass}>
                Act 2, The Box
              </Link>
              .
            </p>
          </Section>
        </div>
        <Contents />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
