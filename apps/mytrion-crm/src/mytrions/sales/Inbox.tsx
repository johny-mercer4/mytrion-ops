import { useMemo, useState } from 'react';
import { CheckCheck, Radio } from 'lucide-react';

import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatusBadge, type StatusTone } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import { INBOX_ITEMS, type InboxItem, type InboxPriority } from './data';
import { InboxRow } from './InboxRow';

type Filter = 'all' | 'unread' | 'alert' | 'task' | 'billing';

const PRIORITY_TONE: Record<InboxPriority, StatusTone> = {
  critical: 'bad',
  high: 'warn',
  medium: 'info',
  low: 'neutral',
  normal: 'neutral',
};

export function Inbox() {
  const [items, setItems] = useState<InboxItem[]>(INBOX_ITEMS);
  const [filter, setFilter] = useState<Filter>('all');
  const [openItem, setOpenItem] = useState<InboxItem | null>(null);

  const counts = useMemo(
    () => ({
      all: items.length,
      unread: items.filter((i) => i.unread).length,
      alert: items.filter((i) => i.type === 'alert').length,
      task: items.filter((i) => i.type === 'task').length,
      billing: items.filter((i) => i.type === 'billing').length,
    }),
    [items],
  );

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'unread') return items.filter((i) => i.unread);
    return items.filter((i) => i.type === filter);
  }, [items, filter]);

  function markAllRead() {
    setItems((prev) => prev.map((i) => ({ ...i, unread: false })));
  }

  function openAndRead(item: InboxItem) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, unread: false } : i)));
    setOpenItem(item);
  }

  const filterOptions = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'unread', label: 'Unread', count: counts.unread },
    { id: 'alert', label: 'Alerts', count: counts.alert },
    { id: 'task', label: 'Tasks', count: counts.task },
    { id: 'billing', label: 'Billing', count: counts.billing },
  ];

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Inbox</h2>
          <p className="text-sm text-muted-foreground">Reminders, alerts &amp; tasks assigned to you</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-xs border border-good/30 bg-good/10 px-2.5 py-1 text-[10.5px] font-bold text-good">
            <Radio className="size-3" />
            Live
          </span>
          <Button variant="outline" size="sm" onClick={markAllRead}>
            <CheckCheck className="size-3.5" />
            Mark all read
          </Button>
        </div>
      </div>

      <SegmentedFilter options={filterOptions} value={filter} onChange={(v) => setFilter(v as Filter)} />

      <div className="flex flex-col gap-2">
        {filtered.length === 0 ? (
          <div className="rounded-xs border bg-card p-10 text-center text-sm text-muted-foreground">
            Nothing here. You&apos;re all caught up.
          </div>
        ) : (
          filtered.map((item) => <InboxRow key={item.id} item={item} onClick={openAndRead} />)
        )}
      </div>

      {openItem ? <InboxDetail item={openItem} onClose={() => setOpenItem(null)} /> : null}
    </div>
  );
}

function InboxDetail({ item, onClose }: { item: InboxItem; onClose: () => void }) {
  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={item.title}
      subtitle={item.time}
      size="md"
      badges={
        <>
          <StatusBadge tone={PRIORITY_TONE[item.priority]}>{item.priority}</StatusBadge>
          <span className="rounded-xs border bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-bold text-secondary-foreground">
            {item.tag}
          </span>
        </>
      }
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <p className="text-sm leading-relaxed text-foreground">{item.desc}</p>
    </DetailDialog>
  );
}
