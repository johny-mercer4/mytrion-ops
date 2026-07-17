/**
 * Sales Mytrion — Dashboard shell.
 * Tabs: Sales · Company · Debtors (soon) · Cards — icons + lazy panels + cache-backed loaders.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { getImpersonation } from '@/api/impersonation';
import { timeParts } from '../salesData';
import { s } from '../dc';
import { numFmt } from '../live';
import { SalesDashPanel } from '../SalesDashPanel';
import { CompanyDashPanel } from '../CompanyDashPanel';
import { ComingSoonPanel, DashSkeleton } from '../DashSkeleton';
import { loadSalesDashRaw, type SalesDashRaw } from '../dashSalesData';

type DashId = 'sales' | 'company' | 'debtors' | 'cards';

const TAB_ICONS: Record<DashId, string> = {
  sales: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  company: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-7 4h12',
  debtors: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  cards: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
};

function TabIcon({ d }: { d: string }): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function CardsPanel() {
  const actAsKey = getImpersonation()?.zohoUserId ?? 'self';
  const [data, setData] = useState<SalesDashRaw | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    setLoading(true);
    setError(null);
    loadSalesDashRaw({ force: false })
      .then((d) => !off && setData(d))
      .catch((e: unknown) => !off && setError(e instanceof Error ? e.message : 'Failed'))
      .finally(() => !off && setLoading(false));
    return () => {
      off = true;
    };
  }, [actAsKey]);

  if (loading && !data) return <DashSkeleton rows={1} />;
  if (error && !data) {
    return <div style={s('text-align:center;padding:48px 20px;color:var(--danger);font-size:13px')}>{error}</div>;
  }
  if (!data) return null;

  const kn = (key: string): number => data.kpi[key] ?? 0;
  const total = kn('total_cards');
  const active = kn('active_cards');
  const inactive = Math.max(0, total - active);
  const used = kn('unique_cards_used');
  const pctOf = (x: number): string => (total > 0 ? `${Math.round((x / total) * 100)}%` : '0%');
  const cardBreak = [
    { label: 'Active', count: active, col: 'var(--ok)', pct: pctOf(active) },
    { label: 'Inactive', count: inactive, col: 'var(--muted)', pct: pctOf(inactive) },
    { label: 'Used · Cycle', count: used, col: 'var(--accent)', pct: pctOf(used) },
  ];
  return (
    <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:14px')}>
      {cardBreak.map((c) => (
        <div
          key={c.label}
          style={s(
            'padding:22px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm)',
          )}
        >
          <div style={s('display:flex;align-items:center;justify-content:space-between')}>
            <span style={s('font-size:12px;font-weight:700;color:var(--text2)')}>{c.label}</span>
            <span style={s(`width:10px;height:10px;border-radius:50%;background:${c.col}`)} />
          </div>
          <div style={s(`font-family:'JetBrains Mono',monospace;font-weight:600;font-size:32px;margin-top:10px;color:${c.col}`)}>
            {numFmt(c.count)}
          </div>
          <div style={s('height:7px;border-radius:99px;background:var(--raised);margin-top:12px;overflow:hidden')}>
            <div style={s(`height:100%;width:${c.pct};border-radius:99px;background:${c.col}`)} />
          </div>
          <div style={s('font-size:11px;color:var(--muted);margin-top:6px')}>{c.pct} of fleet</div>
        </div>
      ))}
    </div>
  );
}

export function DashTab() {
  const [dashSub, setDashSub] = useState<DashId>('sales');
  const todayDate = timeParts().dateLabel;

  const tabs: { id: DashId; label: string; soon?: boolean }[] = [
    { id: 'sales', label: 'Sales' },
    { id: 'company', label: 'Company' },
    { id: 'debtors', label: 'Debtors', soon: true },
    { id: 'cards', label: 'Cards' },
  ];

  return (
    <div className="ss-fu" style={s('max-width:1100px')}>
      <div style={s('margin-bottom:18px')}>
        <div
          style={s(
            'font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase',
          )}
        >
          Dashboard
        </div>
        <div style={s('font-size:12.5px;color:var(--muted);margin-top:2px')}>{todayDate}</div>
      </div>

      <div
        role="tablist"
        aria-label="Dashboard sections"
        style={s(
          'display:flex;gap:4px;margin-bottom:20px;padding:5px;border-radius:14px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm);overflow-x:auto',
        )}
      >
        {tabs.map((t) => {
          const on = dashSub === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setDashSub(t.id)}
              style={s(
                `display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;border:1px solid ${
                  on ? 'color-mix(in srgb,var(--accent) 45%,var(--border))' : 'transparent'
                };background:${on ? 'color-mix(in srgb,var(--accent) 12%,transparent)' : 'transparent'};color:${
                  on ? 'var(--accent)' : 'var(--muted)'
                };font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .14s,color .14s,border-color .14s`,
              )}
            >
              <span style={s(`opacity:${on ? 1 : 0.75};display:flex`)}>
                <TabIcon d={TAB_ICONS[t.id]} />
              </span>
              {t.label}
              {t.soon ? (
                <span
                  style={s(
                    'padding:2px 7px;border-radius:99px;background:color-mix(in srgb,var(--orange) 16%,transparent);color:var(--orange);font-size:9.5px;font-weight:800;letter-spacing:.03em;text-transform:uppercase',
                  )}
                >
                  Soon
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {dashSub === 'sales' && <SalesDashPanel />}
      {dashSub === 'company' && <CompanyDashPanel />}
      {dashSub === 'debtors' && (
        <ComingSoonPanel
          title="Debtors dashboard"
          blurb="Outstanding balances, hard-debtor filters, and invoice drilldowns are coming back here shortly — same power as the self-service Client Invoices view."
        />
      )}
      {dashSub === 'cards' && <CardsPanel />}
    </div>
  );
}
