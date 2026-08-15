/**
 * Score history for one carrier.
 *
 * The band cut-points are drawn as guides rather than left implicit: "612" means nothing on its own,
 * but "612, and the Elevated line is at 580" is a decision. The y-domain is always widened to
 * include every cut-point so those guides are on screen even for a carrier that never leaves one
 * band — otherwise the chart would silently change meaning between carriers.
 */
import { BAND_CUTS, bandOf, fmtDate, fmtScore } from './watchFormat';
import type { WatchHistoryPoint } from '@/api/mytrionWatch';

const W = 640;
const H = 190;
const PAD_L = 40;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 26;

export function WatchHistoryChart({ history }: { history: WatchHistoryPoint[] }) {
  if (history.length === 0) return null;

  const scores = history.map((p) => p.creditScore);
  const cuts = BAND_CUTS.map((c) => c.below);
  const lo = Math.min(...scores, ...cuts) - 20;
  const hi = Math.max(...scores, ...cuts) + 20;
  const span = hi - lo || 1;

  const x = (i: number) =>
    history.length === 1
      ? PAD_L + (W - PAD_L - PAD_R) / 2
      : PAD_L + (i / (history.length - 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - (v - lo) / span) * (H - PAD_T - PAD_B);

  const line = history.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.creditScore).toFixed(1)}`).join(' ');
  const area =
    history.length > 1
      ? `${line} L${x(history.length - 1).toFixed(1)},${(H - PAD_B).toFixed(1)} L${x(0).toFixed(1)},${(H - PAD_B).toFixed(1)} Z`
      : '';

  const last = history[history.length - 1];
  const first = history[0];
  const move = last && first ? last.creditScore - first.creditScore : 0;

  return (
    <>
      <svg
        className="mw-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={
          `Score history over ${history.length} snapshot${history.length === 1 ? '' : 's'}: ` +
          `${fmtScore(first?.creditScore)} on ${fmtDate(first?.scoringDate)} to ` +
          `${fmtScore(last?.creditScore)} on ${fmtDate(last?.scoringDate)}, ` +
          `${move >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(move))} points.`
        }
      >
        {BAND_CUTS.map((c) => (
          <g key={c.band}>
            <line className="mw-chart-guide" x1={PAD_L} x2={W - PAD_R} y1={y(c.below)} y2={y(c.below)} />
            <text className="mw-chart-guide-label" x={4} y={y(c.below) + 4}>
              {c.below}
            </text>
          </g>
        ))}

        {area ? <path className="mw-chart-area" d={area} /> : null}
        <path className="mw-chart-line" d={line} />

        {history.map((p, i) => (
          <circle
            key={p.scoringDate}
            className="mw-chart-dot"
            data-band={bandOf(p.creditScore)}
            data-last={i === history.length - 1}
            cx={x(i)}
            cy={y(p.creditScore)}
            r={i === history.length - 1 ? 5 : 3.5}
          >
            <title>{`${fmtDate(p.scoringDate)} — ${fmtScore(p.creditScore)}`}</title>
          </circle>
        ))}

        {/* Only the ends are labelled: a weekly series crowds the axis and the middle dates are
            recoverable from the tooltips. */}
        <text className="mw-chart-x" x={x(0)} y={H - 6}>
          {fmtDate(first?.scoringDate)}
        </text>
        {history.length > 1 ? (
          <text className="mw-chart-x" x={x(history.length - 1)} y={H - 6}>
            {fmtDate(last?.scoringDate)}
          </text>
        ) : null}
      </svg>

      <p className="mw-pane-sub">
        {history.length === 1
          ? 'One snapshot so far — movement appears from the next weekly run.'
          : `${fmtScore(first?.creditScore)} → ${fmtScore(last?.creditScore)} across ${history.length} weekly snapshots (${move >= 0 ? '+' : ''}${Math.round(move)}).`}
      </p>
    </>
  );
}
