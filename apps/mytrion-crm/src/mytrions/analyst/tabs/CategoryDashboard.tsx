import { RefreshCw, TriangleAlert } from 'lucide-react';

import { useAnalyticsSnapshot } from '@/components/analytics';

import type { CategoryDef, DashboardFilterParams } from '../categories';
import { DashboardFilters } from '../DashboardFilters';
import { DashboardState } from '../DashboardState';
import { Breakdown, KpiGrid, Leaderboard, TrendBars } from '../charts';
import type { AnalyticsBlock } from '../data';

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
 * A block that came back successfully but holds nothing for the window — no breakdown rows, no
 * leaderboard rows, and a flat-zero trend. Distinct from a failed fetch: the warehouse answered,
 * the answer is "nothing happened". Rendering the normal grid here would be a wall of zeros and
 * empty panels that reads like a broken page.
 */
function isEmptyBlock(block: AnalyticsBlock): boolean {
  return (
    block.breakdown.length === 0 &&
    block.leaderboard.length === 0 &&
    block.trend.every((p) => p.value === 0)
  );
}

/**
 * One category dashboard (Sales / CRM / CS / Finance / Billing / Transactions).
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
  /** First load (or a filter change) with nothing to show yet — the big panel owns the spinner. */
  const busy = snap.loading || !snap.hasAttempted;

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
          {/* Exactly one spinner on screen: while the big loading panel is up this button is
              inert and static, so it never becomes a second indicator for the same wait. */}
          <button
            type="button"
            className="an-btn"
            onClick={() => void snap.refresh()}
            disabled={snap.refreshing || busy}
          >
            <RefreshCw size={15} className={snap.refreshing && !busy ? 'an-spin' : ''} />
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
        busy ? (
          <DashboardState kind="loading" detail="Pulling the latest warehouse KPIs for this view" />
        ) : (
          <DashboardState
            kind="error"
            detail={
              error
                ? `The warehouse did not answer (${error}). Rapid filter changes can exhaust the shared connection pool — retry in a moment.`
                : 'The warehouse returned no snapshot for this view.'
            }
            onRetry={() => void snap.refresh()}
            retrying={snap.refreshing}
          />
        )
      ) : isEmptyBlock(block) ? (
        <DashboardState
          kind="empty"
          detail={`${
            filters.agentName ? `${filters.agentName} has` : 'There is'
          } no recorded activity for ${rangeHint(filters.range).toLowerCase()}. The query succeeded — the window is simply empty. Try a wider range.`}
        />
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
