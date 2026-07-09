import { useMemo, useState } from 'react';
import { CreditCard, Droplets, RotateCw } from 'lucide-react';

import { callTouchpoint } from '@/api/touchpoints';
import { StatCard } from '@/components/mytrion/stat-card';
import { Button } from '@/components/ui/button';
import { DonutRing } from './DonutRing';
import { money, num, useLoad } from './live';

// mytrionAgentSalesDashboard — cycle KPIs, cards-by-company bars, daily card activity,
// per-carrier transaction table (the widget's Sales dashboard, billing cycle 26th→25th).

const STATUS_BAR_CLASS: Record<string, string> = {
  active: 'bg-good',
  inactive: 'bg-warn',
  stuck: 'bg-bad',
};

interface CompanyBar {
  name: string;
  status: string;
  activeCards: number;
  transactions: number;
}

export function DashboardSales() {
  const load = useLoad(async () => {
    const res = await callTouchpoint('dashboard.agent_sales', {});
    if (res.success === false) throw new Error(res.error || 'Sales dashboard failed to load');
    return res.data ?? {};
  }, []);
  const [txFilter, setTxFilter] = useState('');

  const kpi = (load.data?.kpi ?? {}) as Record<string, unknown>;
  const kn = (key: string): number => Number(kpi[key] ?? 0) || 0;

  const bars: CompanyBar[] = useMemo(
    () =>
      (load.data?.cardsByCompany ?? []).map((r) => ({
        name: String(r.carrier_name ?? r.carrier_id ?? '—'),
        status: String(r.company_status ?? 'active').toLowerCase(),
        activeCards: Number(r.active_cards ?? 0) || 0,
        transactions: Number(r.transactions ?? 0) || 0,
      })),
    [load.data],
  );
  const maxCards = Math.max(...bars.map((b) => b.activeCards), 1);

  const activitySeries: number[] = useMemo(() => {
    const buckets = load.data?.dailyActivity ?? load.data?.cardActivity ?? [];
    return buckets.map((b) => Number((b as Record<string, unknown>).transactions ?? 0) || 0);
  }, [load.data]);

  const txRows = useMemo(() => {
    const rows = (load.data?.transactions ?? []).map((r) => ({
      carrier: String(r.carrier_name ?? '—'),
      newCards: Number(r.new_cards ?? 0) || 0,
      tx: Number(r.transactions ?? 0) || 0,
      volume: Number(r.volume ?? 0) || 0,
      discount: Number(r.discount ?? 0) || 0,
      total: Number(r.total ?? 0) || 0,
    }));
    const q = txFilter.trim().toLowerCase();
    return q ? rows.filter((r) => r.carrier.toLowerCase().includes(q)) : rows;
  }, [load.data, txFilter]);

  const txTotals = txRows.reduce(
    (acc, r) => ({
      newCards: acc.newCards + r.newCards,
      tx: acc.tx + r.tx,
      volume: acc.volume + r.volume,
      total: acc.total + r.total,
    }),
    { newCards: 0, tx: 0, volume: 0, total: 0 },
  );

  if (load.loading) {
    return <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">Loading sales dashboard…</div>;
  }
  if (load.error) {
    // Admins / agents with no carrier book: the upstream keys on the agent name in
    // dim_company — the widget shows this as "No carriers assigned", not an error.
    if (/not found in dim_company/i.test(load.error)) {
      return (
        <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
          No carriers are assigned to this agent yet — the sales dashboard lights up once the
          book has active carriers. (Admins: use the user switcher to view an agent.)
        </div>
      );
    }
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm">
        <p className="text-bad">{load.error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={load.reload}>
          Retry
        </Button>
      </div>
    );
  }

  const cycle = load.data?.cycle;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">
          {cycle?.start ? `Cycle ${cycle.start} → ${cycle.end ?? ''}` : 'Current billing cycle'}
        </span>
        <Button variant="ghost" size="sm" onClick={load.reload}>
          <RotateCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard icon={CreditCard} value={num(kn('new_cards_cycle'))} label="Card Swipes · This Cycle" tint="primary" />
        <StatCard icon={Droplets} value={num(kn('new_cards_7d'))} label="New Cards · Last 7 Days" tint="purple" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="flex items-center justify-around rounded-lg border bg-card p-5">
          <DonutRing
            pct={kn('active_companies_pct')}
            label="Active Companies"
            value={`${num(kn('active_companies'))} / ${num(kn('total_companies'))}`}
            sub={`of ${num(kn('total_companies'))}`}
            colorClass="text-good"
          />
          <DonutRing
            pct={kn('active_cards_pct')}
            label="Active Cards"
            value={`${num(kn('active_cards'))} / ${num(kn('total_cards'))}`}
            sub={`of ${num(kn('total_cards'))}`}
            colorClass="text-primary"
          />
        </div>

        <div className="flex flex-col justify-center rounded-lg border bg-card p-5">
          <div className="text-xs font-semibold text-muted-foreground">Card Utilization (unique cards used)</div>
          <div className="font-heading mt-1 text-3xl font-bold text-primary">{Math.round(kn('total_cards_pct'))}%</div>
          <div className="mt-3 h-2 w-full rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(kn('total_cards_pct'), 100)}%` }} />
          </div>
          <div className="mt-2 text-[10.5px] text-muted-foreground">
            {num(kn('unique_cards_used'))} unique cards · {kn('transactions_per_card').toFixed(1)} tx/card
          </div>
        </div>

        <div className="flex flex-col justify-center gap-2.5 rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Inactive companies</span>
            <span className="font-mono font-bold text-warn">{num(kn('inactive_companies'))}</span>
          </div>
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Stuck companies</span>
            <span className="font-mono font-bold text-bad">{num(kn('stuck_companies'))}</span>
          </div>
        </div>
      </div>

      {bars.length > 0 ? (
        <div className="rounded-lg border bg-card p-5">
          <div className="font-heading mb-3 text-sm font-bold">Cards by Company</div>
          <div className="flex max-h-72 flex-col gap-2.5 overflow-y-auto">
            {bars.map((row) => (
              <div key={row.name} className="flex items-center gap-3">
                <span className="w-40 flex-none truncate text-xs font-semibold">{row.name}</span>
                <div className="h-2 flex-1 rounded-full bg-muted">
                  <div
                    className={`h-2 rounded-full ${STATUS_BAR_CLASS[row.status] ?? 'bg-primary'}`}
                    style={{ width: `${(row.activeCards / maxCards) * 100}%` }}
                  />
                </div>
                <span className="w-8 flex-none text-right font-mono text-xs font-bold">{row.activeCards}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activitySeries.length > 1 ? <ActivityChart series={activitySeries} /> : null}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="font-heading text-sm font-bold">Transaction Details</span>
          <input
            value={txFilter}
            onChange={(e) => setTxFilter(e.target.value)}
            placeholder="Filter carriers…"
            className="rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs outline-none"
          />
        </div>
        <div className="min-w-160">
          <div className="grid grid-cols-[2fr_0.9fr_0.9fr_1fr_1fr_1fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>Carrier</span>
            <span className="text-right">New Cards</span>
            <span className="text-right">Tx</span>
            <span className="text-right">Gallons</span>
            <span className="text-right">Discount</span>
            <span className="text-right">Total</span>
          </div>
          {txRows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No transactions this cycle.</div>
          ) : (
            <>
              {txRows.map((row) => (
                <div key={row.carrier} className="grid grid-cols-[2fr_0.9fr_0.9fr_1fr_1fr_1fr] items-center gap-3 border-b px-4 py-3 text-sm">
                  <span className="truncate font-semibold">{row.carrier}</span>
                  <span className="text-right font-mono text-muted-foreground">{row.newCards}</span>
                  <span className="text-right font-mono text-muted-foreground">{row.tx}</span>
                  <span className="text-right font-mono text-muted-foreground">{num(row.volume)}</span>
                  <span className="text-right font-mono text-muted-foreground">{money(row.discount)}</span>
                  <span className="text-right font-mono font-bold text-good">{money(row.total)}</span>
                </div>
              ))}
              <div className="grid grid-cols-[2fr_0.9fr_0.9fr_1fr_1fr_1fr] items-center gap-3 bg-muted/30 px-4 py-3 text-sm font-bold">
                <span>Total ({txRows.length})</span>
                <span className="text-right font-mono">{txTotals.newCards}</span>
                <span className="text-right font-mono">{txTotals.tx}</span>
                <span className="text-right font-mono">{num(Math.round(txTotals.volume))}</span>
                <span />
                <span className="text-right font-mono text-good">{money(txTotals.total)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityChart({ series }: { series: number[] }) {
  const w = 600;
  const h = 160;
  const pad = 12;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min || 1;
  const step = (w - pad * 2) / (series.length - 1);

  const points = series.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="font-heading mb-3 text-sm font-bold">Card Activity (transactions)</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full text-primary" preserveAspectRatio="none">
        <polygon points={`${pad},${h - pad} ${points.join(' ')} ${w - pad},${h - pad}`} className="fill-primary/12" />
        <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}
