import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  MailCheck,
  ThumbsDown,
  UserCheck,
  XOctagon,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { Button } from '@/components/ui/button';
import {
  ALERT_TYPES,
  NOTIFICATIONS,
  type NotificationType,
  type RetentionNotification,
  unreadCount,
} from './data';

const TYPE_META: Record<NotificationType, { icon: LucideIcon; tone: 'bad' | 'warn' | 'good' | 'info' | 'neutral' }> = {
  risk: { icon: AlertTriangle, tone: 'bad' },
  accepted: { icon: CheckCircle2, tone: 'good' },
  competitor: { icon: Zap, tone: 'warn' },
  assigned: { icon: UserCheck, tone: 'info' },
  declined: { icon: ThumbsDown, tone: 'bad' },
  churned: { icon: XOctagon, tone: 'bad' },
  resumed: { icon: MailCheck, tone: 'good' },
  reminder: { icon: Clock3, tone: 'warn' },
};

const TONE_CLASS: Record<string, string> = {
  bad: 'bg-bad/12 text-bad',
  warn: 'bg-warn/12 text-warn',
  good: 'bg-good/12 text-good',
  info: 'bg-primary/12 text-primary',
  neutral: 'bg-muted text-muted-foreground',
};

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'alerts', label: 'Alerts' },
];

export function Inbox() {
  const [notifications, setNotifications] = useState<RetentionNotification[]>(NOTIFICATIONS);
  const [filter, setFilter] = useState<'all' | 'unread' | 'alerts'>('all');

  const filtered = useMemo(() => {
    let rows = notifications;
    if (filter === 'unread') rows = rows.filter((n) => !n.read);
    else if (filter === 'alerts') rows = rows.filter((n) => ALERT_TYPES.includes(n.type));
    return rows;
  }, [notifications, filter]);

  const today = filtered.filter((n) => n.group === 'today');
  const earlier = filtered.filter((n) => n.group === 'earlier');
  const unread = unreadCount(notifications);

  function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }

  function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Inbox</h2>
          <p className="text-sm text-muted-foreground">{unread} unread · retention alerts &amp; updates</p>
        </div>
        <Button variant="outline" disabled={unread === 0} onClick={markAllRead}>
          Mark all read
        </Button>
      </div>

      <SegmentedFilter options={FILTERS} value={filter} onChange={(id) => setFilter(id as 'all' | 'unread' | 'alerts')} />

      <div className="flex flex-col gap-5">
        <NotificationGroup title="Today" items={today} onRead={markRead} />
        <NotificationGroup title="Earlier" items={earlier} onRead={markRead} />
        {filtered.length === 0 ? (
          <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
            No notifications match this filter.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NotificationGroup({
  title,
  items,
  onRead,
}: {
  title: string;
  items: RetentionNotification[];
  onRead: (id: string) => void;
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
              type="button"
              onClick={() => onRead(n.id)}
              className={`flex w-full items-start gap-3 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted/40 ${
                n.read ? '' : 'bg-primary/5'
              }`}
            >
              <span className={`flex size-8 flex-none items-center justify-center rounded-md ${TONE_CLASS[meta.tone]}`}>
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {!n.read ? <span className="size-1.5 flex-none rounded-full bg-primary" /> : null}
                  <span className="truncate font-semibold">{n.title}</span>
                </div>
                <div className="truncate text-[12px] text-muted-foreground">{n.detail}</div>
              </div>
              <span className="flex-none text-[10.5px] text-muted-foreground">{n.time}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
