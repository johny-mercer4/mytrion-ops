/**
 * What the score is built from — one row per feature, heaviest first.
 *
 * This replaces two panes that listed the same eight features twice ("what is driving it" with a
 * weight, "behaviour on file" with a value). One row now carries the whole story: what was measured,
 * what the carrier's value was, which bucket that fell in, and what it did to the score. The bucket
 * is the half that was missing — a weight of +1.60 means nothing until you can see the value landed
 * in "up to 47%", the worst of six buckets.
 */
import { fmtBin, fmtValue } from './watchFormat';
import type { WatchContribution, WatchFeatureMeta } from '@/api/mytrionWatch';

export function WatchDrivers({
  rows,
  meta,
  features,
}: {
  rows: WatchContribution[];
  meta: WatchFeatureMeta[];
  features: Record<string, number | null>;
}) {
  if (rows.length === 0) {
    return <p className="mw-pane-sub">No per-feature breakdown was stored for this snapshot.</p>;
  }

  const byKey = new Map(meta.map((m) => [m.key, m]));
  // Scaled against the largest ABSOLUTE weight, so a feature raising risk by 1.6 visibly dwarfs one
  // protecting by 0.2. Scaling each side separately would draw them equal and invert the story.
  const max = Math.max(...rows.map((r) => Math.abs(r.contribution ?? 0)), 0.0001);

  return (
    <div className="mw-table">
      <div className="mw-thead" aria-hidden="true">
        <span>Measure</span>
        <span>Value</span>
        <span>Bucket it fell in</span>
        <span className="mw-th-effect">Effect on risk</span>
      </div>

      <ul className="mw-trows">
        {rows.map((r) => {
          const m = byKey.get(r.feature);
          const unit = m?.unit ?? 'days';
          const c = Number(r.contribution) || 0;
          const pct = (Math.abs(c) / max) * 50;
          const raw = features?.[r.feature] ?? r.rawValue;
          const risky = c > 0;

          return (
            <li key={r.feature} className="mw-trow" data-missing={r.isNan}>
              <span className="mw-tcell mw-tname">
                <span className="mw-tlabel">{m?.label ?? r.feature}</span>
                <span className="mw-thelp">{m?.help}</span>
              </span>

              <span className="mw-tcell mw-tvalue">{fmtValue(raw, unit)}</span>

              <span className="mw-tcell mw-tbin">
                {fmtBin(r.lowerB, r.upperB, r.isNan, unit)}
              </span>

              <span className="mw-tcell mw-teffect">
                <span className="mw-bar">
                  <span
                    className="mw-bar-fill"
                    data-dir={risky ? 'risk' : 'safe'}
                    style={{ ['--mw-w' as string]: `${pct.toFixed(1)}%` }}
                  />
                </span>
                <span className="mw-tweight" data-dir={risky ? 'risk' : 'safe'}>
                  {risky ? '+' : ''}
                  {c.toFixed(2)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mw-pane-sub">
        Effect is weight of evidence × model coefficient. A bar to the right pushed the probability of
        default up; a bar to the left held it down. Rows marked <em>no data</em> use the model’s
        own “nothing on file” weight — a gap, not a behaviour.
      </p>
    </div>
  );
}
