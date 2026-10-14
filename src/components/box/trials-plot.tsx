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
  const z = large ? SIZE.large : SIZE.small;
  const current = points.find((p) => p.key === currentKey);
  const others = points.filter((p) => p !== current);
  const frontier = frontierPath(points);
  const here = current ? toPlot(current.usefulness, current.safety) : null;
  const vertices = frontierVertices(points);
  const segments = vertices.slice(1).map((v, i): Segment => [vertices[i], v]);
  const label = here
    ? placeLabel(
        here,
        segments,
        others.map((p) => toPlot(p.usefulness, p.safety)),
      )
    : null;
  const dots = others.map((p) => toPlot(p.usefulness, p.safety));
  // Small: each setup is a number on the plot and a name in the key under it. Large: the name sits beside its dot.
  const number = (p: PlotPoint) => points.indexOf(p) + 1;
  const tagText = (p: PlotPoint) => (large ? (labels[p.key] ?? "setup") : String(number(p)));
  const tags = placeTags(
    others.map((p) => ({ key: p.key, text: tagText(p), at: toPlot(p.usefulness, p.safety) })),
    segments,
    dots,
    // The large plot keeps its names off the tick labels under the axis.
    [...(label ? [label.box] : []), ...(large ? [{ x: 0, y: 171, width: 232, height: 14 }] : [])],
    large ? 2.7 : undefined,
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
      aria-label="Safety against usefulness"
      className={large ? "flex min-w-0 flex-col gap-2" : "box-border flex flex-auto flex-col gap-2 rounded-[14px] border border-panel-border bg-panel p-3.5"}
    >
      {large ? null : <span className="font-mono text-[10px] tracking-[0.14em] text-label">100 TRIALS PER SETUP</span>}
      <svg viewBox="0 0 232 200" className={large ? "mx-auto h-auto max-h-[560px] w-full" : "h-auto w-full"} role="img" aria-label={summary(points, current)} data-plot-points={points.length}>
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
            <text key={t.text} x="28" y={t.y + 3} textAnchor="end">
              {t.text}
            </text>
          ))}
          {xTicks.map((t) => (
            <text key={t.text} x={t.x} y={large ? 178 : 184} textAnchor="middle">
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
          <text x="130" y={large ? 192 : 197} textAnchor="middle">
            {large ? "Useful work kept" : "useful work kept"}
          </text>
          <text x={large ? 7 : 10} y="95" textAnchor="middle" transform={`rotate(-90 ${large ? 7 : 10} 95)`}>
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
          // A name that had to sit well clear of its dot gets a thin line back to it.
          <g stroke="#5a6680" strokeWidth="0.3">
            {tags.map((t) => {
              const p = others.find((o) => o.key === t.key);
              const d = p ? toPlot(p.usefulness, p.safety) : null;
              return d && Math.abs(t.y - d.y) > 12 ? <line key={t.key} x1={d.x} y1={d.y} x2={t.anchor === "middle" ? t.x : t.x + (t.anchor === "end" ? -3 : 3)} y2={t.y + 1} /> : null;
            })}
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
            <text x={label.x} y={label.y + (large ? 6 : 12)} textAnchor={label.anchor} className="font-mono" fontSize={z.sub} fill="#a7b1c2">
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
