/**
 * Agent Sales Dashboard — self-service Main Sales Dashboard parity:
 * hero KPIs with icons, crimson donuts + Inactive/Stuck filters,
 * teal new-cards card, Cards by Company / Card Activity charts, TX table.
 */
import { useEffect, useState, type MouseEvent } from 'react';
import { getImpersonation } from '@/api/impersonation';
import { s } from './dc';
import { Icon } from './icons';
import { formatCachedAt } from './dashCache';
import { currentBillingCycle, msdFmtNum } from './dashFormat';
import { DashSkeleton } from './DashSkeleton';
import { SalesDashCharts } from './SalesDashCharts';
import { ICO } from './salesData';
import {
  cycleTotals,
  filterActivity,
  filterCompanies,
  filterTransactions,
  loadSalesDashRaw,
  txTotals,
  type ActivityRange,
  type BarFilter,
  type CompanyStatus,
  type SalesDashRaw,
} from './dashSalesData';
import './msd.css';

const NO_CARRIERS = /dim_company/i;
const CIRC = 2 * Math.PI * 42;

function donutDash(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  return `${((p / 100) * CIRC).toFixed(1)} ${CIRC.toFixed(1)}`;
}

/** Volume cells — keep decimals when present (widget shows full gallons). */
function fmtVol(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function SalesDashPanel() {
  const actAsKey = getImpersonation()?.zohoUserId ?? 'self';
  const [data, setData] = useState<SalesDashRaw | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<CompanyStatus | null>(null);
  const [barFilter, setBarFilter] = useState<BarFilter>('all');
  const [companyQ, setCompanyQ] = useState('');
  const [txQ, setTxQ] = useState('');
  const [activityRange, setActivityRange] = useState<ActivityRange>('recent');
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [selAnchor, setSelAnchor] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const fetch = async (force: boolean): Promise<void> => {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await loadSalesDashRaw({ force }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sales data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetch(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actAsKey]);

  if (loading && !data) return <DashSkeleton />;
  if (error && !data) {
    if (NO_CARRIERS.test(error)) {
      return (
        <div style={s('text-align:center;padding:56px 20px;color:var(--muted);font-size:13px')}>
          No carriers assigned to your account yet.
        </div>
      );
    }
    return (
      <div style={s('text-align:center;padding:56px 20px;color:var(--danger);font-size:13px')}>
        {error}
        <div style={s('margin-top:12px')}>
          <button type="button" onClick={() => void fetch(true)} style={s('padding:8px 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);font-weight:700;cursor:pointer')}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!data) return null;
  const cachedAt = data.cachedAt ? new Date(data.cachedAt) : null;

  const kn = (key: string): number => data.kpi[key] ?? 0;
  const kt = (key: string): string => data.kpiText[key] || String(kn(key));
  const hero = cycleTotals(data.transactions);
  const cycleLabel =
    data.cycle.start !== '—' ? `${data.cycle.start} → ${data.cycle.end}` : currentBillingCycle().label;

  const actPoints = filterActivity(data.activity, activityRange);
  const selectedDates: Set<string> | null = (() => {
    if (selStart == null || selEnd == null || !actPoints.length) return null;
    const lo = Math.max(0, Math.min(selStart, selEnd));
    const hi = Math.min(actPoints.length - 1, Math.max(selStart, selEnd));
    const set = new Set<string>();
    for (let i = lo; i <= hi; i++) {
      const d = actPoints[i]?.date;
      if (d) set.add(d);
    }
    return set.size ? set : null;
  })();

  const selectionLabel =
    selectedDates && selStart != null && selEnd != null
      ? selStart === selEnd
        ? actPoints[selStart]?.label ?? null
        : `${actPoints[Math.min(selStart, selEnd)]?.label ?? ''} → ${actPoints[Math.max(selStart, selEnd)]?.label ?? ''}`
      : null;

  const bars = filterCompanies({
    companies: data.companies,
    statusFilter,
    barFilter,
    companyQ,
    selectedDates,
    dailyByCarrier: data.dailyByCarrier,
  });
  const maxBar =
    barFilter === 'all'
      ? Math.max(1, ...bars.map((c) => Math.max(c.activeCards, c.newCards, c.uniqueCards)))
      : Math.max(1, ...bars.map((c) => c.displayValue));

  const txRows = filterTransactions({
    transactions: data.transactions,
    txQ,
    selectedDates,
    dailyByCarrier: data.dailyByCarrier,
  });
  const totals = txTotals(txRows);

  const onActivityClick = (i: number, e: MouseEvent): void => {
    const shift = e.shiftKey || e.metaKey;
    if (shift && selAnchor != null) {
      setSelStart(selAnchor);
      setSelEnd(i);
      return;
    }
    if (selStart === i && selEnd === i) {
      setSelStart(null);
      setSelEnd(null);
      setSelAnchor(null);
      return;
    }
    setSelStart(i);
    setSelEnd(i);
    setSelAnchor(i);
  };

  const clearSelection = (): void => {
    setSelStart(null);
    setSelEnd(null);
    setSelAnchor(null);
  };

  const toggleStatus = (st: CompanyStatus): void => {
    setStatusFilter((cur) => (cur === st ? null : st));
  };

  const utilPct = kn('total_cards_pct');
  const inactiveShare =
    (kn('inactive_companies') + kn('stuck_companies')) / Math.max(kn('total_companies'), 1) * 100;

  return (
    <div style={s('display:flex;flex-direction:column;gap:16px')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap')}>
        <div>
          <div style={s('font-size:15px;font-weight:800')}>Sales Dashboard</div>
          <div style={s('font-size:12px;color:var(--muted);margin-top:2px')}>
            Cycle {cycleLabel}
            {cachedAt ? (
              <span style={s('margin-left:8px;color:var(--faint)')}>
                · {data.fromCache ? 'Cached' : 'Updated'} {formatCachedAt(cachedAt)} ET
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void fetch(true)}
          disabled={refreshing}
          title="Bypass 5-minute cache and reload from Zoho"
          style={s(
            'height:34px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);font-weight:700;font-size:12px;cursor:pointer;color:var(--text2);display:inline-flex;align-items:center;gap:7px',
          )}
        >
          {refreshing ? (
            <>
              <span style={s('width:12px;height:12px;border-radius:50%;border:2px solid var(--border);border-top-color:var(--accent);animation:ss-spin .7s linear infinite')} />
              Refreshing…
            </>
          ) : (
            'Refresh'
          )}
        </button>
      </div>

      <div className="msd-hero-kpi-strip">
        <div className="msd-hero-kpi msd-hero-kpi--gold">
          <div className="msd-hero-kpi-icon">
            <Icon name="fuel" size={20} />
          </div>
          <div className="msd-hero-kpi-body">
            <div className="msd-hero-kpi-value">{msdFmtNum(hero.volume)}</div>
            <div className="msd-hero-kpi-label">Total Gallons · This Cycle</div>
          </div>
        </div>
        <div className="msd-hero-kpi-sep" />
        <div className="msd-hero-kpi msd-hero-kpi--blue">
          <div className="msd-hero-kpi-icon">
            <Icon name="card" size={20} />
          </div>
          <div className="msd-hero-kpi-body">
            <div className="msd-hero-kpi-value">{msdFmtNum(kn('new_cards_cycle'))}</div>
            <div className="msd-hero-kpi-label">Card Swipes · This Cycle</div>
          </div>
        </div>
      </div>

      <div className="msd-top-row">
        <div className="msd-kpi-card msd-kpi-card--donuts">
          <div className="msd-donut-pair">
            <div className="msd-donut-group">
              <div className="msd-donut-wrap">
                <svg viewBox="0 0 100 100" className="msd-donut-svg">
                  <circle cx="50" cy="50" r="42" fill="none" strokeWidth="9" className="msd-donut-track" />
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    strokeWidth="9"
                    stroke="#f59e0b"
                    strokeDasharray={donutDash(inactiveShare)}
                    strokeLinecap="butt"
                    transform="rotate(-90,50,50)"
                    opacity={0.35}
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    strokeWidth="9"
                    stroke="#9f1239"
                    strokeDasharray={donutDash(kn('active_companies_pct'))}
                    strokeLinecap="round"
                    transform="rotate(-90,50,50)"
                  />
                </svg>
                <div className="msd-donut-inner">
                  <div className="msd-donut-num">{msdFmtNum(kn('active_companies'))}</div>
                  <div className="msd-donut-pct">{kt('active_companies_pct')}%</div>
                </div>
              </div>
              <div className="msd-donut-meta">
                <div className="msd-donut-title">
                  <Icon name={ICO.users} size={10} strokeWidth={2.5} />
                  Active Companies
                </div>
                <div className="msd-donut-detail">
                  {kn('active_companies')} / {kn('total_companies')}
                </div>
              </div>
            </div>

            <div className="msd-donut-divider" />

            <div className="msd-donut-group">
              <div className="msd-donut-wrap">
                <svg viewBox="0 0 100 100" className="msd-donut-svg">
                  <circle cx="50" cy="50" r="42" fill="none" strokeWidth="9" className="msd-donut-track" />
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    strokeWidth="9"
                    stroke="#9f1239"
                    strokeDasharray={donutDash(kn('active_cards_pct'))}
                    strokeLinecap="round"
                    transform="rotate(-90,50,50)"
                  />
                </svg>
                <div className="msd-donut-inner">
                  <div className="msd-donut-num">{msdFmtNum(kn('active_cards'))}</div>
                  <div className="msd-donut-pct">{kt('active_cards_pct')}%</div>
                </div>
              </div>
              <div className="msd-donut-meta">
                <div className="msd-donut-title">
                  <Icon name={ICO.card} size={10} strokeWidth={2.5} />
                  Active Cards
                </div>
                <div className="msd-donut-detail">
                  {kn('active_cards')} / {kn('total_cards')}
                </div>
              </div>
            </div>
          </div>

          <div className="msd-alert-strip">
            <button
              type="button"
              className={`msd-alert-btn msd-alert-btn--inactive${statusFilter === 'inactive' ? ' msd-alert-btn--on' : ''}`}
              onClick={() => toggleStatus('inactive')}
              title="Click to see inactive companies in the bar chart"
            >
              <Icon name="pause" size={13} />
              <span className="msd-alert-count">{kn('inactive_companies')}</span>
              <span className="msd-alert-lbl">Inactive</span>
              {statusFilter === 'inactive' ? <Icon name="close" size={10} strokeWidth={2.5} /> : null}
            </button>
            <div className="msd-alert-sep" />
            <button
              type="button"
              className={`msd-alert-btn msd-alert-btn--stuck${statusFilter === 'stuck' ? ' msd-alert-btn--on' : ''}`}
              onClick={() => toggleStatus('stuck')}
              title="Click to see stuck companies in the bar chart"
            >
              <Icon name={ICO.warn} size={13} />
              <span className="msd-alert-count">{kn('stuck_companies')}</span>
              <span className="msd-alert-lbl">Stuck</span>
              {statusFilter === 'stuck' ? <Icon name="close" size={10} strokeWidth={2.5} /> : null}
            </button>
            <div className="msd-alert-hint">↓ Click to filter bar chart</div>
          </div>
        </div>

        <div className="msd-kpi-card msd-kpi-card--metrics">
          <div className="msd-kpi-primary">
            <div className="msd-kpi-icon-row">
              <Icon name={ICO.card} size={15} color="#9f1239" strokeWidth={2} />
              <span className="msd-kpi-lbl">Cards Used This Cycle</span>
            </div>
            <div className="msd-kpi-big">{msdFmtNum(kn('unique_cards_used'))}</div>
            <div className="msd-kpi-util-bar">
              <div className="msd-kpi-util-fill" style={{ width: `${Math.min(utilPct, 100)}%` }} />
            </div>
            <div className="msd-kpi-util-label">
              <span className="msd-kpi-pct">{kt('total_cards_pct')}%</span>
              <span className="msd-kpi-sub">of active cards utilized</span>
            </div>
          </div>
          <div className="msd-kpi-pair">
            <div className="msd-kpi-item">
              <div className="msd-kpi-icon-row">
                <Icon name={ICO.lead} size={12} color="#0ea5e9" strokeWidth={2.5} />
              </div>
              <div className="msd-kpi-big msd-kpi-big--teal">{kt('cards_per_company') || '0'}</div>
              <div className="msd-kpi-lbl">Cards / Company</div>
            </div>
            <div className="msd-kpi-item">
              <div className="msd-kpi-icon-row">
                <Icon name="dollar" size={12} color="#0ea5e9" strokeWidth={2.5} />
              </div>
              <div className="msd-kpi-big msd-kpi-big--teal">{kt('transactions_per_card') || '0'}</div>
              <div className="msd-kpi-lbl">Tx / Card</div>
            </div>
          </div>
        </div>

        <div className="msd-kpi-card msd-kpi-card--newcards">
          <div className="msd-kpi-item">
            <div className="msd-kpi-icon-row">
              <Icon name="plus" size={14} color="#0ea5e9" strokeWidth={2.5} />
              <span className="msd-kpi-lbl">New Cards This Cycle</span>
            </div>
            <div className="msd-kpi-big msd-kpi-big--teal">{msdFmtNum(kn('new_cards_cycle'))}</div>
            <div className="msd-kpi-sub" style={{ marginTop: 2 }}>
              {cycleLabel}
            </div>
          </div>
          <div className="msd-kpi-item">
            <div className="msd-kpi-icon-row">
              <Icon name="calendar" size={14} color="#0ea5e9" strokeWidth={2.5} />
              <span className="msd-kpi-lbl">Last 7 Days</span>
            </div>
            <div className="msd-kpi-big msd-kpi-big--teal">{msdFmtNum(kn('new_cards_7d'))}</div>
          </div>
        </div>
      </div>

      <SalesDashCharts
        bars={bars}
        maxBar={maxBar}
        barFilter={barFilter}
        setBarFilter={setBarFilter}
        companyQ={companyQ}
        setCompanyQ={setCompanyQ}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        selectedDates={selectedDates}
        dailyByCarrier={data.dailyByCarrier}
        actPoints={actPoints}
        activityRange={activityRange}
        setActivityRange={setActivityRange}
        selStart={selStart}
        selEnd={selEnd}
        hoverIdx={hoverIdx}
        setHoverIdx={setHoverIdx}
        onActivityClick={onActivityClick}
        clearSelection={clearSelection}
        selectionLabel={selectionLabel}
      >
        <div className="msd-chart-block">
          <div className="msd-chart-header">
            <span className="msd-chart-title">Transaction Details</span>
            <input
              value={txQ}
              onChange={(e) => setTxQ(e.currentTarget.value)}
              placeholder="Filter by carrier…"
              className="msd-tx-filter"
            />
          </div>
          {selectedDates ? (
            <div className="msd-status-ctx msd-status-ctx--selrange">
              Showing <strong>{selectionLabel ?? 'selected days'}</strong>
              <button type="button" className="msd-selrange-clear" onClick={clearSelection}>
                Clear filter
              </button>
            </div>
          ) : null}
          <div className="msd-tx-wrap">
            <table className="msd-tx-table">
              <thead>
                <tr>
                  <th>Carrier</th>
                  <th className="msd-tx-r msd-tx-th--gold">New Cards</th>
                  <th className="msd-tx-r">Transactions</th>
                  <th className="msd-tx-r msd-tx-th--gold msd-tx-th--vol">Volume (Gallons)</th>
                  <th className="msd-tx-r">Discount</th>
                  <th className="msd-tx-r">Total</th>
                </tr>
              </thead>
              <tbody>
                {txRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="msd-tx-empty">
                      {selectedDates && !data.dailyByCarrier.length
                        ? 'Per-company data for the selected day(s) isn’t available yet — use Automations → Transactions Report for the daily breakdown.'
                        : selectedDates
                          ? 'No data for the selected day(s).'
                          : 'No data for this cycle'}
                    </td>
                  </tr>
                ) : (
                  txRows.map((r) => (
                    <tr key={`${r.carrierId}-${r.name}`}>
                      <td className="msd-tx-carrier" title={r.name}>
                        {r.name}
                      </td>
                      <td className="msd-tx-r msd-tx-gold">{r.newCards.toLocaleString()}</td>
                      <td className="msd-tx-r">{r.transactions.toLocaleString()}</td>
                      <td className="msd-tx-r msd-tx-vol">{fmtVol(r.volume)}</td>
                      <td className="msd-tx-r">{msdFmtNum(r.discount)}</td>
                      <td className="msd-tx-r">{msdFmtNum(r.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {totals && txRows.length > 0 ? (
                <tfoot>
                  <tr className="msd-tx-totals">
                    <td>
                      <strong>Total</strong>
                    </td>
                    <td className="msd-tx-r msd-tx-gold msd-tx-gold--total">
                      <strong>{totals.newCards.toLocaleString()}</strong>
                    </td>
                    <td className="msd-tx-r">
                      <strong>{totals.transactions.toLocaleString()}</strong>
                    </td>
                    <td className="msd-tx-r msd-tx-vol msd-tx-vol--total">
                      <strong>{fmtVol(totals.volume)}</strong>
                    </td>
                    <td className="msd-tx-r">
                      <strong>{msdFmtNum(totals.discount)}</strong>
                    </td>
                    <td className="msd-tx-r">
                      <strong>{msdFmtNum(totals.total)}</strong>
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>
      </SalesDashCharts>
    </div>
  );
}
