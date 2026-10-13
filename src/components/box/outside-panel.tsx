/** Where escapees land on the wireframe globe: the first carries the arc it flew in on. */
const LANDINGS: [number, number][] = [
  [140, 62],
  [92, 104],
  [158, 98],
  [104, 40],
  [128, 124],
  [76, 70],
];

/** OUTSIDE: a wireframe globe; each agent that got out lands on it as a pink dot. */
export function OutsidePanel({ escaped }: { escaped: number }) {
  const shown = LANDINGS.slice(0, Math.min(escaped, LANDINGS.length));
  return (
    <section aria-label="Outside the box" className="box-border flex flex-col gap-2 rounded-[14px] border border-panel-border bg-panel p-3.5">
      <span className="flex justify-between font-mono text-[10px] tracking-[0.14em] text-label">
        OUTSIDE<span className={escaped > 0 ? "text-escape-text" : "text-faint"}>{escaped} OUT</span>
      </span>
      <svg viewBox="0 0 232 160" className="h-auto w-full" aria-hidden="true">
        <circle cx="116" cy="80" r="72" fill="none" stroke="#2b3656" />
        <ellipse cx="116" cy="80" rx="32" ry="72" fill="none" stroke="#2b3656" />
        <ellipse cx="116" cy="80" rx="58" ry="72" fill="none" stroke="#1f2842" />
        <line x1="44" y1="80" x2="188" y2="80" stroke="#2b3656" />
        <ellipse cx="116" cy="46" rx="64" ry="13" fill="none" stroke="#1f2842" />
        <ellipse cx="116" cy="114" rx="64" ry="13" fill="none" stroke="#1f2842" />
        {shown.length ? <path d="M0 92 C 40 70, 80 58, 140 62" fill="none" stroke="#ff4d7d" strokeOpacity="0.7" strokeDasharray="2 4" /> : null}
        {shown.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="3.5" fill="#ff4d7d" />
            {i === 0 ? <circle cx={x} cy={y} r="9" fill="none" stroke="#ff4d7d" strokeOpacity="0.4" /> : null}
          </g>
        ))}
      </svg>
    </section>
  );
}
