/**
 * The BOOK over time, not one carrier.
 *
 * The carrier detail already answers "is this carrier drifting". A credit lead asks the other
 * question — is the portfolio drifting, and is exposure concentrating in the bands that default.
 * Three things move together here: how the bands are mixed, the average score, and the money sitting
 * on Elevated + High.
 *
 * Reads our own snapshot table. Depth comes from whatever has been scored — a backfill gives it a
 * year; without one it is honest about having only a few points rather than drawing a line through
 * two dots and calling it a trend.
 */
import { useCallback } from 'react';
import { useCachedLoad } from '../../_shared/swrCache';
import { BAND_ORDER, BAND_SHORT, fmtDate, fmtMoneyShort, fmtScore } from './watchFormat';
import { getWatchHistory, watchNum, type PortfolioPoint, type WatchBand } from '@/api/mytrionWatch';
// The pane, chart and empty-state rules live with the detail surface; this view reuses them rather
// than re-authoring a second set. Imported explicitly so the dependency is visible, not incidental.
import './watchDetail.css';

const W = 900;
const H = 220;
const PAD = { l: 46, r: 16, t: 14, b: 28 };

/**
 * A change, with its direction always visible.
 *
 * `fmtMoneyShort` prints no sign, so a fall of $120k and a rise of $120k rendered identically —
 * which on the "exposure at risk" tile is the difference between good news and bad.
 */
function signed(delta: number, write: (abs: number) => string): string {
  if (Math.abs(delta) < 0.05) return `no change`;
  return `${delta > 0 ? '+' : '−'}${write(Math.abs(delta))}`;
}

/**
 * The span the snapshots cover. Years appear only when the range crosses one — "Sep 15 → Aug 10"
 * reads backwards on a year of history, and that is exactly the depth a backfill produces.
 */
function fmtSpan(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const year = (iso: string) => (sameYear ? '' : ` ${iso.slice(0, 4)}`);
  return `${fmtDate(from)}${year(from)} → ${fmtDate(to)}${year(to)}`;
}

export function WatchTimeline() {
  const load = useCallback(() => getWatchHistory(), []);
  const { data, loading, error } = useCachedLoad('verification:watch:history', load);
  const points = data?.points ?? [];

  if (loading && points.length === 0) {
    return <p className="mw-pane-sub">Reading the snapshot history…</p>;
  }
  if (error) {
    return (
      <div className="mw-banner" role="alert">
        <span className="mw-banner-title">Could not load the timeline</span>
        <p className="mw-banner-body">{String(error)}</p>
      </div>
    );
  }
  if (points.length < 2) {
    // Two dots joined by a line is not a trend, and drawing one would imply we know more than we do.
    return (
      <div className="mw-empty">
        <span className="mw-empty-title">Not enough history yet</span>
        <span>
          {points.length === 1
            ? 'One snapshot so far. A trend needs at least two — the next daily run adds one.'
            : 'Nothing scored yet. Scoring runs every morning.'}
        </span>
      </div>
    );
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const scoreShift = (watchNum(last.avgScore) ?? 0) - (watchNum(first.avgScore) ?? 0);
  const exposureShift = (watchNum(last.exposureAtRisk) ?? 0) - (watchNum(first.exposureAtRisk) ?? 0);

  return (
    <div className="mw-timeline">
      <div className="mw-stats">
        <Tile label="Snapshots" value={String(points.length)} hint={fmtSpan(first.scoringDate, last.scoringDate)} />
        <Tile
          label="Average score"
          value={fmtScore(watchNum(last.avgScore))}
          hint={`${signed(scoreShift, (v) => v.toFixed(1))} since the first snapshot`}
          tone={scoreShift < 0 ? 'bad' : 'ok'}
        />
        <Tile
          label="Exposure at risk"
          value={fmtMoneyShort(watchNum(last.exposureAtRisk))}
          hint={`${signed(exposureShift, (v) => fmtMoneyShort(v))} since the first`}
          tone={exposureShift > 0 ? 'bad' : 'ok'}
        />
        <Tile label="Carriers scored" value={String(last.total)} hint="in the latest snapshot" />
      </div>

      <section className="mw-pane">
        <h3 className="mw-pane-title">Band mix over time</h3>
        <p className="mw-pane-sub">
          Each column is one snapshot. Growth in the orange and red share is the book deteriorating,
          whatever the average score does.
        </p>
        <BandMix points={points} />
        <BandLegend point={last} />
      </section>

      <section className="mw-pane">
        <h3 className="mw-pane-title">Exposure at risk</h3>
        <p className="mw-pane-sub">
          Approved credit sitting on Elevated and High carriers, snapshot by snapshot. This is the
          money the score says is worth watching.
        </p>
        <ExposureLine points={points} />
      </section>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="mw-stat" {...(tone ? { 'data-tone': tone } : {})}>
      <span className="mw-stat-label">{label}</span>
      <span className="mw-stat-value">{value}</span>
      <span className="mw-stat-hint">{hint}</span>
    </div>
  );
}

/** Worst first — the same top-down order the columns stack in, so legend and chart read together. */
const MIX_ORDER: readonly WatchBand[] = BAND_ORDER.slice().reverse();

function countIn(p: PortfolioPoint, band: WatchBand): number {
  return band === 'high' ? p.high : band === 'elevated' ? p.elevated : band === 'watch' ? p.watch : p.low;
}

/** Stacked share per snapshot — proportion, because the population size also moves. */
function BandMix({ points }: { points: PortfolioPoint[] }) {
  const last = points[points.length - 1]!;
  return (
    <div
      className="mw-mix"
      role="img"
      aria-label={`Band mix across ${points.length} snapshots. Latest: ${MIX_ORDER.map((b) => `${countIn(last, b)} ${BAND_SHORT[b]}`).join(', ')}.`}
    >
      {points.map((p) => {
        const total = p.total || 1;
        return (
          <span
            key={p.scoringDate}
            className="mw-mix-col"
            title={`${p.scoringDate}: ${MIX_ORDER.map((b) => `${countIn(p, b)} ${BAND_SHORT[b]}`).join(', ')}`}
          >
            {MIX_ORDER.map((b) => {
              const n = countIn(p, b);
              return n > 0 ? (
                <span key={b} className="mw-mix-seg" data-band={b} style={{ flexBasis: `${(n / total) * 100}%` }} />
              ) : null;
            })}
          </span>
        );
      })}
    </div>
  );
}

/**
 * The latest column, in words.
 *
 * The columns carry their numbers on `title`, which a finger cannot summon — so the one snapshot the
 * desk asks about most is also written out, and the legend explains the colours while it is there.
 */
function BandLegend({ point }: { point: PortfolioPoint }) {
  return (
    <ul className="mw-mix-legend">
      {MIX_ORDER.map((b) => (
        <li key={b} className="mw-mix-key" data-band={b}>
          <span className="mw-mix-key-dot" aria-hidden="true" />
          {BAND_SHORT[b]}
          <b>{countIn(point, b)}</b>
        </li>
      ))}
      <li className="mw-mix-key-note">latest snapshot, {fmtDate(point.scoringDate)}</li>
    </ul>
  );
}

/** Exposure as a line. Domain starts at zero — a truncated money axis exaggerates every wobble. */
function ExposureLine({ points }: { points: PortfolioPoint[] }) {
  const vals = points.map((p) => watchNum(p.exposureAtRisk) ?? 0);
  const hi = Math.max(...vals, 1);
  const x = (i: number) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / hi) * (H - PAD.t - PAD.b);
  const line = points.map((_p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(vals[i] ?? 0).toFixed(1)}`).join(' ');

  return (
    <>
      <svg className="mw-chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Exposure at risk from ${fmtMoneyShort(vals[0])} to ${fmtMoneyShort(vals[vals.length - 1])}`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className="mw-chart-guide" x1={PAD.l} x2={W - PAD.r} y1={y(hi * f)} y2={y(hi * f)} />
            <text className="mw-chart-guide-label" x={4} y={y(hi * f) + 4}>{fmtMoneyShort(hi * f)}</text>
          </g>
        ))}
        <path className="mw-chart-area" d={`${line} L${x(points.length - 1).toFixed(1)},${H - PAD.b} L${x(0).toFixed(1)},${H - PAD.b} Z`} />
        <path className="mw-chart-line" d={line} />
        {/* Only the endpoint gets a dot: with a year of snapshots, one per point is a bead curtain. */}
        <circle className="mw-chart-dot" data-last="true" r={4}
          cx={x(points.length - 1)} cy={y(vals[vals.length - 1] ?? 0)} />
        <text className="mw-chart-x" x={x(0)} y={H - 6}>{fmtDate(points[0]?.scoringDate)}</text>
        <text className="mw-chart-x" x={x(points.length - 1)} y={H - 6}>{fmtDate(points[points.length - 1]?.scoringDate)}</text>
      </svg>
      <p className="mw-pane-sub">
        {points.length} snapshots · latest {fmtMoneyShort(vals[vals.length - 1])} on{' '}
        {points[points.length - 1]?.high} High and {points[points.length - 1]?.elevated} Elevated carriers.
      </p>
    </>
  );
}
