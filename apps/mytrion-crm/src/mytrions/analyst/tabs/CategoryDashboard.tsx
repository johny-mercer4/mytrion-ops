import { RefreshCw, TriangleAlert } from 'lucide-react';

import { useAnalyticsSnapshot } from '@/components/analytics';
import { ComingSoon } from '../../_shared/ComingSoon';

import type { CategoryDef, DashboardFilterParams } from '../categories';
import { DashboardFilters } from '../DashboardFilters';
import { Breakdown, KpiGrid, Leaderboard, TrendBars } from '../charts';

export interface CategoryDashboardProps {
  category: CategoryDef;
  filters: DashboardFilterParams;
  onFiltersChange: (next: DashboardFilterParams) => void;
}

function rangeHint(range: DashboardFilterParams['range']): string {
  switch (range) {
    case 'today':
      return 'Today';
    case 'last_7_days':
      return 'Last 7 days';
    case 'this_month':
      return 'This month';
    case 'custom':
      return 'this custom range';
  }
}

/**
 * One category dashboard (Sales / CS / Finance / Billing / Transactions).
 * Filter params are sent to GET /v1/analytics/:dimension → parameterized DWH SQL, so KPIs,
 * trend, breakdown, and leaderboard all reflect the selected agent / date window.
 */
export function CategoryDashboard({ category, filters, onFiltersChange }: CategoryDashboardProps) {
  const dimension = category.dimension ?? 'pipeline';
  const snap = useAnalyticsSnapshot({
    dimension,
    filters: {
      agentId: filters.agentId,
      agentName: filters.agentName,
      range: filters.range,
      from: filters.from,
      to: filters.to,
    },
  });
  const { block, computedAt, error } = snap.current;

  const appFillsKpi = block?.kpis.find((k) => k.label === 'App Fills');
  const appFillsZero =
    Boolean(filters.agentName) &&
    Boolean(block) &&
    (appFillsKpi?.value === '0' || appFillsKpi?.value === '0.0');

  return (
    <div className="an-page">
      <header className="an-head">
        <div>
          <div className="an-kicker">Analytics</div>
          <h1 className="an-title">{category.label}</h1>
          <p className="an-sub">{category.description}</p>
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

      <DashboardFilters category={category} value={filters} onChange={onFiltersChange} />

      {error && block ? (
        <div className="an-banner">
          <TriangleAlert size={15} />
          <span>
            <strong>Figures may be stale.</strong> The last refresh failed ({error}) — showing the
            previous snapshot.
          </span>
        </div>
      ) : null}

      {appFillsZero ? (
        <div className="an-banner">
          <TriangleAlert size={15} />
          <span>
            <strong>{filters.agentName}</strong> has no app fills in{' '}
            {rangeHint(filters.range).toLowerCase()}. Their recent activity may sit on other days —
            try <strong>Last 7 days</strong> or <strong>This month</strong>.
          </span>
        </div>
      ) : null}

      {!block ? (
        snap.loading || !snap.hasAttempted ? (
          <ComingSoon
            icon={<RefreshCw size={26} className="an-spin" />}
            title="Loading analytics…"
            body="Pulling KPIs from the warehouse for this agent and date range. Filtered views are cached for a few minutes so switches stay snappy."
            tone="var(--an-s2)"
          />
        ) : (
          <ComingSoon
            icon={<TriangleAlert size={26} />}
            title={error ? 'Analytics unavailable' : 'No snapshot yet'}
            body={
              error
                ? `The analytics warehouse timed out or is unreachable (${error}). Click Refresh to retry — rapid filter changes can exhaust the shared DWH pool.`
                : 'The warehouse has not produced a snapshot for this dimension yet.'
            }
            tone="var(--an-s2)"
          />
        )
      ) : (
        <>
          <KpiGrid kpis={block.kpis} />

          <div className="an-grid-2">
            <section className="an-card">
              <div className="an-card-head">
                <span className="an-card-title">{block.trendLabel}</span>
                <span className="an-card-note">{block.trend.length} days</span>
              </div>
              {block.trend.length > 0 ? (
                <TrendBars points={block.trend} label={block.trendLabel} />
              ) : (
                <p className="an-empty-note">No trend days in the selected date range.</p>
              )}
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
              <span className="an-card-note">
                {filters.agentName ? `filtered · ${block.leaderboard.length}` : `top ${block.leaderboard.length}`}
              </span>
            </div>
            {block.leaderboard.length > 0 ? (
              <Leaderboard rows={block.leaderboard} cols={block.leaderboardCols} />
            ) : (
              <p className="an-empty-note">No leaderboard rows in this snapshot.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
