/**
 * One carrier's behavioural score, and the evidence for it.
 *
 * The order answers a credit agent's questions in the order they ask them: what is the score and
 * does it matter (hero, with the score placed on the band scale so the number has a size), where has
 * it been going (history), how was it reached (the arithmetic, not hidden), and what is it built
 * from (one row per measure). Nothing here re-queries the warehouse — every figure is the snapshot
 * that produced the score, so the explanation always matches the number.
 */
import { useCallback } from 'react';
import { ArrowLeft, ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useCachedLoad } from '../../_shared/swrCache';
import { WatchHistoryChart } from './WatchHistoryChart';
import { WatchDrivers } from './WatchDrivers';
import {
  BAND_LABEL,
  BAND_MEANING,
  BAND_ORDER,
  bandCuts,
  fmtDelta,
  fmtMoney,
  fmtPd,
  fmtScore,
  fmtDate,
} from './watchFormat';
import { getWatchCarrier, watchNum, type WatchModel } from '@/api/mytrionWatch';
import './watchDetail.css';

export function WatchDetail({ carrierId, onBack }: { carrierId: string; onBack: () => void }) {
  const load = useCallback(() => getWatchCarrier(carrierId), [carrierId]);
  const { data, loading, error } = useCachedLoad(`verification:watch:carrier:${carrierId}`, load);

  const score = data?.score ?? null;
  const model = data?.model ?? null;
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
            Carrier {carrierId} has no snapshot. Only carriers that fuelled in the last 31 days, and
            that are neither prepay nor already in collections, are scored.
          </span>
        </div>
      ) : (
        <>
          <header className="mw-hero" data-band={band}>
            <div className="mw-hero-top">
              <div className="mw-hero-score">
                <span className="mw-hero-v">{fmtScore(watchNum(score.creditScore))}</span>
                <span className="mw-pill" data-band={band}>
                  {BAND_LABEL[band]}
                </span>
              </div>
              <div className="mw-hero-body">
                <h2 className="mw-hero-name">{score.companyName ?? `Carrier ${score.carrierId}`}</h2>
                <p className="mw-hero-meaning">{BAND_MEANING[band]}</p>
              </div>
            </div>

            <ScoreScale score={watchNum(score.creditScore) ?? 0} model={model} band={band} />

            <dl className="mw-hero-facts">
              <Fact k="Carrier">{score.carrierId}</Fact>
              <Fact k="Approved limit">{fmtMoney(watchNum(score.creditLimit))}</Fact>
              <Fact k="Chance of default">{fmtPd(watchNum(score.pdScore))}</Fact>
              <Fact k="Since last week">
                <span className="mw-delta" data-dir={dir}>
                  <DeltaIcon size={12} aria-hidden />
                  {delta === null ? 'First snapshot' : fmtDelta(delta)}
                </span>
              </Fact>
              <Fact k="Account manager">{score.agentName ?? 'Unassigned'}</Fact>
              <Fact k="Scored">{fmtDate(score.scoringDate)}</Fact>
            </dl>
          </header>

          <div className="mw-panes">
            <section className="mw-pane" data-band={band}>
              <h3 className="mw-pane-title">Score history</h3>
              <WatchHistoryChart history={data?.history ?? []} model={model} />
            </section>

            <section className="mw-pane">
              <h3 className="mw-pane-title">How this score was reached</h3>
              <Arithmetic
                sum={watchNum(score.sumContribution)}
                logit={watchNum(score.logit)}
                pd={watchNum(score.pdScore)}
                creditScore={watchNum(score.creditScore)}
                model={model}
              />
            </section>

            <section className="mw-pane" data-span="full">
              <h3 className="mw-pane-title">What the score is built from</h3>
              <p className="mw-pane-sub">
                Every measure the model reads, heaviest first, as at {fmtDate(score.scoringDate)}.
              </p>
              <WatchDrivers
                rows={data?.contributions ?? []}
                meta={data?.featureMeta ?? []}
                features={score.features}
              />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="mw-hf">
      <dt className="mw-hf-k">{k}</dt>
      <dd className="mw-hf-v">{children}</dd>
    </div>
  );
}

/**
 * The score placed on the band scale.
 *
 * "490" is not a quantity until you can see where it sits: 30 points below the Elevated line and
 * 150 below Low risk. The zones are drawn to the model's own cut-points, so the picture cannot
 * disagree with the pill next to it.
 */
function ScoreScale({
  score,
  model,
  band,
}: {
  score: number;
  model: WatchModel | null;
  band: string;
}) {
  const cuts = bandCuts(model);
  const highCut = cuts[0]?.below ?? 520;
  const watchCut = cuts[2]?.below ?? 640;
  const lo = highCut - 80;
  const hi = watchCut + 120;
  const at = Math.min(100, Math.max(0, ((score - lo) / (hi - lo)) * 100));

  // Zone widths in domain order: high, elevated, watch, low.
  const edges = [lo, cuts[0]?.below ?? 520, cuts[1]?.below ?? 580, cuts[2]?.below ?? 640, hi];
  const zones = BAND_ORDER.slice()
    .reverse()
    .map((b, i) => ({
      band: b,
      pct: (((edges[i + 1] as number) - (edges[i] as number)) / (hi - lo)) * 100,
    }));

  return (
    <div className="mw-scale">
      <div className="mw-scale-track">
        {zones.map((z) => (
          <span key={z.band} className="mw-scale-zone" data-band={z.band} style={{ flexBasis: `${z.pct}%` }} />
        ))}
        <span
          className="mw-scale-mark"
          data-band={band}
          style={{ ['--mw-at' as string]: `${at.toFixed(2)}%` }}
          aria-hidden
        />
      </div>
      <div className="mw-scale-ticks" aria-hidden>
        <span>{Math.round(lo)}</span>
        {cuts.map((c) => (
          <span key={c.band}>{c.below}</span>
        ))}
        <span>{Math.round(hi)}</span>
      </div>
    </div>
  );
}

/**
 * The arithmetic, shown rather than implied.
 *
 * A credit decision that a carrier may appeal has to be reproducible on paper. These four lines are
 * the whole model: the evidence adds up, the baseline shifts it, the logistic curve turns it into a
 * probability, and the scaling turns that into the number on the card.
 */
function Arithmetic({
  sum,
  logit,
  pd,
  creditScore,
  model,
}: {
  sum: number | null;
  logit: number | null;
  pd: number | null;
  creditScore: number | null;
  model: WatchModel | null;
}) {
  const intercept = watchNum(model?.intercept);
  const signed = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(3)}`);

  return (
    <ol className="mw-math">
      <li className="mw-math-row">
        <span className="mw-math-k">Evidence from the eight measures</span>
        <span className="mw-math-v">{signed(sum)}</span>
      </li>
      <li className="mw-math-row">
        <span className="mw-math-k">Model baseline</span>
        <span className="mw-math-v">{signed(intercept)}</span>
      </li>
      <li className="mw-math-row" data-total="true">
        <span className="mw-math-k">Log-odds of default</span>
        <span className="mw-math-v">{signed(logit)}</span>
      </li>
      <li className="mw-math-row">
        <span className="mw-math-k">Chance of default</span>
        <span className="mw-math-v">{fmtPd(pd)}</span>
      </li>
      <li className="mw-math-row" data-total="true">
        <span className="mw-math-k">Score</span>
        <span className="mw-math-v">{fmtScore(creditScore)}</span>
      </li>
      <li className="mw-math-note">
        {model
          ? `Scaled so ${Math.round(Number(model.baseScore))} is a 1-in-${Math.round(Number(model.baseOdds))} chance of default, and every ${Math.round(Number(model.pdo))} points either way doubles or halves it. Model ${model.modelVersion}.`
          : 'Model weights unavailable for this snapshot.'}
      </li>
    </ol>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        Loading carrier score
      </span>
      <div aria-hidden="true" className="mw-detail">
        <div className="mw-hero">
          <div className="mw-hero-top">
            <div className="mw-hero-score">
              <span className="mw-sk mw-sk-value" />
              <span className="mw-sk mw-sk-line" />
            </div>
            <div className="mw-hero-body">
              <span className="mw-sk mw-sk-title" />
              <span className="mw-sk mw-sk-line" />
            </div>
          </div>
          <span className="mw-sk mw-sk-scale" />
        </div>
        <div className="mw-panes">
          {[0, 1].map((i) => (
            <div key={i} className="mw-pane">
              <span className="mw-sk mw-sk-line" />
              <span className="mw-sk mw-sk-block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
