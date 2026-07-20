/**
 * Cards by Company + Card Activity — self-service MSD parity layout.
 */
import type { MouseEvent, ReactNode } from 'react';
import { Icon } from './icons';
import { currentBillingCycle, msdFmtK, msdFmtNum } from './dashFormat';
import {
  msdActivityWidth,
  msdAreaPath,
  msdColLeftPct,
  msdLinePath,
  msdPointX,
  msdPointY,
  msdSelBandW,
  msdSelBandX,
} from './dashActivityGeom';
import type {
  ActivityRange,
  BarFilter,
  BarRow,
  CompanyStatus,
  SalesActivityPoint,
  SalesDailyCarrierRow,
} from './dashSalesData';

export interface SalesDashChartsProps {
  bars: BarRow[];
  maxBar: number;
  barFilter: BarFilter;
  setBarFilter: (f: BarFilter) => void;
  companyQ: string;
  setCompanyQ: (q: string) => void;
  statusFilter: CompanyStatus | null;
  setStatusFilter: (s: CompanyStatus | null) => void;
  selectedDates: Set<string> | null;
  dailyByCarrier: SalesDailyCarrierRow[];
  actPoints: SalesActivityPoint[];
  activityRange: ActivityRange;
  setActivityRange: (r: ActivityRange) => void;
  selStart: number | null;
  selEnd: number | null;
  hoverIdx: number | null;
  setHoverIdx: (i: number | null) => void;
  onActivityClick: (i: number, e: MouseEvent) => void;
  clearSelection: () => void;
  selectionLabel: string | null;
  /** Transaction Details (and anything else) under Card Activity in the right column. */
  children?: ReactNode;
}

export function SalesDashCharts(p: SalesDashChartsProps) {
  const len = p.actPoints.length;
  const chartW = msdActivityWidth(len);
  const maxTx = Math.max(1, ...p.actPoints.map((x) => x.transactions));
  const maxCards = Math.max(
    1,
    ...p.actPoints.map((x) => Math.max(x.activeCards, x.newCards)),
  );
  const txVals = p.actPoints.map((x) => x.transactions);
  const acVals = p.actPoints.map((x) => x.activeCards);
  const ncVals = p.actPoints.map((x) => x.newCards);
  const lo = p.selStart != null && p.selEnd != null ? Math.min(p.selStart, p.selEnd) : -1;
  const hi = p.selStart != null && p.selEnd != null ? Math.max(p.selStart, p.selEnd) : -1;
  const cycleLabel = currentBillingCycle().label;

  return (
    <div className="msd-bottom-row">
      <div className="msd-chart-block">
        <div className="msd-chart-header">
          <div>
            <span className="msd-chart-title">Cards by Company</span>
            {p.statusFilter ? (
              <span className={`msd-status-filter-badge msd-status-filter-badge--${p.statusFilter}`}>
                Showing {p.statusFilter}
                <button type="button" className="msd-sfb-x" onClick={() => p.setStatusFilter(null)} title="Clear filter">
                  ✕
                </button>
              </span>
            ) : (
              <span className="msd-chart-sub">{p.bars.length} companies</span>
            )}
          </div>
          <div className="msd-legend">
            {(
              [
                ['all', 'All', 'all'],
                ['active', 'Active Cards', '#16a34a'],
                ['new', 'New Cards', '#0284c7'],
                ['unique', 'Unique Cards', '#9f1239'],
              ] as const
            ).map(([id, label, color]) => (
              <button
                key={id}
                type="button"
                className={`msd-legend-btn${p.barFilter === id ? ' msd-legend-btn--on' : ''}`}
                onClick={() => p.setBarFilter(id)}
              >
                <span
                  className={`msd-legend-dot${id === 'all' ? ' msd-legend-dot--all' : ''}`}
                  style={id === 'all' ? undefined : { background: color }}
                />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="msd-bar-search-wrap">
          <Icon name="search" size={13} strokeWidth={2.2} className="msd-bar-search-icon" />
          <input
            value={p.companyQ}
            onChange={(e) => p.setCompanyQ(e.currentTarget.value)}
            type="text"
            className="msd-bar-search"
            placeholder="Search by company name or carrier ID…"
          />
          {p.companyQ ? (
            <button type="button" className="msd-bar-search-clear" onClick={() => p.setCompanyQ('')} title="Clear">
              ✕
            </button>
          ) : null}
        </div>

        {p.statusFilter === 'stuck' ? (
          <div className="msd-status-ctx msd-status-ctx--stuck">
            No transactions in <strong>more than 15 days</strong> — these accounts need immediate follow-up.
          </div>
        ) : null}
        {p.statusFilter === 'inactive' ? (
          <div className="msd-status-ctx msd-status-ctx--inactive">
            No transactions in <strong>10–15 days</strong> — starting to go quiet, consider reaching out soon.
          </div>
        ) : null}
        {p.selectedDates && p.dailyByCarrier.length > 0 && p.selectionLabel ? (
          <div className="msd-status-ctx msd-status-ctx--selrange">
            Showing only companies active in <strong>{p.selectionLabel}</strong>
            <button type="button" className="msd-selrange-clear" onClick={p.clearSelection}>
              Clear filter
            </button>
          </div>
        ) : null}

        <div className="msd-bar-chart">
          {p.bars.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              {p.selectedDates && !p.dailyByCarrier.length
                ? 'Day drilldown needs daily carrier data — open Automations → Transactions Report for a date range.'
                : p.companyQ
                  ? `No companies match “${p.companyQ}”`
                  : p.statusFilter
                    ? `No ${p.statusFilter} companies found`
                    : 'No data'}
            </div>
          ) : (
            p.bars.map((co) => (
              <div
                key={co.carrierId || co.name}
                className={`msd-bar-row${p.barFilter === 'all' ? ' msd-bar-row--all' : ''}`}
              >
                <div
                  className={`msd-bar-status msd-bar-status--${co.status}`}
                  title={
                    co.daysSinceTx != null
                      ? `${co.status} — last tx ${co.daysSinceTx}d ago`
                      : `${co.status} — no tx`
                  }
                />
                <div className="msd-bar-name" title={co.name}>
                  {co.name}
                </div>
                <div className={`msd-bar-days msd-bar-days--${co.status}`}>
                  {co.daysSinceTx != null ? `${co.daysSinceTx}d` : '—'}
                </div>
                {p.barFilter === 'all' ? (
                  <>
                    <div className="msd-bar-track msd-bar-track--all">
                      <div
                        className="msd-bar-fill msd-bar-fill--active"
                        style={{ width: `${p.maxBar > 0 ? (co.activeCards / p.maxBar) * 100 : 0}%` }}
                        title={`Active: ${co.activeCards.toLocaleString()}`}
                      />
                      <div
                        className="msd-bar-fill msd-bar-fill--new"
                        style={{ width: `${p.maxBar > 0 ? (co.newCards / p.maxBar) * 100 : 0}%` }}
                        title={`New: ${co.newCards.toLocaleString()}`}
                      />
                      <div
                        className="msd-bar-fill msd-bar-fill--unique"
                        style={{ width: `${p.maxBar > 0 ? (co.uniqueCards / p.maxBar) * 100 : 0}%` }}
                        title={`Unique: ${co.uniqueCards.toLocaleString()}`}
                      />
                    </div>
                    <div className="msd-bar-val msd-bar-val--all">
                      <span className="msd-bar-val-chip msd-bar-val-chip--active">{co.activeCards.toLocaleString()}</span>
                      <span className="msd-bar-val-chip msd-bar-val-chip--new">+{co.newCards.toLocaleString()}</span>
                      <span className="msd-bar-val-chip msd-bar-val-chip--unique">{co.uniqueCards.toLocaleString()}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="msd-bar-track">
                      <div
                        className={`msd-bar-fill msd-bar-fill--${p.barFilter}`}
                        style={{ width: `${p.maxBar > 0 ? (co.displayValue / p.maxBar) * 100 : 0}%` }}
                      />
                    </div>
                    <div className="msd-bar-val">{co.displayValue.toLocaleString()}</div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="msd-right-col">
        <div className="msd-chart-block">
          <div className="msd-chart-header">
            <div>
              <span className="msd-chart-title">Card Activity</span>
              <span className="msd-chart-sub">
                {p.activityRange === 'recent'
                  ? `${cycleLabel}${len ? ` · ${len} day${len === 1 ? '' : 's'} with activity` : ''}`
                  : `${len} ${len === 1 ? 'day' : 'days'}`}
              </span>
            </div>
            <div className="msd-activity-controls">
              <div className="msd-range-toggle">
                <button
                  type="button"
                  className={`msd-range-btn${p.activityRange === 'recent' ? ' msd-range-btn--on' : ''}`}
                  onClick={() => {
                    p.setActivityRange('recent');
                    p.clearSelection();
                  }}
                >
                  Cycle
                </button>
                <button
                  type="button"
                  className={`msd-range-btn${p.activityRange === 'all' ? ' msd-range-btn--on' : ''}`}
                  onClick={() => {
                    p.setActivityRange('all');
                    p.clearSelection();
                  }}
                >
                  History
                </button>
              </div>
              <div className="msd-legend">
                <span className="msd-legend-item">
                  <span className="msd-legend-dot" style={{ background: '#be123c' }} />
                  Tx
                </span>
                <span className="msd-legend-item">
                  <span className="msd-legend-dot" style={{ background: '#374151' }} />
                  Active
                </span>
                <span className="msd-legend-item">
                  <span className="msd-legend-dot" style={{ background: '#9ca3af' }} />
                  New
                </span>
              </div>
            </div>
          </div>

          {p.selectedDates ? (
            <div className="msd-status-ctx msd-status-ctx--selrange">
              Filtered to <strong>{p.selectionLabel ?? 'selected days'}</strong>
              <button type="button" className="msd-selrange-clear" onClick={p.clearSelection}>
                Clear filter
              </button>
            </div>
          ) : null}

          {len === 0 ? (
            <div className="msd-activity-empty">
              <strong>No activity in this cycle yet</strong>
              <span>
                {p.activityRange === 'recent' ? (
                  <button type="button" className="msd-selrange-clear" onClick={() => p.setActivityRange('all')}>
                    View History →
                  </button>
                ) : (
                  'Transactions will show up here as they happen.'
                )}
              </span>
            </div>
          ) : len === 1 && p.actPoints[0] ? (
            <div>
              <div className="msd-activity-single__grid">
                <div>
                  <div className="msd-activity-single__val" style={{ color: '#be123c' }}>
                    {msdFmtNum(p.actPoints[0].transactions)}
                  </div>
                  <div className="msd-activity-single__label">Transactions</div>
                </div>
                <div>
                  <div className="msd-activity-single__val">{msdFmtNum(p.actPoints[0].activeCards)}</div>
                  <div className="msd-activity-single__label">Active cards</div>
                </div>
                <div>
                  <div className="msd-activity-single__val">{msdFmtNum(p.actPoints[0].newCards)}</div>
                  <div className="msd-activity-single__label">New cards</div>
                </div>
                <div>
                  <div className="msd-activity-single__val" style={{ color: '#0284c7' }}>
                    {msdFmtNum(p.actPoints[0].volume)}
                  </div>
                  <div className="msd-activity-single__label">Gallons</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="msd-activity-scroller">
              <div
                className="msd-activity-wrap"
                style={{ width: chartW, minWidth: '100%' }}
                onMouseLeave={() => p.setHoverIdx(null)}
              >
                <svg
                  viewBox={`0 0 ${chartW} 90`}
                  className="msd-activity-svg"
                  preserveAspectRatio="none"
                >
                  <path d={msdAreaPath(txVals, maxTx, chartW)} fill="rgba(159,18,57,0.12)" stroke="none" />
                  <path d={msdLinePath(txVals, maxTx, chartW)} fill="none" stroke="#be123c" strokeWidth="2.5" />
                  <path d={msdLinePath(acVals, maxCards, chartW)} fill="none" stroke="#374151" strokeWidth="1.5" />
                  <path
                    d={msdLinePath(ncVals, maxCards, chartW)}
                    fill="none"
                    stroke="#9ca3af"
                    strokeWidth="1.5"
                    strokeDasharray="4,3"
                  />
                  {lo >= 0 && hi >= 0 ? (
                    <rect
                      x={msdSelBandX(lo, len, chartW)}
                      y={2}
                      width={msdSelBandW(lo, hi, len, chartW)}
                      height={86}
                      fill="rgba(244, 63, 94, 0.12)"
                      stroke="rgba(244, 63, 94, 0.45)"
                      strokeWidth={1}
                      strokeDasharray="4,3"
                      rx={3}
                      pointerEvents="none"
                    />
                  ) : null}
                  {p.actPoints.map((m, i) => {
                    const x = msdPointX(i, len, chartW);
                    return (
                      <g key={`${m.date}-${i}`}>
                        <circle
                          cx={x}
                          cy={msdPointY(m.activeCards, maxCards)}
                          r={p.hoverIdx === i ? 4.5 : 2.5}
                          fill="#374151"
                          opacity={p.hoverIdx != null && p.hoverIdx !== i ? 0.3 : 0.8}
                        />
                        <circle
                          cx={x}
                          cy={msdPointY(m.newCards, maxCards)}
                          r={p.hoverIdx === i ? 4.5 : 2.5}
                          fill="#9ca3af"
                          opacity={p.hoverIdx != null && p.hoverIdx !== i ? 0.3 : 0.8}
                        />
                        <circle
                          cx={x}
                          cy={msdPointY(m.transactions, maxTx)}
                          r={p.hoverIdx === i ? 5.5 : 3}
                          fill={p.hoverIdx === i ? '#f43f5e' : '#be123c'}
                          opacity={p.hoverIdx != null && p.hoverIdx !== i ? 0.4 : 1}
                        />
                        <rect
                          x={x - 20}
                          y={0}
                          width={40}
                          height={90}
                          fill="transparent"
                          style={{ cursor: 'pointer' }}
                          onMouseEnter={() => p.setHoverIdx(i)}
                          onClick={(e) => p.onActivityClick(i, e)}
                        />
                      </g>
                    );
                  })}
                </svg>
                <div className="msd-activity-vals">
                  {p.actPoints.map((m, i) => (
                    <span
                      key={`v-${m.date}`}
                      className="msd-activity-val"
                      style={{ left: msdColLeftPct(i, len, chartW) }}
                    >
                      {p.hoverIdx === i ? m.transactions.toLocaleString() : msdFmtK(m.transactions)}
                    </span>
                  ))}
                </div>
                <div className="msd-activity-cards">
                  {p.actPoints.map((m, i) => (
                    <span
                      key={`c-${m.date}`}
                      className="msd-activity-val msd-activity-val--cards"
                      style={{ left: msdColLeftPct(i, len, chartW) }}
                    >
                      {p.hoverIdx === i ? m.activeCards.toLocaleString() : msdFmtK(m.activeCards)}
                    </span>
                  ))}
                </div>
                <div className="msd-activity-new-cards">
                  {p.actPoints.map((m, i) => (
                    <span
                      key={`n-${m.date}`}
                      className="msd-activity-val msd-activity-val--new"
                      style={{ left: msdColLeftPct(i, len, chartW) }}
                    >
                      {p.hoverIdx === i ? m.newCards.toLocaleString() : msdFmtK(m.newCards)}
                    </span>
                  ))}
                </div>
                <div className="msd-activity-labels">
                  {p.actPoints.map((m, i) => (
                    <span
                      key={`l-${m.date}`}
                      className="msd-activity-label"
                      style={{ left: msdColLeftPct(i, len, chartW) }}
                    >
                      {m.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="msd-activity-tip">Tip: click a day to pin it. Hold Shift + click another day for a range.</div>
            </div>
          )}
        </div>
        {p.children}
      </div>
    </div>
  );
}
