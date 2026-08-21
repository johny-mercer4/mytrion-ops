import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface StatCardProps {
  icon: LucideIcon;
  value: string;
  label: string;
  tint?: 'primary' | 'good' | 'warn' | 'bad' | 'purple';
  className?: string;
}

const TINT_CLASS: Record<NonNullable<StatCardProps['tint']>, string> = {
  primary: 'bg-primary/12 text-primary',
  good: 'bg-good/14 text-good',
  warn: 'bg-warn/14 text-warn',
  bad: 'bg-bad/14 text-bad',
  purple: 'bg-brand-purple/14 text-brand-purple',
};

// KPI/stat tile — icon chip + big Rajdhani numeral + uppercase label, used in
// every module's dashboard and detail-modal snapshot rows.
export function StatCard({ icon: Icon, value, label, tint = 'primary', className }: StatCardProps) {
  return (
    <div className={cn('flex items-center gap-3.5 rounded-lg border bg-card p-4 shadow-sm', className)}>
      <span
        className={cn('flex size-9 flex-none items-center justify-center rounded-md', TINT_CLASS[tint])}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="font-heading text-2xl leading-none font-bold">{value}</div>
        <div className="mt-1 text-[10.5px] tracking-wide text-muted-foreground uppercase">{label}</div>
      </div>
    </div>
  );
}
