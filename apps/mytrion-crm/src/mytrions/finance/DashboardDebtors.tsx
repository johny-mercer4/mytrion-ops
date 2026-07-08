import { useMemo, useState } from 'react';
import { AlertTriangle, FileWarning, Users, Wallet } from 'lucide-react';

import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatCard } from '@/components/mytrion/stat-card';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { DASHBOARD_DEBTORS, fmtCurrency } from './data';

const AGING_BUCKETS = [
  { id: '1-15', label: '1-15', min: 1, max: 15 },
  { id: '16-30', label: '16-30', min: 16, max: 30 },
  { id: '31-60', label: '31-60', min: 31, max: 60 },
  { id: '61-90', label: '61-90', min: 61, max: 90 },
  { id: '90+', label: '90+', min: 91, max: Infinity },
];

const BUCKET_COLOR = ['bg-good', 'bg-good/70', 'bg-warn', 'bg-warn/80', 'bg-bad'];

const MIN_AGE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: '30', label: '30+' },
  { id: '60', label: '60+' },
  { id: '90', label: '90+' },
];

const TERMS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'LOC', label: 'LOC' },
  { id: 'Prepay', label: 'Prepay' },
];

function initials(company: string): string {
  return company
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function DashboardDebtors() {
  const [metric, setMetric] = useState<'dollars' | 'invoices'>('dollars');
  const [minAge, setMinAge] = useState('all');
  const [terms, setTerms] = useState('all');

  const totalDebt = DASHBOARD_DEBTORS.reduce((s, d) => s + d.debt, 0);
  const avgDebt = totalDebt / DASHBOARD_DEBTORS.length;
  const maxOverdue = Math.max(...DASHBOARD_DEBTORS.map((d) => d.days));
  const overdueInvoices = DASHBOARD_DEBTORS.reduce((s, d) => s + d.inv, 0);

  const aging = useMemo(
    () =>
      AGING_BUCKETS.map((b) => {
        const rows = DASHBOARD_DEBTORS.filter((d) => d.days >= b.min && d.days <= b.max);
        return {
          ...b,
          dollars: rows.reduce((s, d) => s + d.debt, 0),
          invoices: rows.reduce((s, d) => s + d.inv, 0),
        };
      }),
    [],
  );
  const maxVal = Math.max(...aging.map((b) => (metric === 'dollars' ? b.dollars : b.invoices)), 1);

  const filtered = useMemo(() => {
    let rows = DASHBOARD_DEBTORS;
    if (minAge !== 'all') rows = rows.filter((d) => d.days >= Number(minAge));
    if (terms !== 'all') rows = rows.filter((d) => d.terms === terms);
    return [...rows].sort((a, b) => b.debt - a.debt);
  }, [minAge, terms]);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Users} value={String(DASHBOARD_DEBTORS.length)} label={`Avg ${fmtCurrency(avgDebt)} each`} tint="primary" />
        <StatCard icon={Wallet} value={fmtCurrency(totalDebt)} label="Total Debt" tint="bad" />
        <StatCard icon={AlertTriangle} value={`${maxOverdue}d`} label="Max Overdue" tint="warn" />
        <StatCard icon={FileWarning} value={String(overdueInvoices)} label="Overdue Invoices" tint="purple" />
      </div>

      <div className="rounded-xs border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-heading text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Accounts Receivable Aging
          </div>
          <SegmentedFilter
            options={[
              { id: 'dollars', label: '$ Dollars' },
              { id: 'invoices', label: '# Invoices' },
            ]}
            value={metric}
            onChange={(v) => setMetric(v as 'dollars' | 'invoices')}
          />
        </div>
        <div className="flex h-40 items-end gap-3">
          {aging.map((b, i) => {
            const val = metric === 'dollars' ? b.dollars : b.invoices;
            const height = Math.max((val / maxVal) * 100, val > 0 ? 4 : 0);
            return (
              <div key={b.id} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="text-[10.5px] font-bold">{metric === 'dollars' ? fmtCurrency(val) : val}</span>
                <div className="flex h-28 w-full items-end">
                  <div className={`w-full rounded-t-sm ${BUCKET_COLOR[i]}`} style={{ height: `${height}%` }} />
                </div>
                <span className="text-[10px] text-muted-foreground">{b.label}d</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedFilter options={MIN_AGE_FILTERS} value={minAge} onChange={setMinAge} />
        <SegmentedFilter options={TERMS_FILTERS} value={terms} onChange={setTerms} />
      </div>

      <div className="overflow-x-auto rounded-xs border bg-card">
        <div className="min-w-140">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2.5 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>Carrier</span>
            <span>Overdue</span>
            <span>Invoices</span>
            <span className="text-right">Debt</span>
          </div>
          {filtered.map((d) => (
            <div key={d.carrier} className="grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-2.5 border-b px-4 py-3 text-sm last:border-b-0">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-8 flex-none items-center justify-center rounded-full bg-primary/12 text-[11px] font-bold text-primary">
                  {initials(d.company)}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-semibold">{d.company}</span>
                    <StatusBadge tone={d.terms === 'LOC' ? 'info' : 'good'}>{d.terms}</StatusBadge>
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">#{d.carrier} · {d.agent}</div>
                </div>
              </div>
              <span>
                <StatusBadge tone={d.days >= 60 ? 'bad' : d.days >= 30 ? 'warn' : 'neutral'}>{d.days}d</StatusBadge>
              </span>
              <span className="font-mono text-muted-foreground">{d.inv}</span>
              <span className="text-right font-mono font-bold text-bad">{fmtCurrency(d.debt)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
