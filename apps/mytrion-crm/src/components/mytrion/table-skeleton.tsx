import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export interface TableSkeletonProps {
  /** Bar width per column, as any CSS length — one entry per column, and the column count. */
  widths: readonly string[];
  /** Class carrying the table's `grid-template-columns`, so bars line up under the real headers. */
  colsClassName?: string | undefined;
  /** Class carrying the real row's padding/border, so the placeholder has the row's geometry. */
  rowClassName?: string | undefined;
  rows?: number;
  className?: string | undefined;
}

/**
 * Placeholder rows for a data table's first load.
 *
 * Takes the table's own row and column classes rather than guessing at a layout: the bars then sit
 * in the real grid, under the real headers, so nothing shifts when the data lands. Widths are
 * per-column and meant to be uneven — a column of identical full-width bars reads as a loading
 * graphic, while ragged ones read as a table whose text hasn't arrived yet.
 *
 * Hidden from assistive tech. The caller marks the table `aria-busy` and announces the wait.
 */
export function TableSkeleton({
  widths,
  colsClassName,
  rowClassName,
  rows = 6,
  className,
}: TableSkeletonProps) {
  return (
    <div aria-hidden="true" className={className} data-slot="table-skeleton">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className={cn(rowClassName, colsClassName)}>
          {widths.map((width, col) => (
            <Skeleton
              key={col}
              className={cn('h-2.5', row % 2 === 1 && '[animation-delay:200ms]')}
              style={{ width }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
