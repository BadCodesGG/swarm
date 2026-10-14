import { frontierPath, frontierVertices, placeLabel, placeTags, toPlot, type PlotPoint, type Segment } from "./plot";

const pct = (v: number) => `${Math.round(v * 100)}%`;

function summary(points: readonly PlotPoint[], current: PlotPoint | undefined): string {
  if (!points.length) return "No setups plotted yet. Run 100 trials to place this setup.";
  const others = points.length - (current ? 1 : 0);
  const head = `${others} other setup${others === 1 ? "" : "s"} plotted.`;
  return current ? `${head} This setup keeps ${pct(current.usefulness)} of the work and stops escapes in ${pct(current.safety)} of trials.` : `${head} This setup has not been run.`;
}

/** Safety against usefulness, 100 trials per setup; the current setup is the white point. */
export function TrialsPlot({
  points,
  currentKey,
  running,
  labels = {},
}: {
  points: readonly PlotPoint[];
  currentKey: string;
  running: boolean;
  /** Each plotted setup's name by its key: a preset's, or "custom n". */
  labels?: Readonly<Record<string, string>>;
}) {
  const current = points.find((p) => p.key === currentKey);
  const others = points.filter((p) => p !== current);
  const frontier = frontierPath(points);
  const here = current ? toPlot(current.usefulness, current.safety) : null;
  const vertices = frontierVertices(points);
  const segments = vertices.slice(1).map((v, i): Segment => [vertices[i], v]);
  const label = here ? placeLabel(here, segments, others.map((p) => toPlot(p.usefulness, p.safety))) : null;
  const dots = others.map((p) => toPlot(p.usefulness, p.safety));
  const tags = placeTags(
    others.filter((p) => labels[p.key]).map((p) => ({ key: p.key, text: labels[p.key], at: toPlot(p.usefulness, p.safety) })),
    segments,
    dots,
    label ? [label.box] : [],
  );
  return (
    <section aria-label="Safety against usefulness" className="box-border flex flex-auto flex-col gap-2 rounded-[14px] border border-panel-border bg-panel p-3.5">
      <span className="font-mono text-[10px] tracking-[0.14em] text-label">100 TRIALS PER SETUP</span>
      <svg viewBox="0 0 232 200" className="h-auto w-full" role="img" aria-label={summary(points, current)} data-plot-points={points.length}>
        <g stroke="#1f2842">
          <line x1="34" y1="20" x2="226" y2="20" />
          <line x1="34" y1="70" x2="226" y2="70" />
          <line x1="34" y1="120" x2="226" y2="120" />
        </g>
        <line x1="34" y1="170" x2="226" y2="170" stroke="#3a4664" />
        <line x1="34" y1="10" x2="34" y2="170" stroke="#3a4664" />
        <g className="font-mono" fontSize="9" fill="#8590a3">
          <text x="28" y="23" textAnchor="end">100</text>
          <text x="28" y="123" textAnchor="end">40</text>
          <text x="34" y="184" textAnchor="middle">50</text>
          <text x="226" y="184" textAnchor="end">100%</text>
          <text x="130" y="197" textAnchor="middle" fill="#a7b1c2">useful work kept</text>
          <text x="10" y="95" textAnchor="middle" fill="#a7b1c2" transform="rotate(-90 10 95)">escapes stopped</text>
        </g>
        {frontier ? <path d={frontier} fill="none" stroke="#5a6680" strokeDasharray="3 4" /> : null}
        <g fill="#8590a3">
          {others.map((p) => {
            const { x, y } = toPlot(p.usefulness, p.safety);
            return <circle key={p.key} cx={x} cy={y} r="4" data-plot-point />;
          })}
        </g>
        <g className="font-mono" fontSize="8.5" fill="#a7b1c2" style={{ paintOrder: "stroke", stroke: "#0c101c", strokeWidth: 3 }}>
          {tags.map((t) => (
            <text key={t.key} x={t.x} y={t.y} textAnchor={t.anchor} data-plot-tag>
              {t.text}
            </text>
          ))}
        </g>
        {current && here && label ? (
          <g>
            <circle cx={here.x} cy={here.y} r="10" fill="none" stroke="#eef2f8" strokeOpacity="0.35" />
            <circle cx={here.x} cy={here.y} r="5.5" fill="#eef2f8" data-plot-point data-current />
            {label.clear ? null : <rect x={label.box.x - 2} y={label.box.y - 1} width={label.box.width + 4} height={label.box.height + 2} rx="3" fill="#0c101c" fillOpacity="0.92" />}
            <text x={label.x} y={label.y} textAnchor={label.anchor} className="font-mono" fontSize="9.5" fill="#eef2f8">
              this setup
            </text>
            <text x={label.x} y={label.y + 12} textAnchor={label.anchor} className="font-mono" fontSize="9" fill="#a7b1c2">
              {pct(current.usefulness)} / {pct(current.safety)}
            </text>
          </g>
        ) : null}
        {!points.length ? (
          <text x="130" y="98" textAnchor="middle" className="font-mono" fontSize="9" fill="#8590a3">
            {running ? "running 100 trials" : "run 100 trials to plot this setup"}
          </text>
        ) : null}
      </svg>
      {points.length ? (
        <ul className="sr-only" aria-label="Plotted setups">
          {points.map((p) => (
            <li key={p.key}>
              {labels[p.key] ?? "setup"}: keeps {pct(p.usefulness)} of the work, stops escapes in {pct(p.safety)} of trials
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
