import { useMemo, useState } from 'react';
import {
  listSalesAnnouncements,
  markSalesAnnouncementRead,
  type MytrionAnnouncementDto,
} from '../../../api/announcements';
import { Badge } from '../../../ds/Badge/Badge';
import { Button } from '../../../ds/Button/Button';
import { Dialog } from '../../../ds/Dialog/Dialog';
import { EmptyState } from '../../../ds/EmptyState/EmptyState';
import { Icon } from '../../../ds/Icon/Icon';
import { Skeleton } from '../../../ds/Skeleton/Skeleton';
import { Markdown } from '../../../features/chat/Markdown';
import { useLoad } from '../../_shared/useLoad';
import './salesAnnouncements.css';

function formatDate(value: string, includeYear = false): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
  });
}

function plainTextExcerpt(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[*_~`>#]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function AnnouncementCard({
  announcement,
  onOpen,
}: {
  announcement: MytrionAnnouncementDto;
  onOpen: (announcement: MytrionAnnouncementDto) => void;
}) {
  return (
    <button
      type="button"
      className="sa-card ss-card-h"
      data-priority={announcement.priority}
      onClick={() => onOpen(announcement)}
    >
      <span className="sa-card-icon" aria-hidden="true">
        <Icon name="campaign" />
      </span>
      <span className="sa-card-copy">
        <span className="sa-card-title-row">
          <span className="sa-card-title">{announcement.title}</span>
          {announcement.read ? null : (
            <Badge intent="accent" size="sm">
              New
            </Badge>
          )}
          {announcement.priority === 'high' ? (
            <Badge intent="warning" size="sm">
              High
            </Badge>
          ) : null}
        </span>
        <span className="sa-card-meta">
          {formatDate(announcement.publishedAt)} · {announcement.targetDepartments.join(', ')}
        </span>
        <span className="sa-card-excerpt">{plainTextExcerpt(announcement.body)}</span>
      </span>
      <Icon name="chevron_right" />
    </button>
  );
}

export function SalesAnnouncementCenter() {
  const announcements = useLoad(() => listSalesAnnouncements(), []);
  const [view, setView] = useState<'new' | 'archive'>('new');
  const [selected, setSelected] = useState<MytrionAnnouncementDto | null>(null);
  const [markingRead, setMarkingRead] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const rows = announcements.data ?? [];
  const unread = useMemo(() => rows.filter((announcement) => !announcement.read), [rows]);
  const archived = useMemo(() => rows.filter((announcement) => announcement.read), [rows]);
  const visible = view === 'new' ? unread : archived;

  const gotIt = async (): Promise<void> => {
    if (!selected || selected.read) return;
    setMarkingRead(true);
    setReadError(null);
    try {
      await markSalesAnnouncementRead(selected.id);
      setSelected(null);
      setView('archive');
      announcements.reload();
    } catch (error) {
      setReadError(error instanceof Error ? error.message : 'Could not archive the announcement.');
    } finally {
      setMarkingRead(false);
    }
  };

  return (
    <section className="sa-root" aria-labelledby="sales-announcements-title">
      <header className="sa-heading">
        <div className="sa-title" id="sales-announcements-title">
          <Icon name="notifications" /> Updates &amp; announcements
        </div>
        <nav className="sa-tabs" aria-label="Announcement views">
          <button type="button" aria-pressed={view === 'new'} onClick={() => setView('new')}>
            New <span>{unread.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={view === 'archive'}
            onClick={() => setView('archive')}
          >
            <Icon name="archive" size="sm" /> Archive <span>{archived.length}</span>
          </button>
        </nav>
      </header>

      <div className="sa-list" aria-busy={announcements.loading || undefined}>
        {announcements.loading ? (
          <>
            <Skeleton variant="rect" height="var(--space-16)" radius="panel" />
            <Skeleton variant="rect" height="var(--space-16)" radius="panel" />
          </>
        ) : announcements.error ? (
          <EmptyState
            size="panel"
            tone="error"
            title="Couldn’t load announcements"
            description="Retry after checking your connection."
            primaryAction={
              <Button variant="primary" onClick={announcements.reload}>
                Retry
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            size="panel"
            icon={view === 'archive' ? 'archive' : 'notifications'}
            title={view === 'archive' ? 'Archive is empty' : 'You’re all caught up'}
            description={
              view === 'archive'
                ? 'Announcements move here after you select Got it.'
                : 'New targeted announcements will appear here.'
            }
          />
        ) : (
          visible.map((announcement) => (
            <AnnouncementCard
              key={announcement.id}
              announcement={announcement}
              onOpen={(next) => {
                setSelected(next);
                setReadError(null);
              }}
            />
          ))
        )}
      </div>

      <Dialog
        open={selected != null}
        onClose={() => {
          if (!markingRead) setSelected(null);
        }}
        title={selected?.title ?? 'Announcement'}
        subtitle={
          selected
            ? `${formatDate(selected.publishedAt, true)} · ${selected.targetDepartments.join(', ')}`
            : undefined
        }
        size="md"
        mobile="sheet"
        dismissible={!markingRead}
        footer={
          <>
            <Button variant="secondary" disabled={markingRead} onClick={() => setSelected(null)}>
              Close
            </Button>
            {selected?.read ? null : (
              <Button variant="primary" loading={markingRead} onClick={() => void gotIt()}>
                Got it
              </Button>
            )}
          </>
        }
      >
        {selected ? (
          <article className="sa-detail" data-priority={selected.priority}>
            <div className="sa-detail-kicker">
              <span>Announcement</span>
              {selected.priority === 'high' ? (
                <Badge intent="warning">High priority</Badge>
              ) : (
                <Badge intent="neutral">Standard priority</Badge>
              )}
            </div>
            <Markdown text={selected.body} />
            {readError ? (
              <p className="sa-detail-error" role="alert">
                {readError}
              </p>
            ) : null}
          </article>
        ) : null}
      </Dialog>
    </section>
  );
}
