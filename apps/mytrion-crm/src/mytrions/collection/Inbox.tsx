import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArchiveX,
  BellRing,
  CheckCheck,
  Clock3,
  FileWarning,
  HandCoins,
  MessageSquareText,
  PartyPopper,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { Button } from '@/components/ui/button';
import { INBOX, type InboxNotification, type InboxType } from './data';

const ALERT_TYPES: InboxType[] = ['handoff', 'clock', 'writeoff', 'plan-missed', 'array-none'];

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'alerts', label: 'Alerts' },
];

const TYPE_META: Record<InboxType, { icon: LucideIcon; color: string; bg: string }> = {
  handoff: { icon: HandCoins, color: 'text-bad', bg: 'bg-bad/12' },
  paid: { icon: PartyPopper, color: 'text-good', bg: 'bg-good/12' },
  'array-full': { icon: CheckCheck, color: 'text-good', bg: 'bg-good/12' },
  clock: { icon: Clock3, color: 'text-warn', bg: 'bg-warn/12' },
  'plan-missed': { icon: AlertTriangle, color: 'text-bad', bg: 'bg-bad/12' },
  'array-none': { icon: ArchiveX, color: 'text-muted-foreground', bg: 'bg-muted' },
  writeoff: { icon: FileWarning, color: 'text-muted-foreground', bg: 'bg-muted' },
  promise: { icon: MessageSquareText, color: 'text-primary', bg: 'bg-primary/12' },
};

export function Inbox() {
  const [items, setItems] = useState<InboxNotification[]>(INBOX);
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    if (filter === 'unread') return items.filter((n) => !n.read);
    if (filter === 'alerts') return items.filter((n) => ALERT_TYPES.includes(n.type));
    return items;
  }, [items, filter]);

  const today = filtered.filter((n) => n.group === 'today');
  const earlier = filtered.filter((n) => n.group === 'earlier');
  const unreadCount = items.filter((n) => !n.read).length;

  function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }

  function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Inbox</h2>
          <p className="text-sm text-muted-foreground">
            {unreadCount} unread · collection alerts &amp; recovery updates
          </p>
        </div>
        {unreadCount > 0 ? (
          <Button variant="outline" onClick={markAllRead}>
            <BellRing className="size-4" />
            Mark all read
          </Button>
        ) : null}
      </div>

      <SegmentedFilter options={FILTERS} value={filter} onChange={setFilter} />

      <div className="flex flex-col gap-5">
        <NotifGroup title="Today" items={today} onOpen={markRead} />
        <NotifGroup title="Earlier" items={earlier} onOpen={markRead} />
        {filtered.length === 0 ? (
          <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
            No notifications to show.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NotifGroup({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: InboxNotification[];
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 px-0.5">
        <span className="font-heading text-xs font-bold tracking-wide text-foreground uppercase">{title}</span>
        <span className="text-[11px] text-muted-foreground">{items.length}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        {items.map((n) => {
          const meta = TYPE_META[n.type];
          const Icon = meta.icon;
          return (
            <button
              key={n.id}
              onClick={() => onOpen(n.id)}
              className="flex w-full items-start gap-3 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted/40"
            >
              <span className={`flex size-8 flex-none items-center justify-center rounded-md ${meta.bg} ${meta.color}`}>
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{n.title}</div>
                <div className="truncate text-[12px] text-muted-foreground">{n.detail}</div>
              </div>
              <div className="flex flex-none flex-col items-end gap-1.5">
                <span className="font-mono text-[10.5px] text-muted-foreground">{n.time}</span>
                {!n.read ? <span className="size-2 flex-none rounded-full bg-primary" /> : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
