import { useId } from 'react';
import type { BreakdownItem, KpiStat, LeaderboardRow, TrendPoint } from './data';

/**
 * Analytics marks. Plain SVG/HTML against the module's own tokens — no chart library, so every
 * mark spec below is explicit rather than fought with.
 *
 * Colour rules applied here (see analyst.css for the validated palette):
 *   • Categorical hues are assigned by SERIES INDEX in fixed order and never cycled. A filter that
 *     drops a category must not repaint the survivors, so index — not rank — picks the slot.
 *   • Past 6 categories the rest fold into "Other" rather than inventing a 7th hue.
 *   • Status hues (good/bad) are reserved for deltas and never reused as a series colour.
 *   • Light mode has a contrast WARN on three slots, so every categorical mark carries a visible
 *     direct label — that is the relief rule, not an optional nicety.
 */

/** Fixed categorical slots. Index-addressed; `SERIES[i % 6]` is deliberately NOT used. */
export const SERIES = [
  'var(--an-s1)',
  'var(--an-s2)',
  'var(--an-s3)',
  'var(--an-s4)',
  'var(--an-s5)',
  'var(--an-s6)',
] as const;
const MAX_SERIES = SERIES.length;

const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const fmt = (n: number): string => NUM.format(n);

/** Fold anything past the 6th slot into a single "Other" row rather than generating a hue. */
export function foldSeries(items: BreakdownItem[]): { label: string; value: number; color: string }[] {
  const head = items.slice(0, MAX_SERIES - 1);
  const tail = items.slice(MAX_SERIES - 1);
  const rows = head.map((it, i) => ({ label: it.label, value: it.value, color: SERIES[i]! }));
  if (tail.length === 1) {
    rows.push({ label: tail[0]!.label, value: tail[0]!.value, color: SERIES[MAX_SERIES - 1]! });
  } else if (tail.length > 1) {
    rows.push({
      label: `Other (${tail.length})`,
      value: tail.reduce((s, t) => s + t.value, 0),
      color: SERIES[MAX_SERIES - 1]!,
    });
  }
  return rows;
}

// ─── KPI tiles ───────────────────────────────────────────────────────────────────────────────

/** Delta pill. Direction is an arrow glyph AS WELL as a hue — never colour alone. */
function Delta({ delta }: { delta: NonNullable<KpiStat['delta']> }) {
  const { prev, current, higherIsBetter } = delta;
  if (!prev) return null;
  const pct = ((current - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(pct)) return null;
  const up = pct >= 0;
  const good = up === higherIsBetter;
  return (
    <span
      className="an-delta"
      style={{ ['--d' as string]: good ? 'var(--an-good)' : 'var(--an-bad)' }}
      title={`${fmt(prev)} → ${fmt(current)}`}
    >
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export function KpiGrid({ kpis }: { kpis: KpiStat[] }) {
  return (
    <div className="an-kpis">
      {kpis.map((k) => (
        <div key={k.label} className="an-kpi">
          <span className="an-kpi-l">{k.label}</span>
          <span className="an-kpi-v">{k.value}</span>
          <span className="an-kpi-foot">
            {k.delta ? <Delta delta={k.delta} /> : null}
            {k.hint ? <span>{k.hint}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Trend: vertical bars, one series ────────────────────────────────────────────────────────

/**
 * A single series over 14 days of discrete daily counts → BARS, not a line: the values are counts
 * per day, and a line would imply a continuous quantity between them.
 *
 * One series, so there is no legend — the card title names it. Each bar carries a `<title>` for the
 * native hover tooltip, and the whole chart has an accessible label plus a caption, so the numbers
 * are reachable without hovering.
 */
export function TrendBars({ points, label }: { points: TrendPoint[]; label: string }) {
  const uid = useId();
  if (points.length === 0) return <div className="an-chart-empty">No data in this period.</div>;

  const W = 720;
  const H = 190;
  const PAD_B = 22;
  const PAD_T = 10;
  const max = Math.max(...points.map((p) => p.value), 1);
  const plot = H - PAD_B - PAD_T;
  // 2px surface gap between adjacent fills.
  const slot = W / points.length;
  const bw = Math.max(6, slot - 2);

  /** Label every ~4th day so the axis never collides with itself. */
  const step = Math.ceil(points.length / 7);

  return (
    <svg
      className="an-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-labelledby={`${uid}-t`}
      preserveAspectRatio="none"
    >
      <title id={`${uid}-t`}>{label}</title>
      {/* Recessive gridlines at 0 / 50 / 100% of the max. */}
      {[0, 0.5, 1].map((f) => {
        const y = PAD_T + plot * (1 - f);
        return <line key={f} className="an-grid-line" x1={0} x2={W} y1={y} y2={y} />;
      })}
      {points.map((p, i) => {
        const h = Math.max(2, (p.value / max) * plot);
        const x = i * slot + (slot - bw) / 2;
        const y = PAD_T + plot - h;
        return (
          <g key={`${p.label}-${i}`} className="an-bargroup">
            <rect
              className={`an-bar${p.partial ? ' is-partial' : ''}`}
              x={x}
              y={y}
              width={bw}
              height={h}
            >
              <title>
                {p.label}: {fmt(p.value)}
                {p.partial ? ' (day in progress)' : ''}
              </title>
            </rect>
          </g>
        );
      })}
      {points.map((p, i) =>
        i % step === 0 || i === points.length - 1 ? (
          <text
            key={`x-${i}`}
            className="an-axis-t"
            x={i * slot + slot / 2}
            y={H - 7}
            textAnchor="middle"
          >
            {p.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

// ─── Breakdown: horizontal bars, direct-labelled ─────────────────────────────────────────────

export function Breakdown({ items }: { items: BreakdownItem[] }) {
  const rows = foldSeries(items);
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <>
      <div className="an-bd">
        {rows.map((r) => (
          <div key={r.label} className="an-bd-row">
            <span className="an-bd-l" title={r.label}>
              {r.label}
            </span>
            <span className="an-bd-track">
              <span
                className="an-bd-fill"
                style={{ width: `${(r.value / max) * 100}%`, ['--c' as string]: r.color }}
              />
            </span>
            <span className="an-bd-v">
              {fmt(r.value)}
              <span className="an-bd-pct">{((r.value / total) * 100).toFixed(0)}%</span>
            </span>
          </div>
        ))}
      </div>
      {/* ≥2 series → a legend is always present, so identity is never colour-alone. */}
      <div className="an-legend">
        {rows.map((r) => (
          <span key={r.label} className="an-legend-i">
            <span className="an-legend-sw" style={{ ['--c' as string]: r.color }} />
            {r.label}
          </span>
        ))}
      </div>
    </>
  );
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────────────────────

export function Leaderboard({
  rows,
  cols,
}: {
  rows: LeaderboardRow[];
  cols: [string, string, string];
}) {
  return (
    <div className="an-tablewrap">
      <div className="an-tablescroll">
        <table className="an-table">
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              <th>Name</th>
              <th style={{ textAlign: 'right' }}>{cols[0]}</th>
              <th style={{ textAlign: 'right' }}>{cols[1]}</th>
              <th style={{ textAlign: 'right' }}>{cols[2]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.name}-${i}`}>
                <td>
                  <span className={`an-rank${i === 0 ? ' is-top' : ''}`}>{i + 1}</span>
                </td>
                <td className="an-name">{r.name}</td>
                <td className="an-num">{typeof r.col1 === 'number' ? fmt(r.col1) : r.col1}</td>
                <td className="an-num">{typeof r.col2 === 'number' ? fmt(r.col2) : r.col2}</td>
                <td className="an-num">{typeof r.col3 === 'number' ? fmt(r.col3) : r.col3}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
