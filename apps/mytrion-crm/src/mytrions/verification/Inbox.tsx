import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Bell,
  CheckCheck,
  CheckCircle2,
  FileCheck,
  FileText,
  RotateCcw,
  ShieldAlert,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatCard } from '@/components/mytrion/stat-card';
import { Button } from '@/components/ui/button';
import { ToastViewport, useToast } from './Toast';
import { NOTIFICATIONS, type NotificationType, type VerificationNotification } from './data';

const TYPE_ICON: Record<NotificationType, LucideIcon> = {
  'new-app': FileText,
  docs: FileCheck,
  insurance: ShieldAlert,
  wex: TrendingUp,
  limit: TrendingUp,
  blacklist: Ban,
  decision: CheckCircle2,
  reactivation: RotateCcw,
};

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'alerts', label: 'Alerts' },
];

export function Inbox() {
  const [items, setItems] = useState<VerificationNotification[]>(NOTIFICATIONS);
  const [filter, setFilter] = useState('all');
  const { toast, show } = useToast();

  const filtered = useMemo(() => {
    if (filter === 'unread') return items.filter((n) => !n.read);
    if (filter === 'alerts') return items.filter((n) => n.alert);
    return items;
  }, [items, filter]);

  const grouped = useMemo(() => {
    const today = filtered.filter((n) => n.group === 'today');
    const earlier = filtered.filter((n) => n.group === 'earlier');
    return { today, earlier };
  }, [filtered]);

  const unreadCount = items.filter((n) => !n.read).length;

  function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }

  function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    show('success', 'All notifications marked as read.');
  }

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Inbox</h2>
          <p className="text-sm text-muted-foreground">{unreadCount} unread · verification notifications</p>
        </div>
        <Button variant="outline" size="sm" onClick={markAllRead} disabled={unreadCount === 0}>
          <CheckCheck className="size-3.5" />
          Mark all read
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard icon={Bell} value={String(items.length)} label="Total Notifications" tint="primary" />
        <StatCard icon={FileText} value={String(unreadCount)} label="Unread" tint="warn" />
        <StatCard icon={AlertTriangle} value={String(items.filter((n) => n.alert).length)} label="Alerts" tint="bad" />
      </div>

      <SegmentedFilter options={FILTERS} value={filter} onChange={setFilter} />

      <div className="flex flex-col gap-5">
        <NotificationGroup label="Today" items={grouped.today} onRead={markRead} />
        <NotificationGroup label="Earlier" items={grouped.earlier} onRead={markRead} />
        {filtered.length === 0 ? (
          <div className="rounded-xs border bg-card p-10 text-center text-sm text-muted-foreground">
            No notifications match this filter.
          </div>
        ) : null}
      </div>

      <ToastViewport toast={toast} />
    </div>
  );
}

function NotificationGroup({
  label,
  items,
  onRead,
}: {
  label: string;
  items: VerificationNotification[];
  onRead: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 px-0.5">
        <span className="font-heading text-xs font-bold tracking-wide text-foreground uppercase">{label}</span>
        <span className="text-[11px] text-muted-foreground">{items.length}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="overflow-hidden rounded-xs border bg-card">
        {items.map((n) => {
          const Icon = TYPE_ICON[n.type];
          return (
            <button
              key={n.id}
              onClick={() => onRead(n.id)}
              className="flex w-full items-start gap-3 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted/40"
            >
              <span
                className={`mt-0.5 flex size-8 flex-none items-center justify-center rounded-xs ${
                  n.alert ? 'bg-bad/14 text-bad' : 'bg-primary/12 text-primary'
                }`}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`truncate font-semibold ${n.read ? 'text-muted-foreground' : 'text-foreground'}`}>{n.title}</span>
                  {!n.read ? <span className="size-1.5 flex-none rounded-full bg-primary" /> : null}
                </div>
                <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{n.detail}</div>
              </div>
              <span className="flex-none text-[11px] text-muted-foreground">{n.time}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
