import type { BreakdownItem } from '@/mytrions/analyst/data';

/** Shared bar/text tone maps for breakdown rows — used by any page that renders analytics bars. */
export const BAR_CLASS: Record<BreakdownItem['tone'], string> = {
  good: 'bg-good',
  warn: 'bg-warn',
  bad: 'bg-bad',
  info: 'bg-primary',
  neutral: 'bg-muted-foreground',
  purple: 'bg-brand-purple',
  sky: 'bg-primary',
  teal: 'bg-good',
  amber: 'bg-warn',
};

export const TEXT_CLASS: Record<BreakdownItem['tone'], string> = {
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-primary',
  neutral: 'text-muted-foreground',
  purple: 'text-brand-purple',
  sky: 'text-primary',
  teal: 'text-good',
  amber: 'text-warn',
};
