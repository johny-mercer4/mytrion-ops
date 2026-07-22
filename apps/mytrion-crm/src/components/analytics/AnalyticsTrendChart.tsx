import { useMemo } from 'react';

import type { TrendPoint } from '@/mytrions/analyst/data';

import { cn } from '@/lib/utils';

export interface AnalyticsTrendChartProps {
  label: string;
  trend: TrendPoint[];
  className?: string;
}

/** Simple bar trend chart from AnalyticsBlock.trend. Reusable on any page. */
export function AnalyticsTrendChart({ label, trend, className }: AnalyticsTrendChartProps) {
  const max = useMemo(() => Math.max(1, ...trend.map((t) => t.value)), [trend]);
  return (
    <div className={cn('rounded-lg border bg-card p-4 shadow-sm', className)}>
      <h3 className="font-heading mb-3 text-xs font-bold tracking-wide text-muted-foreground uppercase">
        {label}
      </h3>
      <div className="flex h-40 items-end gap-1.5">
        {trend.map((t) => (
          <div key={t.label} className="flex flex-1 flex-col items-center gap-1.5" title={`${t.label}: ${t.value}`}>
            <div className="flex h-32 w-full items-end">
              <div
                className={cn('w-full rounded-t-sm', t.partial ? 'bg-primary/35' : 'bg-primary')}
                style={{ height: `${(t.value / max) * 100}%` }}
              />
            </div>
            <span className="text-[8.5px] text-muted-foreground">{t.label.slice(-2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
