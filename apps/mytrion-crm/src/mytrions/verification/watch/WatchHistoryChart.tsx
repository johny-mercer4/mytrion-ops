/**
 * Score history for one carrier.
 *
 * The band cut-points are drawn as guides rather than left implicit: "612" means nothing on its own,
 * but "612, and the Elevated line is at 580" is a decision. The y-domain is always widened to
 * include every cut-point so those guides are on screen even for a carrier that never leaves one
 * band — otherwise the chart would silently change meaning between carriers.
 *
 * Cut-points come from the model that produced the score, never from a constant in here.
 */
import { bandCuts, bandOf, fmtDate, fmtScore } from './watchFormat';
import type { WatchHistoryPoint, WatchModel } from '@/api/mytrionWatch';

const W = 640;
const H = 190;
const PAD_L = 44;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 26;

export function WatchHistoryChart({
  history,
  model,
}: {
  history: WatchHistoryPoint[];
  model: WatchModel | null;
}) {
  const cuts = bandCuts(model);

  /**
   * A single point drawn on a full chart reads as a broken chart — one dot floating in an empty
   * frame. Until there are two snapshots there is no trend to draw, so say that instead.
   */
  if (history.length < 2) {
    const only = history[0];
    return (
      <div className="mw-nochart">
        {only ? (
          <>
            <span className="mw-nochart-v" data-band={bandOf(only.creditScore, model)}>
              {fmtScore(only.creditScore)}
            </span>
            <span className="mw-nochart-t">First snapshot, {fmtDate(only.scoringDate)}</span>
            <span className="mw-nochart-b">
              A trend needs two runs. This carrier gets its first movement reading after
              tomorrow’s scoring.
            </span>
          </>
        ) : (
          <span className="mw-nochart-b">No snapshots on file for this carrier.</span>
        )}
      </div>
    );
  }

  const scores = history.map((p) => p.creditScore);
  const cutValues = cuts.map((c) => c.below);
  const lo = Math.min(...scores, ...cutValues) - 20;
  const hi = Math.max(...scores, ...cutValues) + 20;
  const span = hi - lo || 1;

  const x = (i: number) => PAD_L + (i / (history.length - 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - (v - lo) / span) * (H - PAD_T - PAD_B);

  const line = history
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.creditScore).toFixed(1)}`)
    .join(' ');
  const area = `${line} L${x(history.length - 1).toFixed(1)},${(H - PAD_B).toFixed(1)} L${x(0).toFixed(1)},${(H - PAD_B).toFixed(1)} Z`;

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
          `Score history over ${history.length} snapshots: ` +
          `${fmtScore(first?.creditScore)} on ${fmtDate(first?.scoringDate)} to ` +
          `${fmtScore(last?.creditScore)} on ${fmtDate(last?.scoringDate)}, ` +
          `${move >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(move))} points.`
        }
      >
        {cuts.map((c) => (
          <g key={c.band}>
            <line className="mw-chart-guide" x1={PAD_L} x2={W - PAD_R} y1={y(c.below)} y2={y(c.below)} />
            <text className="mw-chart-guide-label" x={4} y={y(c.below) + 4}>
              {c.below}
            </text>
          </g>
        ))}

        <path className="mw-chart-area" d={area} />
        <path className="mw-chart-line" d={line} />

        {history.map((p, i) => (
          <circle
            key={p.scoringDate}
            className="mw-chart-dot"
            data-band={bandOf(p.creditScore, model)}
            data-last={i === history.length - 1}
            cx={x(i)}
            cy={y(p.creditScore)}
            r={i === history.length - 1 ? 5 : 3.5}
          >
            <title>{`${fmtDate(p.scoringDate)} — ${fmtScore(p.creditScore)}`}</title>
          </circle>
        ))}

        {/* Only the ends are labelled: a long series crowds the axis and the middle dates are
            recoverable from the tooltips. */}
        <text className="mw-chart-x" x={x(0)} y={H - 6}>
          {fmtDate(first?.scoringDate)}
        </text>
        <text className="mw-chart-x" x={x(history.length - 1)} y={H - 6}>
          {fmtDate(last?.scoringDate)}
        </text>
      </svg>

      <p className="mw-pane-sub">
        {fmtScore(first?.creditScore)} → {fmtScore(last?.creditScore)} across {history.length}
        snapshots ({move >= 0 ? '+' : ''}
        {Math.round(move)}).
      </p>
    </>
  );
}
