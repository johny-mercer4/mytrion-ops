import { useMemo } from 'react';

import type { BreakdownItem } from '@/mytrions/analyst/data';

import { cn } from '@/lib/utils';

import { BAR_CLASS, TEXT_CLASS } from './tones';

export interface AnalyticsBreakdownProps {
  label: string;
  breakdown: BreakdownItem[];
  className?: string;
}

/** Horizontal bar breakdown from AnalyticsBlock.breakdown. */
export function AnalyticsBreakdown({ label, breakdown, className }: AnalyticsBreakdownProps) {
  const max = useMemo(() => Math.max(1, ...breakdown.map((b) => b.value)), [breakdown]);
  return (
    <div className={cn('rounded-lg border bg-card p-4 shadow-sm', className)}>
      <h3 className="font-heading mb-3 text-xs font-bold tracking-wide text-muted-foreground uppercase">
        {label}
      </h3>
      <div className="flex flex-col gap-3">
        {breakdown.map((b) => (
          <div key={b.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-semibold">{b.label}</span>
              <span className={cn('font-mono', TEXT_CLASS[b.tone])}>{b.value.toLocaleString()}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full', BAR_CLASS[b.tone])}
                style={{ width: `${(b.value / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
