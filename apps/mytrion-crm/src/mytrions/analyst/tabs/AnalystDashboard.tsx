import { Receipt, RefreshCw, TrendingUp, TriangleAlert, Wallet } from 'lucide-react';
import { useAnalyticsSnapshot } from '@/components/analytics';
import { ComingSoon } from '../../_shared/ComingSoon';
import { Breakdown, KpiGrid, Leaderboard, TrendBars } from '../charts';
import type { AnalyticsDimension } from '../data';

/**
 * Analytics → Dashboard. The warehouse snapshot for one dimension.
 *
 * `useAnalyticsSnapshot` calls GET /v1/analytics/:dimension (~2h cache, 5-minute poll). There is no
 * sample fallback: if the warehouse is unreachable this renders an error or an empty state, never
 * invented figures.
 */

const DIMENSIONS: { id: AnalyticsDimension; label: string; icon: typeof TrendingUp }[] = [
  { id: 'pipeline', label: 'Pipeline', icon: TrendingUp },
  { id: 'transactions', label: 'Transactions', icon: Receipt },
  { id: 'billing', label: 'Billing', icon: Wallet },
];

export function AnalystDashboard({
  dimension,
  onDimensionChange,
}: {
  dimension: AnalyticsDimension;
  onDimensionChange: (d: AnalyticsDimension) => void;
}) {
  const snap = useAnalyticsSnapshot({ dimension });
  const { block, computedAt, error } = snap.current;

  return (
    <div className="an-page">
      <header className="an-head">
        <div>
          <div className="an-kicker">Analytics</div>
          <h1 className="an-title">Dashboard</h1>
          <p className="an-sub">{block?.caption ?? 'Warehouse snapshots across the org.'}</p>
        </div>
        <div className="an-head-actions">
          {computedAt ? (
            <span className="an-meta">
              <span className={error ? 'an-sample' : 'an-live'}>{error ? 'Stale' : 'Live'}</span>
              {` · computed ${new Date(computedAt).toLocaleString('en-GB', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}`}
            </span>
          ) : null}
          <button
            type="button"
            className="an-btn"
            onClick={() => void snap.refresh()}
            disabled={snap.refreshing}
          >
            <RefreshCw size={15} className={snap.refreshing ? 'an-spin' : ''} />
            Refresh
          </button>
        </div>
      </header>

      <div className="an-dims">
        {DIMENSIONS.map((d) => (
          <button
            key={d.id}
            type="button"
            className="an-dim"
            aria-pressed={dimension === d.id}
            onClick={() => onDimensionChange(d.id)}
          >
            <d.icon size={14} />
            {d.label}
          </button>
        ))}
      </div>

      {/* A failed poll over a previously-loaded block: the figures stay, flagged as stale. */}
      {error && block ? (
        <div className="an-banner">
          <TriangleAlert size={15} />
          <span>
            <strong>Figures may be stale.</strong> The last refresh failed ({error}) — showing the
            previous snapshot.
          </span>
        </div>
      ) : null}

      {/* No block at all: say so. Never substitute invented numbers for a failed fetch. */}
      {!block ? (
        snap.hasAttempted ? (
          <ComingSoon
            icon={<TriangleAlert size={26} />}
            title={error ? 'Analytics unavailable' : 'No snapshot yet'}
            body={
              error
                ? `The analytics warehouse did not answer (${error}). Nothing is shown rather than a stand-in figure — retry once the snapshot service is reachable.`
                : 'The warehouse has not produced a snapshot for this dimension yet.'
            }
            tone="var(--an-s2)"
          />
        ) : (
          <div className="an-sk" style={{ height: 260 }} />
        )
      ) : (
        <>
          <KpiGrid kpis={block.kpis} />

          <div className="an-grid-2">
            <section className="an-card">
              <div className="an-card-head">
                <span className="an-card-title">{block.trendLabel}</span>
                <span className="an-card-note">last {block.trend.length} days</span>
              </div>
              <TrendBars points={block.trend} label={block.trendLabel} />
            </section>

            <section className="an-card">
              <div className="an-card-head">
                <span className="an-card-title">{block.breakdownLabel}</span>
                <span className="an-card-note">share of total</span>
              </div>
              <Breakdown items={block.breakdown} />
            </section>
          </div>

          <section className="an-card">
            <div className="an-card-head">
              <span className="an-card-title">{block.leaderboardLabel}</span>
              <span className="an-card-note">top {block.leaderboard.length}</span>
            </div>
            <Leaderboard rows={block.leaderboard} cols={block.leaderboardCols} />
          </section>
        </>
      )}
    </div>
  );
}
