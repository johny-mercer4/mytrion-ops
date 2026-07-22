import type { KpiStat } from '@/mytrions/analyst/data';

import { cn } from '@/lib/utils';

import { DeltaPill } from './DeltaPill';

export interface AnalyticsKpiGridProps {
  kpis: KpiStat[];
  /** Grid columns at sm+; default 4. */
  columns?: 2 | 3 | 4;
  className?: string;
}

const COL_CLASS = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
} as const;

/** KPI row — big numerals + optional delta pills. Pass any AnalyticsBlock.kpis array. */
export function AnalyticsKpiGrid({ kpis, columns = 4, className }: AnalyticsKpiGridProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-3', COL_CLASS[columns], className)}>
      {kpis.map((k) => (
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
  );
}
