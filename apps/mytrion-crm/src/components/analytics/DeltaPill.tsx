import { ArrowDown, ArrowUp } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface DeltaPillProps {
  prev: number;
  current: number;
  higherIsBetter: boolean;
  className?: string;
}

/** Trend pill comparing current vs prev — green when the move is "good" for the metric. */
export function DeltaPill({ prev, current, higherIsBetter, className }: DeltaPillProps) {
  const up = current >= prev;
  const good = up === higherIsBetter;
  const pct = prev === 0 ? 0 : Math.abs(((current - prev) / prev) * 100);
  return (
    <span
      className={cn(
        'flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
        good ? 'bg-good/12 text-good' : 'bg-bad/12 text-bad',
        className,
      )}
    >
      {up ? <ArrowUp className="size-2.5" /> : <ArrowDown className="size-2.5" />}
      {pct.toFixed(0)}%
    </span>
  );
}
