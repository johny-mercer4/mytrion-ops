import { cn } from '@/lib/utils';

export interface SegmentedFilterOption {
  id: string;
  label: string;
  count?: number;
}

export interface SegmentedFilterProps {
  options: SegmentedFilterOption[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

// Filter-chip row (status/type/priority filters above tables). Not a Tabs
// component — no bottom-border indicator, just a pressed-state pill group.
export function SegmentedFilter({ options, value, onChange, className }: SegmentedFilterProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            data-active={active}
            className={cn(
              'rounded-xs border px-3 py-1.5 text-xs font-semibold transition-colors',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
            {opt.count !== undefined ? <span className="ml-1.5 opacity-70">{opt.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
