import type { LucideIcon } from 'lucide-react';
import { Receipt, TrendingUp, Wallet } from 'lucide-react';

import type { AnalyticsDimension } from '@/mytrions/analyst/data';

import { cn } from '@/lib/utils';

export const ANALYTICS_DIMENSIONS: { id: AnalyticsDimension; label: string; icon: LucideIcon }[] = [
  { id: 'pipeline', label: 'Pipeline', icon: TrendingUp },
  { id: 'transactions', label: 'Transactions', icon: Receipt },
  { id: 'billing', label: 'Billing', icon: Wallet },
];

export interface AnalyticsDimensionTabsProps {
  value: AnalyticsDimension;
  onChange: (dim: AnalyticsDimension) => void;
  /** Subset of dimensions to show; default = all three. */
  dimensions?: AnalyticsDimension[];
  className?: string;
}

/** Dimension switcher (Pipeline / Transactions / Billing). Pass a subset via `dimensions`. */
export function AnalyticsDimensionTabs({
  value,
  onChange,
  dimensions,
  className,
}: AnalyticsDimensionTabsProps) {
  const tabs = dimensions
    ? ANALYTICS_DIMENSIONS.filter((d) => dimensions.includes(d.id))
    : ANALYTICS_DIMENSIONS;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {tabs.map((t) => {
        const active = t.id === value;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
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
  );
}
