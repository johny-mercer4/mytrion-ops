import { useMemo, useState } from 'react';
import { Clock3, Fuel, ListChecks, Wallet } from 'lucide-react';

import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatCard } from '@/components/mytrion/stat-card';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { DOW_VOLUME, HOUR_VOLUME, TOP_CARRIERS, TOP_LOCATIONS } from './data';

type Metric = 'tx' | 'spend' | 'gal';

const METRIC_OPTIONS = [
  { id: 'tx', label: 'Tx' },
  { id: 'spend', label: '$ Spend' },
  { id: 'gal', label: 'Gallons' },
];

function metricLabel(metric: Metric, v: number): string {
  if (metric === 'spend') return fmtCompact(v);
  if (metric === 'gal') return `${Math.round(v).toLocaleString('en-US')}g`;
  return String(v);
}

function fmtCompact(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function DashboardFueling() {
  const [metric, setMetric] = useState<Metric>('tx');

  const weekTx = DOW_VOLUME.reduce((s, d) => s + d.tx, 0);
  const weekSpend = DOW_VOLUME.reduce((s, d) => s + d.spend, 0);
  const weekGal = DOW_VOLUME.reduce((s, d) => s + d.gal, 0);

  const dowMax = Math.max(...DOW_VOLUME.map((d) => d[metric]));
  // Non-null assertion is safe: DOW_VOLUME is a fixed non-empty seed array (7 days).
  const dowPeak = DOW_VOLUME.reduce((best, d) => (d[metric] > best[metric] ? d : best), DOW_VOLUME[0]!);

  const hourMax = Math.max(...HOUR_VOLUME.map((h) => h.tx));
  const peakHours = useMemo(
    () =>
      [...HOUR_VOLUME]
        .sort((a, b) => b.tx - a.tx)
        .slice(0, 3)
        .map((h) => h.hour)
        .sort((a, b) => a - b),
    [],
  );

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={ListChecks} value={weekTx.toLocaleString('en-US')} label="Transactions · 7-day window" tint="primary" />
        <StatCard icon={Wallet} value={fmtCompact(weekSpend)} label={`Avg ${fmtCompact(weekSpend / weekTx)}/tx`} tint="good" />
        <StatCard icon={Fuel} value={`${Math.round(weekGal).toLocaleString('en-US')} gal`} label={`Avg ${(weekGal / weekTx).toFixed(1)} gal/tx`} tint="purple" />
        <StatCard icon={Clock3} value="18.4h" label="Median · p25 11.2h · p75 31.8h" tint="warn" />
      </div>

      <div className="rounded-xs border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-heading text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Volume by Day of Week
          </div>
          <SegmentedFilter options={METRIC_OPTIONS} value={metric} onChange={(v) => setMetric(v as Metric)} />
        </div>
        <div className="flex h-40 items-end gap-2.5">
          {DOW_VOLUME.map((d) => {
            const val = d[metric];
            const height = Math.max((val / dowMax) * 100, 4);
            const isPeak = d.dow === dowPeak.dow;
            return (
              <div key={d.dow} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="text-[10px] font-bold">{metricLabel(metric, val)}</span>
                <div className="flex h-28 w-full items-end">
                  <div
                    className={`w-full rounded-t-sm ${isPeak ? 'bg-primary' : d.weekend ? 'bg-brand-purple/60' : 'bg-primary/40'}`}
                    style={{ height: `${height}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">{d.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xs border bg-card p-4 shadow-sm">
        <div className="mb-3 font-heading text-xs font-bold tracking-wide text-muted-foreground uppercase">
          Volume by Hour of Day
        </div>
        <div className="flex h-24 items-end gap-1">
          {HOUR_VOLUME.map((h) => {
            const height = Math.max((h.tx / hourMax) * 100, 4);
            return (
              <div key={h.hour} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-20 w-full items-end">
                  <div className={`w-full rounded-t-sm ${h.peak ? 'bg-primary' : 'bg-primary/35'}`} style={{ height: `${height}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex gap-1">
          {HOUR_VOLUME.map((h) => (
            <div key={h.hour} className="flex-1 text-center text-[9px] text-muted-foreground">
              {h.hour % 3 === 0 ? h.hour : ''}
            </div>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">Peak: {peakHours.map((h) => `${h}:00`).join(', ')}</div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <div className="rounded-xs border bg-card p-4 shadow-sm">
          <div className="mb-3 font-heading text-xs font-bold tracking-wide text-muted-foreground uppercase">Top Locations</div>
          <div className="flex flex-col gap-2">
            {TOP_LOCATIONS.map((l, i) => (
              <div key={l.loc} className="flex items-center gap-3 rounded-xs border bg-muted/30 px-3 py-2 text-xs">
                <span className="flex size-6 flex-none items-center justify-center rounded-full bg-primary/12 text-[10px] font-bold text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{l.loc}</div>
                  <div className="text-[10px] text-muted-foreground">{l.state} · {l.tx} tx · {l.gal.toLocaleString('en-US')} gal</div>
                </div>
                <span className="font-mono font-bold text-primary">{fmtCompact(l.spend)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xs border bg-card p-4 shadow-sm">
          <div className="mb-3 font-heading text-xs font-bold tracking-wide text-muted-foreground uppercase">Top Carriers</div>
          <div className="flex flex-col gap-2">
            {TOP_CARRIERS.map((c, i) => (
              <div key={c.carrier} className="flex items-center gap-3 rounded-xs border bg-muted/30 px-3 py-2 text-xs">
                <span className="flex size-6 flex-none items-center justify-center rounded-full bg-primary/12 text-[10px] font-bold text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-semibold">{c.company}</span>
                    <StatusBadge tone={c.terms === 'LOC' ? 'info' : c.terms === 'Prepay' ? 'good' : 'neutral'}>{c.terms}</StatusBadge>
                  </div>
                  <div className="text-[10px] text-muted-foreground">#{c.carrier} · {c.tx} tx · {c.gal.toLocaleString('en-US')} gal</div>
                </div>
                <span className="font-mono font-bold text-primary">{fmtCompact(c.spend)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
