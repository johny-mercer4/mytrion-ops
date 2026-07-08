import { useMemo } from 'react';

import { StatusBadge } from '@/components/mytrion/status-badge';
import { fmtCurrency } from './data';
import { SALES_DEBTORS, agingBuckets, debtorAgeTone } from './dashboardData';

const AGE_TEXT_CLASS: Record<ReturnType<typeof debtorAgeTone>, string> = {
  good: 'text-good',
  warn: 'text-warn',
  info: 'text-primary',
  bad: 'text-bad',
};

export function DashboardDebtors() {
  const total = useMemo(() => SALES_DEBTORS.reduce((s, d) => s + d.balance, 0), []);
  const hardCount = SALES_DEBTORS.filter((d) => d.hard).length;
  const buckets = useMemo(() => agingBuckets(), []);
  const bucketTotal = buckets.reduce((s, b) => s + b.amount, 0) || 1;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="rounded-xs border bg-card p-5">
        <div className="text-xs font-semibold text-muted-foreground">Total Outstanding</div>
        <div className="font-heading mt-1 text-3xl font-bold text-bad">{fmtCurrency(total)}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {SALES_DEBTORS.length} debtors · {hardCount} hard
        </div>
      </div>

      <div className="rounded-xs border bg-card p-5">
        <div className="font-heading mb-3 text-sm font-bold">Aging</div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
          {buckets.map((b) => (
            <div
              key={b.label}
              className={b.className}
              style={{ width: `${(b.amount / bucketTotal) * 100}%` }}
              title={`${b.label}: ${fmtCurrency(b.amount)}`}
            />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {buckets.map((b) => (
            <div key={b.label} className="flex items-center gap-2 text-xs">
              <span className={`size-2 flex-none rounded-full ${b.className}`} />
              <div className="min-w-0">
                <div className="truncate text-muted-foreground">{b.label}</div>
                <div className="font-mono font-bold">{fmtCurrency(b.amount)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xs border bg-card">
        <div className="min-w-140">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>Carrier</span>
            <span className="text-right">Balance</span>
            <span className="text-right">Age</span>
            <span>Last Contact</span>
          </div>
          {SALES_DEBTORS.map((d) => (
            <div key={d.id} className="grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{d.carrier}</span>
                {d.hard ? (
                  <span className="mt-0.5 inline-block">
                    <StatusBadge tone="bad">{d.days}d overdue</StatusBadge>
                  </span>
                ) : null}
              </span>
              <span className="text-right font-mono font-bold text-bad">{fmtCurrency(d.balance)}</span>
              <span className={`text-right font-mono font-semibold ${AGE_TEXT_CLASS[debtorAgeTone(d.days)]}`}>{d.days}d</span>
              <span className="text-muted-foreground">{d.lastContact}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
