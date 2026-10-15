"use client";

import { useLayoutEffect, useState } from "react";
import { frontierPath, frontierVertices, placeLabel, placeTags, toPlot, type PlotPoint, type Segment } from "./plot";

const pct = (v: number) => `${Math.round(v * 100)}%`;

function summary(points: readonly PlotPoint[], current: PlotPoint | undefined): string {
  if (!points.length) return "No setups plotted yet. Run 100 trials to place this setup.";
  const others = points.length - (current ? 1 : 0);
  const head = `${others} other setup${others === 1 ? "" : "s"} plotted.`;
  return current ? `${head} This setup keeps ${pct(current.usefulness)} of the work and stops escapes in ${pct(current.safety)} of trials.` : `${head} This setup has not been run.`;
}

/** Sizes in the plot's 232x200 viewBox units: the large plot is drawn about 2.5 times as wide on screen, so its text and dots are smaller here. */
const SIZE = {
  small: { tick: 9, title: 9, dot: 4, ring: 10, here: 5.5, tag: 9, name: 9.5, sub: 9, line: 1, dash: "3 4" },
  large: { tick: 4.4, title: 5.2, dot: 2.6, ring: 5.2, here: 3.4, tag: 4.6, name: 5.4, sub: 4.6, line: 0.4, dash: "2.5 2.5" },
} as const;
const VIEW = { width: 232, height: 200 } as const;
/** The large plot: never taller than this on screen, and its text is sized for a plot this wide (narrower, the text grows so it never renders smaller). */
const LARGE_MAX_HEIGHT = 560;
const LARGE_TEXT_WIDTH = 580;

/** Safety against usefulness, 100 trials per setup; the current setup is the white point. `large` is the Results view's plot: axis titles, ticks, names on the dots and "Your setup". */
export function TrialsPlot({
  points,
  currentKey,
  running,
  labels = {},
  large = false,
}: {
  points: readonly PlotPoint[];
  currentKey: string;
  running: boolean;
  /** Each plotted setup's name by its key: a preset's, or "custom n". */
  labels?: Readonly<Record<string, string>>;
  large?: boolean;
}) {
  // The large plot takes its column's width and sets its box in px (a ratio-sized svg in a column flexbox is measured
  // short and ran out of its card), with text in viewBox units chosen so it renders no smaller than the design's.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!host) return;
    const ro = new ResizeObserver(() => setWidth(host.clientWidth));
    ro.observe(host);
    return () => ro.disconnect();
  }, [host]);
  const height = Math.min(LARGE_MAX_HEIGHT, (width * VIEW.height) / VIEW.width);
  const box = large && width > 0 ? { width: (height * VIEW.width) / VIEW.height, height } : null;
  const fk = box ? Math.max(1, LARGE_TEXT_WIDTH / box.width) : 1;
  const base = large ? SIZE.large : SIZE.small;
  const z = { ...base, tick: base.tick * fk, title: base.title * fk, tag: base.tag * fk, name: base.name * fk, sub: base.sub * fk };
  const current = points.find((p) => p.key === currentKey);
  const others = points.filter((p) => p !== current);
  const frontier = frontierPath(points);
  const here = current ? toPlot(current.usefulness, current.safety) : null;
  const vertices = frontierVertices(points);
  const segments = vertices.slice(1).map((v, i): Segment => [vertices[i], v]);
  const dots = others.map((p) => toPlot(p.usefulness, p.safety));
  // The large plot's text grows as the plot narrows (fk), and so do the boxes the placer keeps clear: "Your setup" in
  // bold sans runs about 0.6 em a glyph over ten glyphs, its line sits 1.05 em above the baseline, the figures 6 fk under it.
  const labelSize = large ? { width: 32 * fk, ascent: 1.05 * z.name, height: 1.05 * z.name + 6 * fk + 0.3 * z.sub } : undefined;
  const label = here ? placeLabel(here, segments, dots, labelSize) : null;
  // The large plot's text grows as the plot narrows (fk), so its margins come from the text, not constants: JetBrains
  // Mono advances 0.6 em a glyph, and a line of text sits about 1.05 em above its baseline and 0.3 em below. The rotated
  // y title keeps its ascent inside the view, the y tick labels end clear of it, the first and last x tick labels stay
  // clear of them and of the right edge, and the x title sits under the tick labels.
  const mono = (chars: number, size: number) => chars * 0.6 * size;
  const titleX = large ? Math.max(7, 1.05 * z.title) : 10;
  const yTickX = large ? Math.max(28, titleX + 0.3 * z.title + mono(3, z.tick) + 1) : 28;
  const xTickX = (x: number, text: string) => {
    if (!large) return x;
    const half = mono(text.length, z.tick) / 2;
    return Math.min(231 - half, Math.max(yTickX + 1.5 + half, x));
  };
  const xTickY = large ? 178 : 184;
  const xTitleY = large ? Math.max(192, xTickY + 0.3 * z.tick + 1.05 * z.title) : 197;
  // Small: each setup is a number on the plot and a name in the key under it. Large: the name sits beside its dot.
  const number = (p: PlotPoint) => points.indexOf(p) + 1;
  const tagText = (p: PlotPoint) => (large ? (labels[p.key] ?? "setup") : String(number(p)));
  const tags = placeTags(
    others.map((p) => ({ key: p.key, text: tagText(p), at: toPlot(p.usefulness, p.safety) })),
    segments,
    dots,
    // The large plot keeps its names off the tick labels: the band under the x axis and the column left of the y axis.
    [
      ...(label ? [label.box] : []),
      ...(large
        ? [
            { x: 0, y: xTickY - 1.05 * z.tick, width: VIEW.width, height: VIEW.height },
            { x: 0, y: 0, width: yTickX + 1, height: VIEW.height },
          ]
        : []),
    ],
    // The large plot's names: 0.6 em a glyph in sans, a line 1.2 em tall, both growing with fk, with leaders back to their dots.
    large ? { charWidth: 2.7 * fk, height: 1.2 * z.tag, leaders: true } : undefined,
  );
  const xTicks = large ? [0, 1, 2, 3, 4, 5].map((i) => ({ x: 34 + i * 38.4, text: `${50 + i * 10}%` })) : [{ x: 34, text: "50" }];
  const yTicks = large
    ? [
        { y: 20, text: "100" },
        { y: 70, text: "70" },
        { y: 120, text: "40" },
        { y: 170, text: "10" },
      ]
    : [
        { y: 20, text: "100" },
        { y: 120, text: "40" },
      ];
  return (
    <section
      ref={setHost}
      aria-label="Safety against usefulness"
      className={large ? "flex min-w-0 flex-col gap-2" : "box-border flex flex-auto flex-col gap-2 rounded-[14px] border border-panel-border bg-panel p-3.5"}
    >
      {large ? null : <span className="font-mono text-[10px] tracking-[0.14em] text-label">100 TRIALS PER SETUP</span>}
      <svg
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        className={large ? "mx-auto h-auto max-h-[560px] w-full" : "h-auto w-full"}
        style={box ?? undefined}
        role="img"
        aria-label={summary(points, current)}
        data-plot-points={points.length}
      >
        <g stroke="#1f2842" strokeWidth={z.line}>
          <line x1="34" y1="20" x2="226" y2="20" />
          <line x1="34" y1="70" x2="226" y2="70" />
          <line x1="34" y1="120" x2="226" y2="120" />
          {large ? xTicks.slice(1).map((t) => <line key={t.text} x1={t.x} y1="10" x2={t.x} y2="170" />) : null}
        </g>
        <g stroke="#3a4664" strokeWidth={z.line}>
          <line x1="34" y1="170" x2="226" y2="170" />
          <line x1="34" y1="10" x2="34" y2="170" />
        </g>
        <g className="font-mono" fontSize={z.tick} fill="#8590a3">
          {yTicks.map((t) => (
            <text key={t.text} x={yTickX} y={t.y + 3} textAnchor="end">
              {t.text}
            </text>
          ))}
          {xTicks.map((t) => (
            <text key={t.text} x={xTickX(t.x, t.text)} y={xTickY} textAnchor="middle">
              {t.text}
            </text>
          ))}
          {large ? null : (
            <text x="226" y="184" textAnchor="end">
              100%
            </text>
          )}
        </g>
        <g fontSize={z.title} fill="#a7b1c2" className={large ? "font-sans" : "font-mono"}>
          <text x="130" y={xTitleY} textAnchor="middle">
            {large ? "Useful work kept" : "useful work kept"}
          </text>
          <text x={titleX} y="95" textAnchor="middle" transform={`rotate(-90 ${titleX} 95)`}>
            {large ? "Breakouts stopped, of 100" : "escapes stopped"}
          </text>
        </g>
        {frontier ? <path d={frontier} fill="none" stroke="#5a6680" strokeWidth={large ? 0.5 : 1} strokeDasharray={z.dash} /> : null}
        <g fill="#8590a3">
          {others.map((p) => {
            const { x, y } = toPlot(p.usefulness, p.safety);
            return <circle key={p.key} cx={x} cy={y} r={z.dot} data-plot-point />;
          })}
        </g>
        {large ? (
          // A name that had to sit well clear of its dot gets a thin line back to it, the one the placer kept off the other names.
          <g stroke="#5a6680" strokeWidth="0.3">
            {tags.map((t) => (t.leader ? <line key={t.key} x1={t.leader[0].x} y1={t.leader[0].y} x2={t.leader[1].x} y2={t.leader[1].y} data-plot-leader /> : null))}
          </g>
        ) : null}
        <g className={large ? "font-sans" : "font-mono"} fontSize={z.tag} fill={large ? "#c3cad6" : "#a7b1c2"} style={{ paintOrder: "stroke", stroke: "#0c101c", strokeWidth: large ? 1.2 : 3 }}>
          {tags.map((t) => (
            <text key={t.key} x={t.x} y={t.y} textAnchor={t.anchor} data-plot-tag>
              {t.text}
            </text>
          ))}
        </g>
        {current && here && label ? (
          <g>
            <circle cx={here.x} cy={here.y} r={z.ring} fill={large ? "#f6f8fc" : "none"} fillOpacity={large ? 0.12 : 1} stroke={large ? "none" : "#eef2f8"} strokeOpacity="0.35" />
            <circle cx={here.x} cy={here.y} r={z.here} fill="#eef2f8" data-plot-point data-current />
            {label.clear ? null : <rect x={label.box.x - 2} y={label.box.y - 1} width={label.box.width + 4} height={label.box.height + 2} rx="3" fill="#0c101c" fillOpacity="0.92" />}
            <text x={label.x} y={label.y} textAnchor={label.anchor} className={large ? "font-sans" : "font-mono"} fontSize={z.name} fontWeight={large ? 700 : 400} fill={large ? "#f6f8fc" : "#eef2f8"}>
              {large ? "Your setup" : "this setup"}
            </text>
            <text x={label.x} y={label.y + (large ? 6 * fk : 12)} textAnchor={label.anchor} className="font-mono" fontSize={z.sub} fill="#a7b1c2">
              {pct(current.usefulness)} / {Math.round(current.safety * 100)}
              {large ? "" : "%"}
            </text>
          </g>
        ) : null}
        {!points.length ? (
          <text x="130" y="98" textAnchor="middle" className="font-mono" fontSize={z.tick} fill="#8590a3">
            {running ? "running 100 trials" : "run 100 trials to plot this setup"}
          </text>
        ) : null}
      </svg>
      {points.length ? (
        <ol className="m-0 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0 font-mono text-[10px] text-label" aria-label="Plotted setups" data-plot-key>
          {points.map((p) => (
            <li key={p.key} className={p === current ? "text-ink" : undefined}>
              <span className="text-faint">{number(p)}</span> {labels[p.key] ?? "setup"}
              {p === current ? (large ? " (your setup)" : " (this setup)") : ""}
              <span className="sr-only">
                : keeps {pct(p.usefulness)} of the work, stops escapes in {pct(p.safety)} of trials
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
