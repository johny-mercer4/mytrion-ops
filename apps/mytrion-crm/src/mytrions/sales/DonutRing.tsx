// Simple inline-SVG donut ring — no charting library needed for a single
// stat ring. Used by DashboardSales for the two "Active X / Y" rings.

export function DonutRing({
  pct,
  label,
  value,
  sub,
  colorClass,
}: {
  pct: number;
  label: string;
  value: string;
  sub: string;
  colorClass: string;
}) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, pct)) / 100) * c;

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="relative flex size-22 items-center justify-center">
        <svg width="88" height="88" viewBox="0 0 88 88" className="-rotate-90">
          <circle cx="44" cy="44" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-muted" />
          <circle
            cx="44"
            cy="44"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeDasharray={c}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className={colorClass}
          />
        </svg>
        <span className={`absolute font-heading text-lg font-bold ${colorClass}`}>{pct}%</span>
      </div>
      <div>
        <div className="text-xs font-semibold">{label}</div>
        <div className="text-[10.5px] text-muted-foreground">{sub}</div>
        <div className="mt-0.5 font-mono text-[10.5px] font-bold">{value}</div>
      </div>
    </div>
  );
}
