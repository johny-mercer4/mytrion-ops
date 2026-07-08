import { useMemo } from 'react';
import { CalendarClock, CheckCircle2, Clock3, TriangleAlert } from 'lucide-react';

import { StatCard } from '@/components/mytrion/stat-card';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { fmtCurrency } from './data';
import { SALES_INVOICES, invoiceStatusTone } from './dashboardData';

export function DashboardInvoices() {
  const { outstanding, overdue, paid } = useMemo(() => {
    const outstandingRows = SALES_INVOICES.filter((i) => i.status === 'pending' || i.status === 'overdue');
    const overdueRows = SALES_INVOICES.filter((i) => i.status === 'overdue');
    const paidRows = SALES_INVOICES.filter((i) => i.status === 'paid');
    return {
      outstanding: { amount: outstandingRows.reduce((s, i) => s + i.amount, 0), count: outstandingRows.length },
      overdue: { amount: overdueRows.reduce((s, i) => s + i.amount, 0), count: overdueRows.length },
      paid: { amount: paidRows.reduce((s, i) => s + i.amount, 0), count: paidRows.length },
    };
  }, []);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={CalendarClock} value={fmtCurrency(outstanding.amount)} label={`Outstanding · ${outstanding.count} open`} tint="primary" />
        <StatCard icon={TriangleAlert} value={fmtCurrency(overdue.amount)} label={`Overdue · ${overdue.count}`} tint="bad" />
        <StatCard icon={CheckCircle2} value={fmtCurrency(paid.amount)} label={`Paid · cycle · ${paid.count}`} tint="good" />
        <StatCard icon={Clock3} value="11" label="Avg Days to Pay · last 30 days" tint="purple" />
      </div>

      <div className="overflow-x-auto rounded-xs border bg-card">
        <div className="min-w-160">
          <div className="grid grid-cols-[1fr_1.6fr_1.6fr_1fr_1fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>Invoice #</span>
            <span>Carrier</span>
            <span>Due Date</span>
            <span className="text-right">Amount</span>
            <span>Status</span>
          </div>
          {SALES_INVOICES.map((inv) => (
            <div key={inv.num} className="grid grid-cols-[1fr_1.6fr_1.6fr_1fr_1fr] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0">
              <span className="font-mono text-xs font-semibold">{inv.num}</span>
              <span className="truncate font-semibold">{inv.carrier}</span>
              <span>
                <span className="block">{inv.due}</span>
                <span
                  className={`block text-[10.5px] ${
                    inv.status === 'overdue' ? 'text-bad' : inv.status === 'paid' ? 'text-good' : 'text-muted-foreground'
                  }`}
                >
                  {inv.status === 'overdue' ? `${inv.days} days late` : inv.status === 'paid' ? 'Settled' : 'On track'}
                </span>
              </span>
              <span className="text-right font-mono font-semibold">{fmtCurrency(inv.amount)}</span>
              <span>
                <StatusBadge tone={invoiceStatusTone(inv.status)}>{inv.status}</StatusBadge>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
