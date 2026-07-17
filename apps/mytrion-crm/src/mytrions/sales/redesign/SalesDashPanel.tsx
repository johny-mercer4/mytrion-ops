/**
 * Agent Sales Dashboard — self-service Main Sales Dashboard parity:
 * hero KPIs, donuts + Inactive/Stuck filters, bar modes, activity Cycle/History
 * with day selection, searchable transaction table + totals.
 */
import { useEffect, useState, type MouseEvent } from 'react';
import { getImpersonation } from '@/api/impersonation';
import { s } from './dc';
import { formatCachedAt } from './dashCache';
import { currentBillingCycle, msdFmtNum, n } from './dashFormat';
import { DashSkeleton } from './DashSkeleton';
import {
  cycleTotals,
  filterActivity,
  filterCompanies,
  filterTransactions,
  loadSalesDashRaw,
  statusColor,
  txTotals,
  type ActivityRange,
  type BarFilter,
  type CompanyStatus,
  type SalesDashRaw,
} from './dashSalesData';

const NO_CARRIERS = /dim_company/i;
const CIRC = 2 * Math.PI * 42;

function donutDash(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  return `${((p / 100) * CIRC).toFixed(1)} ${CIRC.toFixed(1)}`;
}

function money(v: number): string {
  return `$${n(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function SalesDashPanel() {
  const actAsKey = getImpersonation()?.zohoUserId ?? 'self';
  const [data, setData] = useState<SalesDashRaw | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<CompanyStatus | null>(null);
  const [barFilter, setBarFilter] = useState<BarFilter>('active');
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
  const maxTx = Math.max(1, ...actPoints.map((p) => p.transactions));
  const chartW = Math.max(actPoints.length * 46, 480);

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

      {/* Hero — gallons from TX volume; Card Swipes = new_cards_cycle (widget parity) */}
      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
        <div style={s('padding:20px;border-radius:var(--radius-md);background:linear-gradient(120deg,color-mix(in srgb,var(--orange) 14%,transparent),var(--surface));border:1px solid var(--border)')}>
          <div style={s("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:28px")}>{msdFmtNum(hero.volume)}</div>
          <div style={s('font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-top:4px')}>
            Total Gallons · This Cycle
          </div>
        </div>
        <div style={s('padding:20px;border-radius:var(--radius-md);background:linear-gradient(120deg,color-mix(in srgb,var(--accent) 14%,transparent),var(--surface));border:1px solid var(--border)')}>
          <div style={s("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:28px")}>{msdFmtNum(kn('new_cards_cycle'))}</div>
          <div style={s('font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-top:4px')}>
            Card Swipes · This Cycle
          </div>
        </div>
      </div>

      {/* Top KPI row */}
      <div style={s('display:grid;grid-template-columns:1.25fr 1fr .85fr;gap:12px')}>
        <div style={s('padding:18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('display:flex;justify-content:space-around;gap:12px')}>
            {[
              {
                label: 'Active Companies',
                num: kn('active_companies'),
                pct: kn('active_companies_pct'),
                detail: `${kn('active_companies')} / ${kn('total_companies')}`,
                color: 'var(--ok)',
              },
              {
                label: 'Active Cards',
                num: kn('active_cards'),
                pct: kn('active_cards_pct'),
                detail: `${kn('active_cards')} / ${kn('total_cards')}`,
                color: 'var(--accent)',
              },
            ].map((d) => (
              <div key={d.label} style={s('text-align:center')}>
                <div style={s('position:relative;width:88px;height:88px;margin:0 auto')}>
                  <svg viewBox="0 0 100 100" style={s('width:88px;height:88px')}>
                    <circle cx="50" cy="50" r="42" fill="none" stroke="var(--raised)" strokeWidth="9" />
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      fill="none"
                      stroke={d.color}
                      strokeWidth="9"
                      strokeLinecap="round"
                      strokeDasharray={donutDash(d.pct)}
                      transform="rotate(-90 50 50)"
                    />
                  </svg>
                  <div style={s('position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center')}>
                    <div style={s("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:16px")}>{msdFmtNum(d.num)}</div>
                    <div style={s(`font-size:11px;font-weight:800;color:${d.color}`)}>{kt(d.label.includes('Companies') ? 'active_companies_pct' : 'active_cards_pct')}%</div>
                  </div>
                </div>
                <div style={s('font-size:11px;font-weight:700;margin-top:6px')}>{d.label}</div>
                <div style={s('font-size:10.5px;color:var(--muted)')}>{d.detail}</div>
              </div>
            ))}
          </div>
          <div style={s('display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border2)')}>
            <button
              type="button"
              onClick={() => toggleStatus('inactive')}
              style={s(
                `display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:99px;border:1px solid ${statusFilter === 'inactive' ? 'var(--orange)' : 'var(--border)'};background:${statusFilter === 'inactive' ? 'color-mix(in srgb,var(--orange) 14%,transparent)' : 'transparent'};color:var(--orange);font-size:11.5px;font-weight:800;cursor:pointer`,
              )}
              title="Filter bar chart to inactive companies"
            >
              {kn('inactive_companies')} Inactive
            </button>
            <button
              type="button"
              onClick={() => toggleStatus('stuck')}
              style={s(
                `display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:99px;border:1px solid ${statusFilter === 'stuck' ? 'var(--danger)' : 'var(--border)'};background:${statusFilter === 'stuck' ? 'color-mix(in srgb,var(--danger) 14%,transparent)' : 'transparent'};color:var(--danger);font-size:11.5px;font-weight:800;cursor:pointer`,
              )}
              title="Filter bar chart to stuck companies"
            >
              {kn('stuck_companies')} Stuck
            </button>
            <span style={s('margin-left:auto;font-size:10.5px;color:var(--faint)')}>↓ Click to filter bar chart</span>
          </div>
        </div>

        <div style={s('padding:18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);display:flex;flex-direction:column;gap:14px')}>
          <div>
            <div style={s('font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)')}>
              Cards Used This Cycle
            </div>
            <div style={s("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:26px;margin-top:4px")}>
              {msdFmtNum(kn('unique_cards_used'))}
            </div>
            <div style={s('height:7px;border-radius:99px;background:var(--raised);margin-top:8px;overflow:hidden')}>
              <div style={s(`height:100%;width:${Math.min(utilPct, 100)}%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2))`)} />
            </div>
            <div style={s('font-size:11px;color:var(--muted);margin-top:5px')}>
              <strong style={s('color:var(--accent)')}>{kt('total_cards_pct')}%</strong> of active cards utilized
            </div>
          </div>
          <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
            <div>
              <div style={s("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:20px;color:var(--accent)")}>
                {kt('cards_per_company') || '0'}
              </div>
              <div style={s('font-size:10.5px;color:var(--muted);font-weight:700')}>Cards / Company</div>
            </div>
            <div>
              <div style={s("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:20px;color:var(--accent)")}>
                {kt('transactions_per_card') || '0'}
              </div>
              <div style={s('font-size:10.5px;color:var(--muted);font-weight:700')}>Tx / Card</div>
            </div>
          </div>
        </div>

        <div style={s('padding:18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);display:flex;flex-direction:column;justify-content:center;gap:14px')}>
          <div>
            <div style={s('font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)')}>
              New Cards This Cycle
            </div>
            <div style={s("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:24px;color:var(--ok);margin-top:3px")}>
              {msdFmtNum(kn('new_cards_cycle'))}
            </div>
            <div style={s('font-size:11px;color:var(--faint);margin-top:2px')}>{cycleLabel}</div>
          </div>
          <div style={s('height:1px;background:var(--border)')} />
          <div>
            <div style={s('font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)')}>
              Last 7 Days
            </div>
            <div style={s("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:24px;color:var(--ok);margin-top:3px")}>
              {msdFmtNum(kn('new_cards_7d'))}
            </div>
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div style={s('display:grid;grid-template-columns:1fr 1.1fr;gap:12px')}>
        <div style={s('padding:18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:12px')}>
            <div>
              <div style={s('font-size:13px;font-weight:800')}>Cards by Company</div>
              <div style={s('font-size:11px;color:var(--muted)')}>
                {statusFilter ? (
                  <>
                    Showing {statusFilter}{' '}
                    <button type="button" onClick={() => setStatusFilter(null)} style={s('border:none;background:transparent;color:var(--accent);font-weight:800;cursor:pointer')}>
                      ✕
                    </button>
                  </>
                ) : (
                  `${bars.length} companies`
                )}
              </div>
            </div>
            <div style={s('display:flex;gap:4px;flex-wrap:wrap')}>
              {([
                ['all', 'All'],
                ['active', 'Active'],
                ['new', 'New'],
                ['unique', 'Unique'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setBarFilter(id)}
                  style={s(
                    `padding:5px 9px;border-radius:99px;border:1px solid ${barFilter === id ? 'var(--accent)' : 'var(--border)'};background:${barFilter === id ? 'color-mix(in srgb,var(--accent) 12%,transparent)' : 'transparent'};color:${barFilter === id ? 'var(--accent)' : 'var(--muted)'};font-size:10.5px;font-weight:800;cursor:pointer`,
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <input
            value={companyQ}
            onChange={(e) => setCompanyQ(e.currentTarget.value)}
            placeholder="Search company or carrier id…"
            className="ss-in"
            style={s(
              'width:100%;height:34px;padding:0 12px;margin-bottom:12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);font-size:12.5px',
            )}
          />
          <div style={s('display:flex;flex-direction:column;gap:10px;max-height:340px;overflow:auto')}>
            {bars.length === 0 ? (
              <div style={s('padding:24px;text-align:center;color:var(--muted);font-size:12.5px')}>
                {selectedDates && !data.dailyByCarrier.length
                  ? 'Day drilldown needs daily carrier data — open Automations → Transactions Report for a date range.'
                  : 'No companies match the current filters.'}
              </div>
            ) : (
              bars.map((b) => (
                <div key={b.carrierId || b.name} style={s('display:flex;align-items:center;gap:8px')}>
                  <span style={s(`width:8px;height:8px;border-radius:50%;background:${statusColor(b.status)};flex-shrink:0`)} />
                  <span style={s('width:120px;font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0')} title={b.name}>
                    {b.name}
                  </span>
                  {barFilter === 'all' ? (
                    <div style={s('flex:1;display:flex;flex-direction:column;gap:3px')}>
                      {[
                        { v: b.activeCards, c: 'var(--ok)' },
                        { v: b.newCards, c: 'var(--accent)' },
                        { v: b.uniqueCards, c: 'var(--violet)' },
                      ].map((row, i) => (
                        <div key={i} style={s('display:flex;align-items:center;gap:6px')}>
                          <div style={s('flex:1;height:5px;border-radius:99px;background:var(--raised);overflow:hidden')}>
                            <div style={s(`height:100%;width:${Math.round((row.v / maxBar) * 100)}%;background:${row.c}`)} />
                          </div>
                          <span style={s("width:28px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:10px")}>{row.v}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <div style={s('flex:1;height:9px;border-radius:99px;background:var(--raised);overflow:hidden')}>
                        <div
                          style={s(
                            `height:100%;width:${Math.round((b.displayValue / maxBar) * 100)}%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2))`,
                          )}
                        />
                      </div>
                      <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;width:32px;text-align:right")}>
                        {b.displayValue.toLocaleString()}
                      </span>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div style={s('padding:18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap')}>
            <div>
              <div style={s('font-size:13px;font-weight:800')}>Card Activity</div>
              <div style={s('font-size:11px;color:var(--muted)')}>
                {activityRange === 'recent' ? currentBillingCycle().label : 'Full history'} · click a day to filter
              </div>
            </div>
            <div style={s('display:flex;gap:4px')}>
              {([
                ['recent', 'Cycle'],
                ['all', 'History'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setActivityRange(id);
                    clearSelection();
                  }}
                  style={s(
                    `padding:5px 10px;border-radius:99px;border:1px solid ${activityRange === id ? 'var(--accent)' : 'var(--border)'};background:${activityRange === id ? 'color-mix(in srgb,var(--accent) 12%,transparent)' : 'transparent'};color:${activityRange === id ? 'var(--accent)' : 'var(--muted)'};font-size:11px;font-weight:800;cursor:pointer`,
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {selectedDates && (
            <div style={s('margin-bottom:8px')}>
              <button type="button" onClick={clearSelection} style={s('padding:4px 10px;border-radius:99px;border:1px solid var(--border);background:var(--alt);font-size:11px;font-weight:700;cursor:pointer;color:var(--muted)')}>
                Clear day filter ({[...selectedDates].join(' → ')})
              </button>
            </div>
          )}
          {actPoints.length === 0 ? (
            <div style={s('padding:40px 12px;text-align:center;color:var(--muted);font-size:12.5px')}>
              No activity in this cycle yet. Switch to History to see prior periods.
            </div>
          ) : (
            <div style={s('overflow-x:auto')}>
              <svg
                viewBox={`0 0 ${chartW} 110`}
                style={s(`width:${chartW}px;height:140px;display:block`)}
                onMouseLeave={() => setHoverIdx(null)}
              >
                {actPoints.map((p, i) => {
                  const x = (i / Math.max(actPoints.length - 1, 1)) * (chartW - 24) + 12;
                  const y = 100 - (p.transactions / maxTx) * 85;
                  const lo = selStart != null && selEnd != null ? Math.min(selStart, selEnd) : -1;
                  const hi = selStart != null && selEnd != null ? Math.max(selStart, selEnd) : -1;
                  const on = i >= lo && i <= hi;
                  return (
                    <g key={`${p.date}-${i}`} style={{ cursor: 'pointer' }} onClick={(e) => onActivityClick(i, e)} onMouseEnter={() => setHoverIdx(i)}>
                      {on && <rect x={x - 10} y={8} width={20} height={92} fill="color-mix(in srgb, var(--accent) 14%, transparent)" rx={4} />}
                      <circle cx={x} cy={y} r={hoverIdx === i || on ? 4.5 : 3} fill="var(--accent)" />
                      <line x1={x} y1={8} x2={x} y2={100} stroke="transparent" strokeWidth={18} />
                    </g>
                  );
                })}
                <polyline
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  points={actPoints
                    .map((p, i) => {
                      const x = (i / Math.max(actPoints.length - 1, 1)) * (chartW - 24) + 12;
                      const y = 100 - (p.transactions / maxTx) * 85;
                      return `${x},${y}`;
                    })
                    .join(' ')}
                />
              </svg>
              {hoverIdx != null && actPoints[hoverIdx] && (
                <div style={s('font-size:11.5px;color:var(--muted);margin-top:4px')}>
                  <strong style={s('color:var(--text)')}>{actPoints[hoverIdx].label}</strong>
                  {' · '}
                  {actPoints[hoverIdx].transactions.toLocaleString()} tx ·{' '}
                  {actPoints[hoverIdx].activeCards.toLocaleString()} active ·{' '}
                  {actPoints[hoverIdx].newCards.toLocaleString()} new
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Transaction table */}
      <div style={s('padding:18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)')}>
        <div style={s('display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap')}>
          <div style={s('font-size:13px;font-weight:800')}>Transaction Details</div>
          <input
            value={txQ}
            onChange={(e) => setTxQ(e.currentTarget.value)}
            placeholder="Filter by carrier…"
            className="ss-in"
            style={s(
              'width:220px;height:34px;padding:0 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);font-size:12.5px',
            )}
          />
        </div>
        <div style={s('border-radius:var(--radius-md);border:1px solid var(--border);overflow:auto')}>
          <div
            style={s(
              'display:grid;grid-template-columns:1.5fr .7fr .7fr .9fr .8fr .9fr;gap:8px;padding:11px 14px;background:var(--alt);font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);min-width:640px',
            )}
          >
            <span>Carrier</span>
            <span style={s('text-align:right')}>New Cards</span>
            <span style={s('text-align:right')}>Txns</span>
            <span style={s('text-align:right')}>Gallons</span>
            <span style={s('text-align:right')}>Discount</span>
            <span style={s('text-align:right')}>Total</span>
          </div>
          {txRows.length === 0 ? (
            <div style={s('padding:26px 14px;text-align:center;color:var(--muted);font-size:12.5px')}>
              {selectedDates && !data.dailyByCarrier.length
                ? 'No daily carrier breakdown for the selected day — try Automations → Transactions Report.'
                : 'No transactions match.'}
            </div>
          ) : (
            txRows.map((r) => (
              <div
                key={`${r.carrierId}-${r.name}`}
                style={s(
                  'display:grid;grid-template-columns:1.5fr .7fr .7fr .9fr .8fr .9fr;gap:8px;padding:11px 14px;border-top:1px solid var(--border2);font-size:12.5px;min-width:640px',
                )}
              >
                <span style={s('font-weight:600')}>{r.name}</span>
                <span style={s("text-align:right;font-family:'JetBrains Mono',monospace;color:var(--ok)")}>{r.newCards.toLocaleString()}</span>
                <span style={s("text-align:right;font-family:'JetBrains Mono',monospace")}>{r.transactions.toLocaleString()}</span>
                <span style={s("text-align:right;font-family:'JetBrains Mono',monospace;color:var(--violet)")}>{r.volume.toLocaleString()}</span>
                <span style={s("text-align:right;font-family:'JetBrains Mono',monospace")}>{money(r.discount)}</span>
                <span style={s("text-align:right;font-family:'JetBrains Mono',monospace;font-weight:700")}>{money(r.total)}</span>
              </div>
            ))
          )}
          {totals && (
            <div
              style={s(
                'display:grid;grid-template-columns:1.5fr .7fr .7fr .9fr .8fr .9fr;gap:8px;padding:11px 14px;border-top:2px solid var(--border);background:var(--alt);font-size:12.5px;font-weight:700;min-width:640px',
              )}
            >
              <span>Total</span>
              <span style={s("text-align:right;font-family:'JetBrains Mono',monospace")}>{totals.newCards.toLocaleString()}</span>
              <span style={s("text-align:right;font-family:'JetBrains Mono',monospace")}>{totals.transactions.toLocaleString()}</span>
              <span style={s("text-align:right;font-family:'JetBrains Mono',monospace")}>{totals.volume.toLocaleString()}</span>
              <span style={s("text-align:right;font-family:'JetBrains Mono',monospace")}>{money(totals.discount)}</span>
              <span style={s("text-align:right;font-family:'JetBrains Mono',monospace")}>{money(totals.total)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
