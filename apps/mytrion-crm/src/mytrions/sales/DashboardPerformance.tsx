import { useState } from 'react';
import { RotateCw, Trophy } from 'lucide-react';

import { callTouchpoint } from '@/api/touchpoints';
import { getSession } from '@/api/session';
import { useImpersonation } from '@/context/ImpersonationProvider';
import { StatCard } from '@/components/mytrion/stat-card';
import { Button } from '@/components/ui/button';
import { money, num, useLoad } from './live';
import type { ActivityRange } from './data';

// Widget Performance tab: /api/agent/activity/:zohoUserId KPIs + the deals leaderboard
// (/api/agent/activity/leaderboard, metric toggle value_total | deal_count | value_avg).

type Metric = 'value_total' | 'deal_count' | 'value_avg';

const METRIC_LABEL: Record<Metric, string> = {
  value_total: 'Deal Value',
  deal_count: 'Deals',
  value_avg: 'Avg Value',
};

export function DashboardPerformance() {
  const { actingAs } = useImpersonation();
  const [range, setRange] = useState<ActivityRange>('weekly');
  const [metric, setMetric] = useState<Metric>('value_total');

  const activity = useLoad(() => callTouchpoint('activity.agent', { range }), [range]);
  const board = useLoad(
    () => callTouchpoint('activity.leaderboard', { range, limit: 20, metric }),
    [range, metric],
  );

  const m = activity.data?.metrics ?? {};
  // null = the metric's upstream errored → render "—" instead of a fake 0.
  const mv = (key: string, field: 'count' | 'completed' | 'value_total' | 'value_avg' = 'count'): number | null => {
    const entry = m[key];
    if (!entry) return 0;
    if (entry.error) return null;
    const v = (entry as Record<string, unknown>)[field];
    return typeof v === 'number' ? v : 0;
  };
  const kpi = (v: number | null, asMoney = false): string => (v === null ? '—' : asMoney ? money(v) : num(v));

  const myZohoId = actingAs?.zohoUserId ?? getSession()?.worker.zohoUserId ?? '';
  const rows = board.data?.leaderboard ?? board.data?.data ?? [];
  const currentAgent = board.data?.current_agent;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-md border bg-muted/30 p-1">
          {(['daily', 'weekly', 'monthly'] as ActivityRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded px-2.5 py-1 text-xs font-semibold ${
                range === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {r === 'daily' ? 'Today' : r === 'weekly' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            activity.reload();
            board.reload();
          }}
        >
          <RotateCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      {activity.error ? <p className="text-sm text-bad">{activity.error}</p> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={Trophy} value={kpi(mv('deals_value_created', 'value_total'), true)} label="Deal Value Created" tint="good" />
        <StatCard icon={Trophy} value={kpi(mv('deals_value_created'))} label="Deals Created" tint="primary" />
        <StatCard icon={Trophy} value={kpi(mv('leads_created'))} label="Leads Created" tint="purple" />
        <StatCard icon={Trophy} value={kpi(mv('applications_filled'))} label="Applications" tint="warn" />
        <StatCard icon={Trophy} value={kpi(mv('calls', 'completed'))} label="Calls" tint="primary" />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <span className="font-heading text-sm font-bold">Leaderboard</span>
          <div className="flex gap-1 rounded-md border bg-muted/30 p-1">
            {(Object.keys(METRIC_LABEL) as Metric[]).map((mKey) => (
              <button
                key={mKey}
                onClick={() => setMetric(mKey)}
                className={`rounded px-2 py-1 text-[11px] font-semibold ${
                  metric === mKey ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {METRIC_LABEL[mKey]}
              </button>
            ))}
          </div>
        </div>
        {board.loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading leaderboard…</div>
        ) : board.error ? (
          <div className="p-8 text-center text-sm text-bad">{board.error}</div>
        ) : (
          <div className="min-w-140">
            <div className="grid grid-cols-[0.4fr_2fr_0.8fr_1fr_1fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
              <span>#</span>
              <span>Agent</span>
              <span className="text-right">Deals</span>
              <span className="text-right">Value</span>
              <span className="text-right">Avg</span>
            </div>
            {rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No leaderboard data for this range.</div>
            ) : (
              rows.map((row, i) => {
                const isMe = String(row.zoho_user_id ?? '') === String(myZohoId);
                return (
                  <div
                    key={`${row.agent_name}-${i}`}
                    className={`grid grid-cols-[0.4fr_2fr_0.8fr_1fr_1fr] items-center gap-3 border-b px-4 py-2.5 text-sm last:border-b-0 ${
                      isMe ? 'bg-primary/8 font-semibold' : ''
                    }`}
                  >
                    <span className="font-mono text-xs">{row.rank ?? i + 1}</span>
                    <span className="truncate">
                      {row.agent_name ?? '—'}
                      {isMe ? <span className="ml-1.5 rounded bg-primary/15 px-1 text-[9.5px] font-bold text-primary">YOU</span> : null}
                    </span>
                    <span className="text-right font-mono">{num(row.deal_count ?? 0)}</span>
                    <span className="text-right font-mono text-good">{money(row.value_total ?? 0)}</span>
                    <span className="text-right font-mono text-muted-foreground">{money(row.value_avg ?? 0)}</span>
                  </div>
                );
              })
            )}
            {currentAgent && currentAgent.found_in_top === false ? (
              <div className="border-t px-4 py-2.5 text-xs text-muted-foreground">
                Your rank: <span className="font-bold text-foreground">#{currentAgent.rank ?? '—'}</span> (outside top {rows.length})
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
