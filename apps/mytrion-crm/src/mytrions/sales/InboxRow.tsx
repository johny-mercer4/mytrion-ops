import { AlertTriangle, Banknote, CheckSquare, UserPlus } from 'lucide-react';

import { StatusBadge, type StatusTone } from '@/components/mytrion/status-badge';
import { cn } from '@/lib/utils';
import type { InboxItem, InboxPriority, InboxType } from './data';

// Shared inbox row — used by both Home's "Recent Inbox" preview and the full Inbox list.

const TYPE_META: Record<InboxType, { icon: typeof AlertTriangle; className: string }> = {
  alert: { icon: AlertTriangle, className: 'bg-bad/14 text-bad' },
  billing: { icon: Banknote, className: 'bg-primary/14 text-primary' },
  task: { icon: CheckSquare, className: 'bg-warn/14 text-warn' },
  lead: { icon: UserPlus, className: 'bg-good/14 text-good' },
};

const PRIORITY_BAR: Record<InboxPriority, string> = {
  critical: 'bg-bad',
  high: 'bg-warn',
  medium: 'bg-primary',
  low: 'bg-brand-purple',
  normal: 'bg-border',
};

const PRIORITY_TONE: Record<InboxPriority, StatusTone> = {
  critical: 'bad',
  high: 'warn',
  medium: 'info',
  low: 'neutral',
  normal: 'neutral',
};

export function InboxRow({ item, onClick }: { item: InboxItem; onClick: (item: InboxItem) => void }) {
  const meta = TYPE_META[item.type];
  const Icon = meta.icon;
  return (
    <button
      onClick={() => onClick(item)}
      className="flex w-full items-stretch gap-3 overflow-hidden rounded-xs border bg-muted/30 text-left hover:bg-muted/50"
    >
      <span className={cn('w-1 flex-none', PRIORITY_BAR[item.priority])} />
      <span className={cn('mt-2.5 mb-2.5 flex size-8 flex-none items-center justify-center rounded-xs', meta.className)}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 py-2.5 pr-3">
        <div className="flex items-center gap-1.5">
          {item.unread ? <span className="size-1.5 flex-none rounded-full bg-primary" /> : null}
          <span className="truncate text-sm font-semibold">{item.title}</span>
        </div>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.desc}</p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">{item.time}</span>
          <StatusBadge tone={PRIORITY_TONE[item.priority]}>{item.priority}</StatusBadge>
          <span className="rounded-xs border bg-secondary px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-secondary-foreground">
            {item.tag}
          </span>
        </div>
      </div>
    </button>
  );
}
