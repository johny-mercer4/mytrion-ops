import { useMemo } from 'react';

import type { LeaderboardRow } from '@/mytrions/analyst/data';

import { cn } from '@/lib/utils';

export interface AnalyticsLeaderboardProps {
  title: string;
  cols: [string, string, string];
  rows: LeaderboardRow[];
  className?: string;
}

/** Ranked table from AnalyticsBlock.leaderboard — swipeable on small screens. */
export function AnalyticsLeaderboard({ title, cols, rows, className }: AnalyticsLeaderboardProps) {
  const maxLead = useMemo(() => Math.max(1, ...rows.map((r) => r.col1)), [rows]);
  return (
    <div className={cn('overflow-x-auto rounded-lg border bg-card', className)}>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="font-heading text-sm font-bold">{title}</div>
      </div>
      {/* min-w keeps the 5-column grid from squishing on phones; overflow-x-auto makes it swipeable. */}
      <div className="min-w-140">
        <div className="grid grid-cols-[40px_1.6fr_1fr_1fr_1fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
          <span>#</span>
          <span>Name</span>
          <span>{cols[0]}</span>
          <span>{cols[1]}</span>
          <span>{cols[2]}</span>
        </div>
        {rows.map((row, i) => {
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
  );
}
