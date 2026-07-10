import { useMemo, useState } from 'react';
import { CheckCheck, ExternalLink, RotateCw } from 'lucide-react';

import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatusBadge, type StatusTone } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import type { InboxPriority } from './data';
import { InboxRow } from './InboxRow';
import type { InboxFeed, LiveInboxItem } from './live';
import { useToast } from './Toast';

// Widget filter tabs: All / Unread / Tasks / Alerts (warning+critical) / Reminders (reminder+info).
type Filter = 'all' | 'unread' | 'task' | 'alerts' | 'reminders';

const PRIORITY_TONE: Record<InboxPriority, StatusTone> = {
  critical: 'bad',
  high: 'warn',
  medium: 'info',
  low: 'neutral',
  normal: 'neutral',
};

export function Inbox({ feed }: { feed: InboxFeed }) {
  const { items, loading, error, reload } = feed;
  const { push } = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [openItem, setOpenItem] = useState<LiveInboxItem | null>(null);

  const counts = useMemo(
    () => ({
      all: items.length,
      unread: items.filter((i) => i.unread).length,
      task: items.filter((i) => i.type === 'task').length,
      alerts: items.filter((i) => i.type === 'warning' || i.type === 'critical').length,
      reminders: items.filter((i) => i.type === 'reminder' || i.type === 'info').length,
    }),
    [items],
  );

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'unread') return items.filter((i) => i.unread);
    if (filter === 'task') return items.filter((i) => i.type === 'task');
    if (filter === 'alerts') return items.filter((i) => i.type === 'warning' || i.type === 'critical');
    return items.filter((i) => i.type === 'reminder' || i.type === 'info');
  }, [items, filter]);

  function openAndRead(item: LiveInboxItem) {
    feed.markRead(item.id);
    setOpenItem(item);
  }

  const filterOptions = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'unread', label: 'Unread', count: counts.unread },
    { id: 'task', label: 'Tasks', count: counts.task },
    { id: 'alerts', label: 'Alerts', count: counts.alerts },
    { id: 'reminders', label: 'Reminders', count: counts.reminders },
  ];

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Inbox</h2>
          <p className="text-sm text-muted-foreground">Reminders, alerts &amp; tasks assigned to you</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={reload} disabled={loading}>
            <RotateCw className="size-3.5" />
            Refresh
          </Button>
          {counts.unread > 0 ? (
            <Button variant="outline" size="sm" onClick={feed.markAllRead}>
              <CheckCheck className="size-3.5" />
              Mark all read
            </Button>
          ) : null}
        </div>
      </div>

      <SegmentedFilter options={filterOptions} value={filter} onChange={(v) => setFilter(v as Filter)} />

      <div className="flex flex-col gap-2">
        {loading ? (
          <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">Loading inbox…</div>
        ) : error ? (
          <div className="rounded-lg border bg-card p-10 text-center text-sm">
            <p className="text-bad">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={reload}>
              Retry
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
            All caught up! Nothing here.
          </div>
        ) : (
          filtered.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              onClick={openAndRead}
              onDelete={(it) => feed.remove(it, (msg) => push('error', msg))}
            />
          ))
        )}
      </div>

      {openItem ? <InboxDetail item={openItem} onClose={() => setOpenItem(null)} /> : null}
    </div>
  );
}

function InboxDetail({ item, onClose }: { item: LiveInboxItem; onClose: () => void }) {
  // Widget behavior: the record CTA is shown only for task/reminder types with a sourceUrl.
  const cta = (item.type === 'task' || item.type === 'reminder') && item.sourceUrl ? item.sourceUrl : null;
  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={item.title}
      subtitle={item.time}
      size="md"
      badges={
        <>
          {item.priority !== 'normal' ? (
            <StatusBadge tone={PRIORITY_TONE[item.priority]}>{item.priority}</StatusBadge>
          ) : null}
          {item.tag ? (
            <span className="rounded-md border bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-bold text-secondary-foreground">
              {item.tag}
            </span>
          ) : null}
        </>
      }
      footer={
        <>
          {cta ? (
            <Button onClick={() => window.open(cta, '_blank', 'noopener')}>
              <ExternalLink className="size-3.5" />
              {item.type === 'task' ? 'Open Task' : 'Open Record'}
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{item.desc}</p>
    </DetailDialog>
  );
}
