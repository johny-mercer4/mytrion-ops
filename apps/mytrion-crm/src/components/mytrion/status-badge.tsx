import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Status pill vocabulary from docs/design-mockups/design-tokens.md — every
// module reuses this same five-way status language (ready/embedding/failed
// style tags, "Grounded"/"Denied" tool chips, KPI deltas, etc).
export type StatusTone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

const TONE_CLASS: Record<StatusTone, string> = {
  good: 'border-good/30 bg-good/10 text-good',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  bad: 'border-bad/30 bg-bad/10 text-bad',
  info: 'border-primary/30 bg-primary/10 text-primary',
  neutral: 'border-border bg-muted text-muted-foreground',
};

export function StatusBadge({
  tone = 'neutral',
  className,
  children,
  ...props
}: React.ComponentProps<typeof Badge> & { tone?: StatusTone }) {
  return (
    <Badge variant="outline" className={cn(TONE_CLASS[tone], 'font-medium', className)} {...props}>
      {children}
    </Badge>
  );
}
