import { RefreshCw, Ticket, Clock3, Users, Wrench } from 'lucide-react';

import { StatCard } from '@/components/mytrion/stat-card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  MY_PERFORMANCE,
  OPEN_TICKETS_BY_PRIORITY,
  RECENT_ACTIVITY,
  TEAM_OVERVIEW,
  greeting,
} from './data';

const DOT_CLASS: Record<string, string> = {
  purple: 'bg-brand-purple',
  sky: 'bg-primary',
  good: 'bg-good',
  bad: 'bg-bad',
  orange: 'bg-warn',
};

const PRIORITY_BAR_CLASS: Record<string, string> = {
  bad: 'bg-bad',
  warn: 'bg-warn',
  info: 'bg-primary',
  neutral: 'bg-muted-foreground',
};

const TODAY_LABEL = new Date().toLocaleDateString('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

export function Home() {
  const totalOpen = OPEN_TICKETS_BY_PRIORITY.reduce((s, p) => s + p.count, 0);
  const maxPriority = Math.max(...OPEN_TICKETS_BY_PRIORITY.map((p) => p.count));

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Home</h2>
          <p className="text-sm text-muted-foreground">{TODAY_LABEL} — Customer Service</p>
        </div>
        <Button variant="outline" size="sm">
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3.5">
          <span className="flex size-11 flex-none items-center justify-center rounded-full bg-primary font-heading text-sm font-bold text-primary-foreground">
            DW
          </span>
          <div>
            <div className="font-heading text-lg font-bold">{greeting()}, Dana</div>
            <div className="text-xs text-muted-foreground">Customer Service Lead</div>
          </div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-good/30 bg-good/10 px-3 py-1 text-[11px] font-bold tracking-wide text-good uppercase">
          <span className="size-1.5 animate-pulse rounded-full bg-good" />
          Live
        </span>
      </div>

      <div>
        <h3 className="font-heading mb-2.5 text-xs font-bold tracking-wide text-muted-foreground uppercase">
          Team Overview
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={Ticket} value={String(TEAM_OVERVIEW.openTickets)} label="Open Tickets" tint="primary" />
          <StatCard icon={Clock3} value={String(TEAM_OVERVIEW.pendingApps)} label="Pending Apps" tint="warn" />
          <StatCard icon={Users} value={String(TEAM_OVERVIEW.activeClients)} label="Active Clients" tint="good" />
          <StatCard icon={Wrench} value={String(TEAM_OVERVIEW.maintenance)} label="Maintenance" tint="purple" />
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-3 text-[10.5px] text-muted-foreground sm:grid-cols-4">
          <span>Active support cases</span>
          <span>Awaiting carrier ID</span>
          <span>With carrier ID</span>
          <span>Open this month</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <h3 className="font-heading mb-3 text-xs font-bold tracking-wide text-muted-foreground uppercase">
              My Performance
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <MiniStat value={String(MY_PERFORMANCE.myPendingApps)} label="My Pending Apps" />
              <MiniStat value={String(MY_PERFORMANCE.myActiveClients)} label="My Active Clients" />
              <MiniStat value={String(MY_PERFORMANCE.myTicketsMonth)} label="My Tickets (Month)" />
              <MiniStat value={String(MY_PERFORMANCE.myTicketsLastMonth)} label="Last Month" />
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <h3 className="font-heading mb-3 text-xs font-bold tracking-wide text-muted-foreground uppercase">
              Recent Activity
            </h3>
            <div className="flex flex-col">
              {RECENT_ACTIVITY.map((a) => (
                <div key={a.id} className="flex items-start gap-2.5 border-b py-2.5 last:border-b-0">
                  <span className={cn('mt-1.5 size-2 flex-none rounded-full', DOT_CLASS[a.dot])} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{a.text}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{a.sub}</div>
                  </div>
                  <span className="flex-none text-[11px] text-muted-foreground">{a.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="font-heading mb-3 text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Open Tickets by Priority
          </h3>
          <div className="flex flex-col gap-3">
            {OPEN_TICKETS_BY_PRIORITY.map((p) => (
              <div key={p.label}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold">{p.label}</span>
                  <span className="font-mono text-muted-foreground">{p.count}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full', PRIORITY_BAR_CLASS[p.tone])}
                    style={{ width: `${(p.count / maxPriority) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs">
            <span className="text-muted-foreground">Total open</span>
            <span className="font-mono font-bold">{totalOpen}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="font-heading text-xl font-bold">{value}</div>
      <div className="mt-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
    </div>
  );
}
