/**
 * One carrier's behavioural score, and why it is what it is.
 *
 * The order answers a credit agent's questions in the order they ask them: what is the score and
 * does it matter (hero), where has it been going (history), what is driving it (contributions),
 * what were the underlying numbers (features). Nothing here re-queries the warehouse — every figure
 * is the snapshot that produced the score, so the explanation always matches the number.
 */
import { useCallback } from 'react';
import { ArrowLeft, ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useCachedLoad } from '../../_shared/swrCache';
import { WatchHistoryChart } from './WatchHistoryChart';
import {
  BAND_LABEL,
  BAND_MEANING,
  fmtDelta,
  fmtFeature,
  fmtMoney,
  fmtPd,
  fmtScore,
  fmtDate,
} from './watchFormat';
import { getWatchCarrier, watchNum, type WatchContribution } from '@/api/mytrionWatch';
import './watchDetail.css';

export function WatchDetail({ carrierId, onBack }: { carrierId: string; onBack: () => void }) {
  const load = useCallback(() => getWatchCarrier(carrierId), [carrierId]);
  const { data, loading, error } = useCachedLoad(`verification:watch:carrier:${carrierId}`, load);

  const score = data?.score ?? null;
  const band = score?.band ?? 'low';
  const delta = watchNum(score?.scoreDelta);
  const dir = delta === null || delta === 0 ? 'flat' : delta < 0 ? 'down' : 'up';
  const DeltaIcon = dir === 'down' ? ArrowDownRight : dir === 'up' ? ArrowUpRight : Minus;

  return (
    <div className="mw mw-detail">
      <button type="button" className="mw-back" onClick={onBack}>
        <ArrowLeft size={14} aria-hidden /> Back to the watchlist
      </button>

      {error ? (
        <div className="mw-banner" role="alert">
          <span className="mw-banner-title">Could not load this carrier</span>
          <p className="mw-banner-body">{String(error)}</p>
        </div>
      ) : null}

      {loading && !score ? (
        <DetailSkeleton />
      ) : !score ? (
        <div className="mw-empty">
          <span className="mw-empty-title">Not scored</span>
          <span>
            Carrier {carrierId} has no snapshot. Only carriers that transacted in the last 31 days and
            are not prepay or in collections are scored.
          </span>
        </div>
      ) : (
        <>
          <header className="mw-hero" data-band={band}>
            <div className="mw-hero-score">
              <span className="mw-hero-v">{fmtScore(watchNum(score.creditScore))}</span>
              <span className="mw-pill" data-band={band}>
                {BAND_LABEL[band]}
              </span>
            </div>
            <div className="mw-hero-body">
              <span className="mw-hero-name">{score.companyName ?? `Carrier ${score.carrierId}`}</span>
              <p className="mw-hero-meaning">{BAND_MEANING[band]}</p>
              <div className="mw-meta">
                <span>Carrier {score.carrierId}</span>
                {score.agentName ? <span>{score.agentName}</span> : null}
                <span>Limit {fmtMoney(watchNum(score.creditLimit))}</span>
                <span>Default risk {fmtPd(watchNum(score.pdScore))}</span>
                <span className="mw-delta" data-dir={dir}>
                  <DeltaIcon size={12} aria-hidden />
                  {delta === null
                    ? 'First snapshot'
                    : `${fmtDelta(delta)} since ${fmtScore(watchNum(score.prevCreditScore))}`}
                </span>
                <span>Scored {fmtDate(score.scoringDate)}</span>
              </div>
            </div>
          </header>

          <div className="mw-panes">
            <section className="mw-pane" data-band={band}>
              <h3 className="mw-pane-title">Score history</h3>
              <WatchHistoryChart history={data?.history ?? []} />
            </section>

            <section className="mw-pane">
              <h3 className="mw-pane-title">What is driving it</h3>
              <p className="mw-pane-sub">
                Bars to the right raise the probability of default; bars to the left protect against it.
                Length is how much each feature moved the model.
              </p>
              <Contributions
                rows={data?.contributions ?? []}
                labels={data?.featureLabels ?? {}}
                features={score.features}
              />
            </section>

            <section className="mw-pane" data-span="full">
              <h3 className="mw-pane-title">Behaviour on file</h3>
              <p className="mw-pane-sub">
                The values the score was computed from, as at {fmtDate(score.scoringDate)}. Model{' '}
                {score.modelVersion}.
              </p>
              <dl className="mw-facts">
                {Object.entries(data?.featureLabels ?? {}).map(([key, label]) => (
                  <div key={key}>
                    <dt className="mw-fact-k">{label}</dt>
                    <dd className="mw-fact-v">{fmtFeature(score.features?.[key] ?? null)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The diverging bars.
 *
 * Scaled against the largest ABSOLUTE contribution rather than each side separately, so a feature
 * pushing risk up by 1.6 visibly dwarfs one protecting by 0.2 — scaling the two sides independently
 * would draw them the same length and invert the story.
 */
function Contributions({
  rows,
  labels,
  features,
}: {
  rows: WatchContribution[];
  labels: Record<string, string>;
  features: Record<string, number | null>;
}) {
  if (rows.length === 0) {
    return <p className="mw-pane-sub">No per-feature breakdown was stored for this snapshot.</p>;
  }

  const max = Math.max(...rows.map((r) => Math.abs(watchNum(r.contribution) ?? 0)), 0.0001);

  return (
    <ul className="mw-contribs">
      {rows.map((r) => {
        const c = watchNum(r.contribution) ?? 0;
        const pct = (Math.abs(c) / max) * 50;
        const raw = features?.[r.feature] ?? watchNum(r.rawValue);
        // binId -1 is the model's explicit "value was missing" bin — say so rather than showing a
        // weight against a blank, which reads like a bug.
        const missing = r.binId === -1;
        return (
          <li key={r.feature} className="mw-contrib">
            <span className="mw-contrib-label" title={labels[r.feature] ?? r.feature}>
              {labels[r.feature] ?? r.feature}
            </span>
            <span className="mw-bar">
              <span
                className="mw-bar-fill"
                data-dir={c >= 0 ? 'risk' : 'safe'}
                style={{ ['--mw-w' as string]: `${pct.toFixed(1)}%` }}
              />
            </span>
            <span className="mw-contrib-v">
              {missing ? 'No data' : fmtFeature(raw)}
              <span aria-hidden> · </span>
              {c >= 0 ? '+' : ''}
              {c.toFixed(2)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        Loading carrier score
      </span>
      <div aria-hidden="true" style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <div className="mw-hero">
          <div className="mw-hero-score">
            <span className="mw-sk mw-sk-value" style={{ width: '5rem', height: '2.5rem' }} />
            <span className="mw-sk mw-sk-line" style={{ width: '4.5rem' }} />
          </div>
          <div className="mw-hero-body">
            <span className="mw-sk mw-sk-title" />
            <span className="mw-sk mw-sk-line" style={{ width: '70%' }} />
            <span className="mw-sk mw-sk-line" style={{ width: '55%' }} />
          </div>
        </div>
        <div className="mw-panes">
          {[0, 1].map((i) => (
            <div key={i} className="mw-pane">
              <span className="mw-sk mw-sk-line" style={{ width: '32%' }} />
              <span className="mw-sk" style={{ height: '8rem' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
