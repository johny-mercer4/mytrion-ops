/**
 * Debtors dashboard — agent book of overdue clients (Billing rules, CMP live).
 * Search · status chips · KPI strip · expandable invoice cards.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getImpersonation } from '@/api/impersonation';
import { formatCachedAt } from './dashCache';
import { s } from './dc';
import { DebtorsSkeleton } from './DashSkeleton';
import { useSales } from './ctx';
import {
  DEBT_MIN_DAYS,
  HARD_DEBT_DAYS,
  debtorsSummary,
  filterDebtors,
  loadDebtorsRaw,
  type DebtorCard,
  type DebtorStatusFilter,
  type DebtorsRaw,
} from './dashDebtorsData';
import { dbtFormatDate, dbtFormatMoney, dbtFormatPeriod, dbtFormatStatus } from './dashFormat';

function statusTone(status: string): string {
  const x = status.toLowerCase();
  if (x === 'pending') return 'var(--orange)';
  if (x === 'partially_paid' || x === 'partial') return 'var(--accent)';
  if (x === 'rejected') return 'var(--danger)';
  return 'var(--muted)';
}

const STATUS_CHIPS: Array<{ id: DebtorStatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'partial', label: 'Partial' },
  { id: 'hard', label: 'Hard 15d+' },
];

function DebtorRow({
  debtor,
  open,
  onToggle,
  index,
}: {
  debtor: DebtorCard;
  open: boolean;
  onToggle: () => void;
  index: number;
}): ReactNode {
  const title = debtor.companyName || debtor.dealName || '—';
  return (
    <div
      className="ss-card-h ss-fu"
      style={{
        ...s(
          `padding:16px 18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid ${
            debtor.isHardDebtor
              ? 'color-mix(in srgb,var(--danger) 35%,var(--border))'
              : 'var(--border)'
          };box-shadow:var(--shadow-sm);cursor:default`,
        ),
        animationDelay: `${Math.min(index, 8) * 40}ms`,
      }}
    >
      <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:16px')}>
        <div style={s('min-width:0;flex:1')}>
          <div style={s('font-size:15.5px;font-weight:700')}>{title}</div>
          <div style={s('display:flex;flex-wrap:wrap;gap:8px;margin-top:5px;font-size:12px;color:var(--muted)')}>
            {debtor.companyName && debtor.dealName && debtor.companyName !== debtor.dealName ? (
              <span>{debtor.dealName}</span>
            ) : null}
            {debtor.carrierId ? (
              <span style={s("font-family:'JetBrains Mono',monospace")}>ID #{debtor.carrierId}</span>
            ) : null}
            {debtor.stage ? <span>{debtor.stage}</span> : null}
          </div>
          <div style={s('display:flex;flex-wrap:wrap;gap:6px;margin-top:8px')}>
            {debtor.isHardDebtor ? (
              <span
                style={s(
                  'display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:99px;background:color-mix(in srgb,var(--danger) 14%,transparent);color:var(--danger);font-size:11px;font-weight:800',
                )}
              >
                Hard · {debtor.maxDebtDays}d
              </span>
            ) : debtor.maxDebtDays > 0 ? (
              <span
                style={s(
                  'padding:3px 8px;border-radius:99px;background:var(--raised);color:var(--muted);font-size:11px;font-weight:700',
                )}
              >
                {debtor.maxDebtDays}d overdue
              </span>
            ) : null}
            <span
              style={s(
                `padding:3px 8px;border-radius:99px;background:color-mix(in srgb,${statusTone(debtor.worstStatus)} 14%,transparent);color:${statusTone(debtor.worstStatus)};font-size:11px;font-weight:700`,
              )}
            >
              {dbtFormatStatus(debtor.worstStatus)}
            </span>
          </div>
        </div>
        <div style={s('text-align:right;flex-shrink:0')}>
          <div
            style={s(
              `font-family:'JetBrains Mono',monospace;font-weight:700;font-size:22px;color:${debtor.isHardDebtor ? 'var(--danger)' : 'var(--text)'}`,
            )}
          >
            {dbtFormatMoney(debtor.totalRemaining)}
          </div>
          <div style={s('font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-top:2px')}>
            Owed today
          </div>
          <div style={s('font-size:11px;color:var(--faint);margin-top:4px')}>
            {dbtFormatMoney(debtor.totalPaid)} paid · {dbtFormatMoney(debtor.totalOwed)} total
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={s(
          'margin-top:14px;width:100%;display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border2);background:var(--alt);color:var(--text2);font-size:13px;font-weight:700;cursor:pointer;transition:background .14s,border-color .14s',
        )}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent) 40%, var(--border2))';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border2)';
        }}
      >
        <span>
          {open ? 'Hide' : 'Show'} {debtor.invoiceCount} invoice
          {debtor.invoiceCount === 1 ? '' : 's'}
        </span>
        <span style={s(`transition:transform .18s cubic-bezier(.2,0,0,1);transform:rotate(${open ? 180 : 0}deg);display:inline-block`)}>
          ▾
        </span>
      </button>

      {open ? (
        <div
          style={s(
            'margin-top:8px;display:flex;flex-direction:column;gap:6px;animation:ss-fadein .22s cubic-bezier(.2,0,0,1) both',
          )}
        >
          {debtor.invoices.map((inv) => (
            <div
              key={inv.invoiceId || `${inv.createDate}-${inv.remaining}`}
              className="ss-card-h"
              style={s(
                'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border2);background:var(--surface);flex-wrap:wrap',
              )}
            >
              <div style={s('display:flex;flex-direction:column;gap:2px;min-width:0')}>
                <span style={s("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px")}>
                  #{inv.invoiceId || '—'}
                </span>
                <span style={s('font-size:12px;color:var(--muted)')}>
                  {dbtFormatPeriod(inv.dateFrom, inv.dateTo)}
                </span>
                <span style={s('font-size:11px;color:var(--faint)')}>
                  Created {dbtFormatDate(inv.createDate)}
                </span>
              </div>
              <div style={s('display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end')}>
                {inv.debtDays > 0 ? (
                  <span
                    style={s(
                      `font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:800;color:${inv.debtDays >= HARD_DEBT_DAYS ? 'var(--danger)' : 'var(--orange)'}`,
                    )}
                  >
                    {inv.debtDays}d
                  </span>
                ) : null}
                <span
                  style={s(
                    `padding:2px 7px;border-radius:99px;font-size:11px;font-weight:700;color:${statusTone(inv.status)};background:color-mix(in srgb,${statusTone(inv.status)} 12%,transparent)`,
                  )}
                >
                  {dbtFormatStatus(inv.status)}
                </span>
                <span style={s("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px")}>
                  {dbtFormatMoney(inv.remaining)}
                </span>
                <span style={s('font-size:11px;color:var(--faint)')}>of {dbtFormatMoney(inv.total)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DebtorsDashPanel() {
  const actAsKey = getImpersonation()?.zohoUserId ?? 'self';
  const { pushToast } = useSales();
  const [data, setData] = useState<DebtorsRaw | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<DebtorStatusFilter>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const fetch = async (force: boolean): Promise<void> => {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await loadDebtorsRaw({ force }));
      if (force) pushToast('Debtors refreshed', 'Latest overdue balances loaded.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load debtors.';
      setError(msg);
      if (force) pushToast("Couldn't refresh", msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setExpanded({});
    void fetch(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actAsKey]);

  const baseList = useMemo(
    () => (data ? filterDebtors(data.debtors, '', 'all') : []),
    [data],
  );
  const visible = useMemo(
    () => (data ? filterDebtors(data.debtors, search, status) : []),
    [data, search, status],
  );
  const summary = useMemo(() => debtorsSummary(baseList), [baseList]);
  const cachedLabel = data?.cachedAt ? formatCachedAt(new Date(data.cachedAt)) : '';

  if (loading && !data) return <DebtorsSkeleton />;
  if (error && !data) {
    return (
      <div style={s('text-align:center;padding:56px 20px;color:var(--danger);font-size:13px')}>
        {error}
        <div style={s('margin-top:12px')}>
          <button
            type="button"
            onClick={() => void fetch(true)}
            style={s(
              'padding:8px 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);font-weight:700;cursor:pointer',
            )}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="ss-fu" style={s('display:flex;flex-direction:column;gap:14px')}>
      <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap')}>
        <div>
          <div style={s('font-size:15px;font-weight:800')}>Your debtors</div>
          <div style={s('font-size:12px;color:var(--muted);margin-top:2px')}>
            Pending / partial invoices · {DEBT_MIN_DAYS}+ days overdue · Hard at {HARD_DEBT_DAYS}d
            {cachedLabel ? (
              <span style={s('margin-left:8px;color:var(--faint)')}>
                · {data.fromCache ? 'Cached' : 'Updated'} {cachedLabel} ET
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void fetch(true)}
          disabled={refreshing}
          style={s(
            `height:34px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);font-weight:700;font-size:12px;cursor:${refreshing ? 'wait' : 'pointer'};color:var(--text2);opacity:${refreshing ? 0.7 : 1};transition:opacity .14s,border-color .14s`,
          )}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div style={s('display:flex;flex-wrap:wrap;align-items:center;gap:8px')}>
        <div style={s('position:relative;flex:1;min-width:220px')}>
          <input
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Search carrier ID, company, deal, or stage…"
            className="ss-in"
            aria-label="Search debtors"
            style={s(
              'width:100%;height:38px;padding:0 36px 0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px',
            )}
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              style={s(
                'position:absolute;right:8px;top:50%;transform:translateY(-50%);border:none;background:transparent;color:var(--muted);cursor:pointer;font-weight:700',
              )}
            >
              ✕
            </button>
          ) : null}
        </div>
        <div
          role="group"
          aria-label="Debtor status filter"
          style={s('display:inline-flex;gap:4px;padding:4px;border-radius:99px;background:var(--alt);border:1px solid var(--border)')}
        >
          {STATUS_CHIPS.map((chip) => {
            const on = status === chip.id;
            const count =
              chip.id === 'all'
                ? summary.debtorCount
                : chip.id === 'pending'
                  ? summary.pendingCount
                  : chip.id === 'partial'
                    ? summary.partialCount
                    : summary.hardCount;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setStatus(chip.id)}
                style={s(
                  `display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 12px;border-radius:99px;border:1px solid ${
                    on
                      ? chip.id === 'hard'
                        ? 'var(--danger)'
                        : 'color-mix(in srgb,var(--accent) 45%,var(--border))'
                      : 'transparent'
                  };background:${
                    on
                      ? chip.id === 'hard'
                        ? 'color-mix(in srgb,var(--danger) 12%,transparent)'
                        : 'color-mix(in srgb,var(--accent) 12%,transparent)'
                      : 'transparent'
                  };color:${
                    on ? (chip.id === 'hard' ? 'var(--danger)' : 'var(--accent)') : 'var(--muted)'
                  };font-size:12px;font-weight:800;cursor:pointer;transition:background .14s,color .14s,border-color .14s`,
                )}
              >
                {chip.label}
                <span style={s("font-family:'JetBrains Mono',monospace;font-size:10.5px;opacity:.85")}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {baseList.length > 0 ? (
        <div
          className="ss-ret-metrics"
          style={s('padding:14px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)')}
        >
          {[
            { label: 'Outstanding', val: dbtFormatMoney(summary.totalRemaining), tone: 'is-danger' },
            { label: 'Debtors', val: String(summary.debtorCount), tone: '' },
            { label: 'Partial', val: String(summary.partialCount), tone: '' },
            { label: 'Hard 15d+', val: String(summary.hardCount), tone: 'is-danger' },
          ].map((c) => (
            <div key={c.label} className="ss-ret-metric ss-fu">
              <div className={`ss-ret-metric-val ${c.tone}`.trim()}>{c.val}</div>
              <div className="ss-ret-metric-lbl">{c.label}</div>
            </div>
          ))}
        </div>
      ) : null}

      {baseList.length === 0 ? (
        <div
          style={s(
            'text-align:center;padding:48px 20px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)',
          )}
        >
          <div style={s('font-size:14px;font-weight:700;color:var(--ok)')}>No outstanding balances</div>
          <div style={s('font-size:13px;margin-top:4px;color:var(--muted)')}>
            None of your clients have invoices {DEBT_MIN_DAYS}+ days overdue.
          </div>
        </div>
      ) : null}

      {baseList.length > 0 && visible.length === 0 ? (
        <div style={s('text-align:center;padding:40px 20px;color:var(--muted);font-size:13px')}>
          {search
            ? 'No debtors match this search.'
            : status === 'hard'
              ? 'No hard debtors right now — nothing 15+ days overdue.'
              : 'No debtors in this filter.'}
        </div>
      ) : null}

      <div style={s('display:flex;flex-direction:column;gap:10px')}>
        {visible.map((d, i) => (
          <DebtorRow
            key={d.id}
            debtor={d}
            index={i}
            open={!!expanded[d.id]}
            onToggle={() => setExpanded((prev) => ({ ...prev, [d.id]: !prev[d.id] }))}
          />
        ))}
      </div>

      {baseList.length > 0 ? (
        <div
          style={s(
            'display:flex;align-items:center;justify-content:center;gap:28px;padding:16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt)',
          )}
        >
          <div style={s('text-align:center')}>
            <div style={s("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:20px")}>
              {visible.length}
              {visible.length !== baseList.length ? (
                <span style={s('font-size:13px;color:var(--muted);font-weight:600')}> / {baseList.length}</span>
              ) : null}
            </div>
            <div style={s('font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)')}>
              Showing
            </div>
          </div>
          <div style={s('width:1px;height:36px;background:var(--border)')} />
          <div style={s('text-align:center')}>
            <div
              style={s(
                `font-family:'JetBrains Mono',monospace;font-weight:700;font-size:20px;color:${summary.largestDebt > 0 ? 'var(--danger)' : 'var(--text)'}`,
              )}
            >
              {dbtFormatMoney(summary.largestDebt)}
            </div>
            <div style={s('font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)')}>
              Largest debt
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
