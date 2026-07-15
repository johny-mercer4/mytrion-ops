import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Receipt, RefreshCw, TrendingUp, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { fetchAnalyticsSnapshot } from '../../api/analytics';
import { ANALYTICS, type AnalyticsBlock, type AnalyticsDimension, type BreakdownItem } from './data';

const DIMENSIONS: { id: AnalyticsDimension; label: string; icon: typeof Receipt }[] = [
  { id: 'pipeline', label: 'Pipeline', icon: TrendingUp },
  { id: 'transactions', label: 'Transactions', icon: Receipt },
  { id: 'billing', label: 'Billing', icon: Wallet },
];

/** Re-fetch cadence — cheap: the backend serves from its snapshot cache, not the warehouse. */
const POLL_MS = 5 * 60_000;

const BAR_CLASS: Record<BreakdownItem['tone'], string> = {
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

const TEXT_CLASS: Record<BreakdownItem['tone'], string> = {
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

interface Loaded {
  block: AnalyticsBlock;
  /** 'live' = warehouse snapshot; 'sample' = bundled fallback (backend unreachable). */
  source: 'live' | 'sample';
  computedAt?: string;
}

/** Live analytics dashboard — warehouse snapshots via /v1/analytics (2h cache), sample fallback. */
export function Dashboard() {
  const [dim, setDim] = useState<AnalyticsDimension>('pipeline');
  const [loaded, setLoaded] = useState<Partial<Record<AnalyticsDimension, Loaded>>>({});
  const [refreshing, setRefreshing] = useState(false);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  const load = useCallback(async (dimension: AnalyticsDimension, fresh = false) => {
    try {
      const snap = await fetchAnalyticsSnapshot(dimension, { fresh });
      setLoaded((prev) => ({
        ...prev,
        [dimension]: { block: snap.block, source: 'live', computedAt: snap.computedAt },
      }));
    } catch {
      // Backend off / DWH unconfigured → keep (or fall back to) the bundled sample block.
      setLoaded((prev) =>
        prev[dimension]?.source === 'live'
          ? prev
          : { ...prev, [dimension]: { block: ANALYTICS[dimension], source: 'sample' } },
      );
    }
  }, []);

  // Load the active dimension on first visit; re-fetch it on a slow poll (cache-priced).
  useEffect(() => {
    if (!loadedRef.current[dim]) void load(dim);
    const t = setInterval(() => void load(dim), POLL_MS);
    return () => clearInterval(t);
  }, [dim, load]);

  async function forceRefresh() {
    setRefreshing(true);
    try {
      await load(dim, true);
    } finally {
      setRefreshing(false);
    }
  }

  const current: Loaded = loaded[dim] ?? { block: ANALYTICS[dim], source: 'sample' };
  const block = current.block;
  const maxTrend = useMemo(() => Math.max(1, ...block.trend.map((t) => t.value)), [block]);
  const maxBreakdown = useMemo(() => Math.max(1, ...block.breakdown.map((b) => b.value)), [block]);
  const maxLead = useMemo(() => Math.max(1, ...block.leaderboard.map((r) => r.col1)), [block]);

  const freshness =
    current.source === 'live'
      ? `live · updated ${current.computedAt ? new Date(current.computedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}`
      : 'sample data — backend offline';

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Analytics</h2>
          <p className="text-sm text-muted-foreground">
            {block.caption} ·{' '}
            <span className={current.source === 'live' ? 'text-good' : 'text-warn'}>{freshness}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void forceRefresh()} disabled={refreshing}>
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {DIMENSIONS.map((t) => {
          const active = t.id === dim;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setDim(t.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {block.kpis.map((k) => (
          <div key={k.label} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="font-heading text-2xl leading-none font-bold">{k.value}</div>
              {k.delta ? (
                <DeltaPill prev={k.delta.prev} current={k.delta.current} higherIsBetter={k.delta.higherIsBetter} />
              ) : null}
            </div>
            <div className="mt-1.5 text-[10.5px] tracking-wide text-muted-foreground uppercase">{k.label}</div>
            {k.hint ? <div className="mt-0.5 text-[10.5px] text-muted-foreground">{k.hint}</div> : null}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="font-heading mb-3 text-xs font-bold tracking-wide text-muted-foreground uppercase">
            {block.trendLabel}
          </h3>
          <div className="flex h-40 items-end gap-1.5">
            {block.trend.map((t) => (
              <div key={t.label} className="flex flex-1 flex-col items-center gap-1.5" title={`${t.label}: ${t.value}`}>
                <div className="flex h-32 w-full items-end">
                  <div
                    className={cn('w-full rounded-t-sm', t.partial ? 'bg-primary/35' : 'bg-primary')}
                    style={{ height: `${(t.value / maxTrend) * 100}%` }}
                  />
                </div>
                <span className="text-[8.5px] text-muted-foreground">{t.label.slice(-2)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="font-heading mb-3 text-xs font-bold tracking-wide text-muted-foreground uppercase">
            {block.breakdownLabel}
          </h3>
          <div className="flex flex-col gap-3">
            {block.breakdown.map((b) => (
              <div key={b.label}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold">{b.label}</span>
                  <span className={cn('font-mono', TEXT_CLASS[b.tone])}>{b.value.toLocaleString()}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full', BAR_CLASS[b.tone])}
                    style={{ width: `${(b.value / maxBreakdown) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="font-heading text-sm font-bold">{block.leaderboardLabel}</div>
        </div>
        {/* min-w keeps the 5-column grid from squishing on phones; the overflow-x-auto wrapper
            above makes it swipeable instead of clipping the trailing columns. */}
        <div className="min-w-140">
          <div className="grid grid-cols-[40px_1.6fr_1fr_1fr_1fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>#</span>
            <span>Name</span>
            <span>{block.leaderboardCols[0]}</span>
            <span>{block.leaderboardCols[1]}</span>
            <span>{block.leaderboardCols[2]}</span>
          </div>
          {block.leaderboard.map((row, i) => {
            const rank = i + 1;
            const initials = row.name
              .split(' ')
              .map((n) => n[0] ?? '')
              .join('')
              .slice(0, 2)
              .toUpperCase();
            return (
              <div
                key={row.name}
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
                  <span className="truncate font-semibold">{row.name}</span>
                </span>
                <span className="font-mono text-xs" style={{ opacity: 0.4 + 0.6 * (row.col1 / maxLead) }}>
                  {row.col1.toLocaleString()}
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
