import { DASHBOARD_PAYMENTS, type PaymentSource, dateFull, fmtCurrency } from './data';

const SOURCE_COLOR: Record<PaymentSource, string> = {
  MX: 'bg-primary',
  Zelle: 'bg-purple-400',
  Chase: 'bg-blue-400',
  Stripe: 'bg-warn',
};

const SOURCES: PaymentSource[] = ['MX', 'Zelle', 'Chase', 'Stripe'];

export function DashboardPayments() {
  const sourceSummaries = SOURCES.map((src) => {
    const rows = DASHBOARD_PAYMENTS.filter((p) => p.src === src && p.st !== 'DECLINED');
    return { src, count: rows.length, total: rows.reduce((s, p) => s + p.amt, 0) };
  });

  const netSettled = DASHBOARD_PAYMENTS.filter((p) => p.st !== 'DECLINED').reduce((s, p) => s + p.amt, 0);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {sourceSummaries.map((s) => (
          <div key={s.src} className="flex items-center gap-3 rounded-xs border bg-card p-4 shadow-sm">
            <span className={`size-2.5 flex-none rounded-full ${SOURCE_COLOR[s.src]}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-heading text-sm font-bold">{s.src}</span>
                <span className="rounded-xs bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-secondary-foreground">{s.count}</span>
              </div>
              <div className="truncate font-mono text-sm text-good">{fmtCurrency(s.total)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xs border bg-card">
        <div className="min-w-140">
          <div className="grid grid-cols-[1fr_1fr_2fr_1fr_1fr] gap-2.5 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>Source</span>
            <span>Date</span>
            <span>Details</span>
            <span>Status</span>
            <span className="text-right">Amount</span>
          </div>
          {DASHBOARD_PAYMENTS.map((p, i) => {
            const declined = p.st === 'DECLINED';
            return (
              <div key={i} className="grid grid-cols-[1fr_1fr_2fr_1fr_1fr] items-center gap-2.5 border-b px-4 py-3 text-sm last:border-b-0">
                <span className="w-fit rounded-xs bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-extrabold tracking-wide text-secondary-foreground uppercase">
                  {p.src}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{dateFull(p.date)}</span>
                <span className="truncate text-xs">{p.det}</span>
                <span>
                  <span
                    className={`rounded-xs border px-2 py-0.5 text-[10px] font-semibold ${declined ? 'border-bad/30 bg-bad/10 text-bad' : 'border-good/30 bg-good/10 text-good'}`}
                  >
                    {p.st}
                  </span>
                </span>
                <span className={`text-right font-mono font-bold ${declined ? 'text-muted-foreground line-through' : 'text-good'}`}>
                  {fmtCurrency(p.amt)}
                </span>
              </div>
            );
          })}
          <div className="flex items-center justify-between border-t bg-muted/40 px-4 py-2.5 text-xs font-bold">
            <span className="text-muted-foreground uppercase">Net Settled</span>
            <span className="font-mono text-good">{fmtCurrency(netSettled)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
