import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Headset, RefreshCw, Ticket, Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ANALYTICS, type BreakdownItem } from './data';

type SubTab = 'tickets' | 'calls' | 'maintenance';

const SUB_TABS: { id: SubTab; label: string; icon: typeof Ticket }[] = [
  { id: 'tickets', label: 'Tickets', icon: Ticket },
  { id: 'calls', label: 'Calls', icon: Headset },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
];

const RANGE_OPTIONS = ['This Month', 'Last Month', 'Last 30 Days', 'This Quarter'];

const BREAKDOWN_BAR_CLASS: Record<BreakdownItem['tone'], string> = {
  good: 'bg-good',
  warn: 'bg-warn',
  bad: 'bg-bad',
  info: 'bg-primary',
  neutral: 'bg-muted-foreground',
  purple: 'bg-brand-purple',
  sky: 'bg-primary',
  teal: 'bg-good',
  amber: 'bg-warn',
};

const BREAKDOWN_TEXT_CLASS: Record<BreakdownItem['tone'], string> = {
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-primary',
  neutral: 'text-muted-foreground',
  purple: 'text-brand-purple',
  sky: 'text-primary',
  teal: 'text-good',
  amber: 'text-warn',
};

export function Analytics() {
  const [subTab, setSubTab] = useState<SubTab>('tickets');
  const [range, setRange] = useState('This Month');
  const block = ANALYTICS[subTab];
  const maxVolume = useMemo(() => Math.max(...block.volume.map((v) => v.value)), [block]);
  const maxBreakdown = useMemo(() => Math.max(...block.breakdown.map((b) => b.value)), [block]);
  const maxLead = useMemo(() => Math.max(...block.leaderboard.map((r) => r.col1)), [block]);

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Analytics</h2>
          <p className="text-sm text-muted-foreground">All agents · {range}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="rounded-xs border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground outline-none focus:border-primary/55"
          >
            {RANGE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm">
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {SUB_TABS.map((t) => {
          const active = t.id === subTab;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-xs border px-3 py-1.5 text-xs font-semibold transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" />
              {t.label}
              <span className="ml-1 opacity-70">{ANALYTICS[t.id].leaderboard.reduce((s, r) => s + r.col1, 0)}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {block.kpis.map((k) => (
          <div key={k.label} className="rounded-xs border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="font-heading text-2xl leading-none font-bold">{k.value}</div>
              {k.delta ? <DeltaPill prev={k.delta.prev} current={k.delta.current} higherIsBetter={k.delta.higherIsBetter} /> : null}
            </div>
            <div className="mt-1.5 text-[10.5px] tracking-wide text-muted-foreground uppercase">{k.label}</div>
            {k.hint ? <div className="mt-0.5 text-[10.5px] text-muted-foreground">{k.hint}</div> : null}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <div className="rounded-xs border bg-card p-4 shadow-sm">
          <h3 className="font-heading mb-3 text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Volume
          </h3>
          <div className="flex h-40 items-end gap-1.5">
            {block.volume.map((v) => (
              <div key={v.label} className="flex flex-1 flex-col items-center gap-1.5" title={`${v.label}: ${v.value}`}>
                <div className="flex h-32 w-full items-end">
                  <div
                    className={cn('w-full rounded-t-sm', v.partial ? 'bg-primary/35' : 'bg-primary')}
                    style={{ height: `${(v.value / maxVolume) * 100}%` }}
                  />
                </div>
                <span className="text-[8.5px] text-muted-foreground">{v.label.slice(-2)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xs border bg-card p-4 shadow-sm">
          <h3 className="font-heading mb-3 text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Breakdown
          </h3>
          <div className="flex flex-col gap-3">
            {block.breakdown.map((b) => (
              <div key={b.label}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold">{b.label}</span>
                  <span className={cn('font-mono', BREAKDOWN_TEXT_CLASS[b.tone])}>{b.value}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full', BREAKDOWN_BAR_CLASS[b.tone])}
                    style={{ width: `${(b.value / maxBreakdown) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xs border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="font-heading text-sm font-bold">Agent Leaderboard</div>
        </div>
        {/* min-w keeps the 5-column grid from squishing on phones; overflow-x-auto on the
            wrapper above makes it swipeable instead of clipping the trailing columns. */}
        <div className="min-w-140">
          <div className="grid grid-cols-[40px_1.6fr_1fr_1fr_1fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>#</span>
            <span>Agent</span>
            <span>{block.leaderboardCols[0]}</span>
            <span>{block.leaderboardCols[1]}</span>
            <span>{block.leaderboardCols[2]}</span>
          </div>
          {block.leaderboard.map((row, i) => {
            const rank = i + 1;
            const initials = row.agent
              .split(' ')
              .map((n) => n[0])
              .join('')
              .slice(0, 2)
              .toUpperCase();
            return (
              <div
                key={row.agent}
                className={cn(
                  'grid grid-cols-[40px_1.6fr_1fr_1fr_1fr] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0',
                  rank === 1 ? 'bg-primary/8' : undefined,
                )}
              >
                <span className={cn('font-mono font-bold', rank === 1 ? 'text-primary' : 'text-muted-foreground')}>
                  {rank}
                </span>
                <span className="flex items-center gap-2">
                  <span className="flex size-6 flex-none items-center justify-center rounded-full bg-secondary text-[10px] font-bold text-secondary-foreground">
                    {initials}
                  </span>
                  <span className="truncate font-semibold">{row.agent}</span>
                </span>
                <span className="font-mono text-xs" style={{ opacity: 0.4 + 0.6 * (row.col1 / maxLead) }}>
                  {row.col1}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{row.col2}</span>
                <span className="font-mono text-xs text-muted-foreground">{row.col3}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DeltaPill({ prev, current, higherIsBetter }: { prev: number; current: number; higherIsBetter: boolean }) {
  const up = current >= prev;
  const good = up === higherIsBetter;
  const pct = prev === 0 ? 0 : Math.abs(((current - prev) / prev) * 100);
  return (
    <span
      className={cn(
        'flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
        good ? 'bg-good/12 text-good' : 'bg-bad/12 text-bad',
      )}
    >
      {up ? <ArrowUp className="size-2.5" /> : <ArrowDown className="size-2.5" />}
      {pct.toFixed(0)}%
    </span>
  );
}
