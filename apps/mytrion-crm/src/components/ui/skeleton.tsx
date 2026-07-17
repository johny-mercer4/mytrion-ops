import { cn } from '@/lib/utils';

/**
 * Loading placeholder — a token-driven sheen that sweeps left to right.
 *
 * Shape it with utilities at the call site (`className="h-2.5 w-1/2"`); this only owns the sheen,
 * so it can stand in for a bar of text, an avatar, a chip, or a whole tile.
 *
 * `aria-hidden` by default: a shimmer says nothing to a screen reader. Mark the region that's
 * loading with `aria-busy` and announce it there — see `TableSkeleton` for the pattern.
 *
 * The gradient runs muted → accent → muted, which resolve to `--surface-alt` → `--surface-raised`
 * in both themes, matching the sheen the customer-service panels already use.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'animate-shimmer rounded-full bg-linear-to-r from-muted via-accent to-muted bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}
