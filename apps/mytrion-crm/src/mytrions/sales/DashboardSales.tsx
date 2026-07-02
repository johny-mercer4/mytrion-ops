import { CreditCard, Droplets } from 'lucide-react';

import { StatCard } from '@/components/mytrion/stat-card';
import { CARDS_BY_COMPANY, CARD_ACTIVITY_SERIES, TOP_CARRIERS } from './dashboardData';
import { DonutRing } from './DonutRing';

const STATUS_BAR_CLASS: Record<string, string> = {
  active: 'bg-good',
  inactive: 'bg-warn',
  stuck: 'bg-bad',
};

export function DashboardSales() {
  const maxCards = Math.max(...CARDS_BY_COMPANY.map((c) => c.cards), 1);
  const inactiveCount = CARDS_BY_COMPANY.filter((c) => c.status === 'inactive').length;
  const stuckCount = CARDS_BY_COMPANY.filter((c) => c.status === 'stuck').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard icon={Droplets} value="182,540" label="Total Gallons · This Cycle" tint="purple" />
        <StatCard icon={CreditCard} value="4,128" label="Card Swipes · This Cycle" tint="primary" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="flex items-center justify-around rounded-lg border bg-card p-5">
          <DonutRing pct={84} label="Active Companies" value="39 / 47" sub="of 47" colorClass="text-good" />
          <DonutRing pct={78} label="Active Cards" value="163 / 209" sub="of 209" colorClass="text-primary" />
        </div>

        <div className="flex flex-col justify-center rounded-lg border bg-card p-5">
          <div className="text-xs font-semibold text-muted-foreground">Card Utilization</div>
          <div className="font-heading mt-1 text-3xl font-bold text-primary">72%</div>
          <div className="mt-3 h-2 w-full rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary" style={{ width: '72%' }} />
          </div>
        </div>

        <div className="flex flex-col justify-center gap-2.5 rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Inactive</span>
            <span className="font-mono font-bold text-warn">{inactiveCount}</span>
          </div>
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Stuck</span>
            <span className="font-mono font-bold text-bad">{stuckCount}</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-5">
        <div className="font-heading mb-3 text-sm font-bold">Cards by Company</div>
        <div className="flex flex-col gap-2.5">
          {CARDS_BY_COMPANY.map((row) => (
            <div key={row.name} className="flex items-center gap-3">
              <span className="w-36 flex-none truncate text-xs font-semibold">{row.name}</span>
              <div className="h-2 flex-1 rounded-full bg-muted">
                <div
                  className={`h-2 rounded-full ${STATUS_BAR_CLASS[row.status]}`}
                  style={{ width: `${(row.cards / maxCards) * 100}%` }}
                />
              </div>
              <span className="w-8 flex-none text-right font-mono text-xs font-bold">{row.cards}</span>
            </div>
          ))}
        </div>
      </div>

      <CardActivityChart />

      <div className="overflow-x-auto rounded-lg border bg-card">
        <div className="border-b px-4 py-3 font-heading text-sm font-bold">Transaction Details · Top Carriers</div>
        <div className="min-w-160">
          <div className="grid grid-cols-[2fr_0.9fr_0.9fr_1fr_1fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>Carrier</span>
            <span className="text-right">New Cards</span>
            <span className="text-right">Tx</span>
            <span className="text-right">Gallons</span>
            <span className="text-right">Total</span>
          </div>
          {TOP_CARRIERS.map((row) => (
            <div key={row.name} className="grid grid-cols-[2fr_0.9fr_0.9fr_1fr_1fr] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0">
              <span className="truncate font-semibold">{row.name}</span>
              <span className="text-right font-mono text-muted-foreground">{row.newCards}</span>
              <span className="text-right font-mono text-muted-foreground">{row.tx}</span>
              <span className="text-right font-mono text-muted-foreground">{row.gallons}</span>
              <span className="text-right font-mono font-bold text-good">{row.total}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CardActivityChart() {
  const w = 600;
  const h = 160;
  const pad = 12;
  const max = Math.max(...CARD_ACTIVITY_SERIES);
  const min = Math.min(...CARD_ACTIVITY_SERIES);
  const range = max - min || 1;
  const step = (w - pad * 2) / (CARD_ACTIVITY_SERIES.length - 1);

  const points = CARD_ACTIVITY_SERIES.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });

  const linePath = points.join(' ');
  const areaPath = `${pad},${h - pad} ${linePath} ${w - pad},${h - pad}`;

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="font-heading mb-3 text-sm font-bold">Card Activity</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full text-primary" preserveAspectRatio="none">
        <polygon points={areaPath} className="fill-primary/12" />
        <polyline points={linePath} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="mt-2 flex justify-between text-[10.5px] text-muted-foreground">
        <span>Jun 1</span>
        <span>Jun 15</span>
        <span>Jun 30</span>
      </div>
    </div>
  );
}
