import { useMemo, useState } from 'react';
import {
  Bell,
  ChartBar,
  Clock,
  Megaphone,
  Phone,
  PhoneCall,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';

import { getSession } from '@/api/session';
import { useImpersonation } from '@/context/ImpersonationProvider';
import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { StatusBadge, type StatusTone } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import {
  CALL_TO_ACTIONS,
  RANGE_LABEL,
  type Announcement,
  type AnnouncementType,
  type ActivityRange,
  greeting,
  workdayProgress,
} from './data';
import { InboxRow } from './InboxRow';
import { loadActivity, loadAnnouncements, loadSnapshot, useLoad, type InboxFeed } from './live';

const ANNOUNCEMENT_META: Record<AnnouncementType, { icon: typeof Sparkles; className: string; label: string }> = {
  ai: { icon: Sparkles, className: 'bg-primary/14 text-primary', label: 'AI' },
  policy: { icon: Megaphone, className: 'bg-purple-500/14 text-brand-purple', label: 'Policy' },
  system: { icon: Wrench, className: 'bg-warn/14 text-warn', label: 'System' },
  update: { icon: Bell, className: 'bg-good/14 text-good', label: 'Update' },
  analytics: { icon: ChartBar, className: 'bg-primary/14 text-primary', label: 'Analytics' },
  security: { icon: ShieldCheck, className: 'bg-bad/14 text-bad', label: 'Security' },
};

const PRIORITY_TONE: Record<string, StatusTone> = {
  critical: 'bad',
  high: 'warn',
  medium: 'info',
  low: 'good',
};

const SNAPSHOT_TONE_CLASS: Record<string, string> = {
  accent: 'text-primary',
  bad: 'text-bad',
  warn: 'text-warn',
  good: 'text-good',
  purple: 'text-brand-purple',
};

function SectionState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>;
  if (error)
    return (
      <div className="py-6 text-center text-sm">
        <p className="text-bad">{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  return null;
}

export function Home({
  inbox,
  onOpenAutomations,
  onOpenInbox,
}: {
  inbox: InboxFeed;
  onOpenAutomations: () => void;
  onOpenInbox: () => void;
}) {
  const { actingAs } = useImpersonation();
  const [range, setRange] = useState<ActivityRange>('weekly');
  const [openAnnouncement, setOpenAnnouncement] = useState<Announcement | null>(null);
  const now = useMemo(() => new Date(), []);
  const { pct, clock } = workdayProgress(now);
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  // The widget greets the EFFECTIVE user — the act-as target when an admin is switched.
  const displayName = actingAs?.name ?? getSession()?.worker.userName ?? 'there';
  const firstName = displayName.split(/\s+/)[0] ?? displayName;

  const snapshot = useLoad(loadSnapshot, []);
  const announcements = useLoad(loadAnnouncements, []);
  const activity = useLoad(() => loadActivity(range), [range]);

  const stats = activity.data;
  const activityTiles = stats
    ? [
        { icon: Phone, value: stats.calls, label: 'Calls' },
        { icon: PhoneCall, value: stats.notes, label: 'Notes' },
        { icon: Sparkles, value: stats.leadsCreated, label: 'Leads Created' },
        { icon: Bell, value: stats.leadsReceived, label: 'Leads Received' },
        { icon: Megaphone, value: stats.interested, label: 'Interested' },
        { icon: Wrench, value: stats.applications, label: 'Applications' },
        { icon: Clock, value: stats.tasksDone, label: 'Tasks Done' },
      ]
    : [];

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Hero */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col justify-center rounded-lg border bg-card p-6">
          <div className="text-xs font-semibold text-muted-foreground">{dateLabel}</div>
          <h1 className="font-heading mt-1.5 text-3xl font-bold">
            {greeting(now.getHours())}, {firstName}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Here&apos;s what&apos;s happening with your accounts today.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>Workday Progress</span>
            <span className="font-mono text-foreground">{clock}</span>
          </div>
          <div className="relative mt-4 h-2 w-full rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            <div
              className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-card bg-primary shadow"
              style={{ left: `calc(${pct}% - 6px)` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[10.5px] text-muted-foreground">
            <span>9:00 AM</span>
            <span className="font-mono font-bold text-primary">{pct}% complete</span>
            <span>6:00 PM</span>
          </div>
        </div>
      </div>

      {/* Announcements */}
      <div className="rounded-lg border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-heading flex items-center gap-2 text-sm font-bold">
            <Megaphone className="size-4 text-primary" />
            Updates &amp; Announcements
          </div>
          {announcements.data ? (
            <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10.5px] font-bold text-primary">
              {announcements.data.length}
            </span>
          ) : null}
        </div>
        <SectionState loading={announcements.loading} error={announcements.error} onRetry={announcements.reload} />
        {announcements.data && announcements.data.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">No announcements right now.</div>
        ) : null}
        <div className="flex gap-3 overflow-x-auto pb-1">
          {(announcements.data ?? []).map((a) => {
            const meta = ANNOUNCEMENT_META[a.type];
            const Icon = meta.icon;
            return (
              <button
                key={a.id}
                onClick={() => setOpenAnnouncement(a)}
                className="flex w-64 flex-none flex-col gap-2 rounded-md border bg-muted/30 p-3.5 text-left hover:bg-muted/50"
              >
                <span className={`flex size-8 items-center justify-center rounded-md ${meta.className}`}>
                  <Icon className="size-4" />
                </span>
                <div className="line-clamp-2 text-sm font-semibold leading-snug">{a.title}</div>
                <div className="text-[10.5px] text-muted-foreground">{a.time}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Today's Snapshot */}
      <div className="rounded-lg border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-heading text-sm font-bold">Today&apos;s Snapshot</div>
          <Button variant="ghost" size="sm" onClick={snapshot.reload} disabled={snapshot.loading}>
            <RotateCw className="size-3.5" />
            Refresh
          </Button>
        </div>
        <SectionState loading={snapshot.loading} error={snapshot.error} onRetry={snapshot.reload} />
        <div className="flex flex-col gap-4">
          {(snapshot.data?.groups ?? []).map((g) => (
            <div key={g.title}>
              <div className="mb-2 text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">{g.title}</div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {g.cells.map((c) => (
                  <div key={c.label} className="rounded-md border bg-muted/30 px-3 py-2.5">
                    <div className={`font-heading text-xl font-bold ${SNAPSHOT_TONE_CLASS[c.tone]}`}>{c.value}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{c.label}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Activity */}
      <div className="rounded-lg border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-heading text-sm font-bold">Activity</div>
          <div className="flex gap-1 rounded-md border bg-muted/30 p-1">
            {(['daily', 'weekly', 'monthly'] as ActivityRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                  range === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
        <SectionState loading={activity.loading} error={activity.error} onRetry={activity.reload} />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
          {activityTiles.map((t) => (
            <div key={t.label} className="flex flex-col items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-3 text-center">
              <t.icon className="size-4 text-primary" />
              <div className="font-heading text-lg font-bold">{t.value}</div>
              <div className="text-[9.5px] text-muted-foreground uppercase">{t.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Call to Action */}
      <div>
        <div className="font-heading mb-3 text-sm font-bold">Call to Action</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {CALL_TO_ACTIONS.map((cta) => (
            <div key={cta.id} className="rounded-lg border bg-card p-4">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {cta.codes.map((c) => (
                  <span key={c} className="rounded-md border bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-bold text-secondary-foreground">
                    {c}
                  </span>
                ))}
                {cta.top ? (
                  <span className="rounded-md border border-warn/30 bg-warn/10 px-1.5 py-0.5 text-[10px] font-bold text-warn">TOP</span>
                ) : null}
              </div>
              <div className="font-semibold">{cta.name}</div>
              <p className="mt-1 text-xs text-muted-foreground">{cta.desc}</p>
              <div className="mt-2 text-[10.5px] text-muted-foreground">{cta.meta}</div>
              <Button variant="outline" size="sm" className="mt-3" onClick={onOpenAutomations}>
                Open Automation
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Inbox */}
      <div className="rounded-lg border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-heading text-sm font-bold">
            Recent Inbox
            {inbox.unread > 0 ? (
              <span className="ml-2 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                {inbox.unread} unread
              </span>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onOpenInbox}>
            View all
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {inbox.loading ? (
            <div className="py-4 text-center text-sm text-muted-foreground">Loading…</div>
          ) : inbox.items.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">All caught up!</div>
          ) : (
            inbox.items.slice(0, 3).map((item) => <InboxRow key={item.id} item={item} onClick={() => onOpenInbox()} />)
          )}
        </div>
      </div>

      {openAnnouncement ? (
        <AnnouncementModal announcement={openAnnouncement} onClose={() => setOpenAnnouncement(null)} />
      ) : null}
    </div>
  );
}

function AnnouncementModal({ announcement, onClose }: { announcement: Announcement; onClose: () => void }) {
  const meta = ANNOUNCEMENT_META[announcement.type];
  const Icon = meta.icon;
  const priorityTone = announcement.priority ? PRIORITY_TONE[announcement.priority] : undefined;
  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={announcement.title}
      subtitle={announcement.time}
      size="md"
      badges={
        <>
          <span className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10.5px] font-bold ${meta.className}`}>
            <Icon className="size-3.5" />
            {meta.label}
          </span>
          {priorityTone ? <StatusBadge tone={priorityTone}>{announcement.priority}</StatusBadge> : null}
        </>
      }
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="whitespace-pre-line text-sm leading-relaxed text-foreground">{announcement.content}</div>
    </DetailDialog>
  );
}
