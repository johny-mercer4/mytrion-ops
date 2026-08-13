import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  listManagerAnnouncements,
  publishManagerAnnouncement,
  type AnnouncementDepartment,
  type AnnouncementPriority,
  type MytrionAnnouncementDto,
} from '../../../api/announcements';
import { Badge } from '../../../ds/Badge/Badge';
import { Button } from '../../../ds/Button/Button';
import { Checkbox } from '../../../ds/Checkbox/Checkbox';
import { EmptyState } from '../../../ds/EmptyState/EmptyState';
import { Icon } from '../../../ds/Icon/Icon';
import { Input } from '../../../ds/Input/Input';
import { Skeleton } from '../../../ds/Skeleton/Skeleton';
import { useLoad } from '../../_shared/useLoad';
import { AnnouncementContent } from './AnnouncementContent';
import { AnnouncementRichEditor } from './AnnouncementRichEditor';
import './announcementsBlock.css';

const DEPARTMENTS: ReadonlyArray<{ id: AnnouncementDepartment; label: string }> = [
  { id: 'sales', label: 'Sales' },
  { id: 'customer-service', label: 'Customer Service' },
  { id: 'billing', label: 'Billing' },
  { id: 'collection', label: 'Collection' },
  { id: 'finance', label: 'Finance' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'verification', label: 'Verification' },
];

function dateLabel(value: string): string {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function detailedDateLabel(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function departmentLabel(ids: AnnouncementDepartment[]): string {
  return ids
    .map((id) => DEPARTMENTS.find((department) => department.id === id)?.label ?? id)
    .join(' · ');
}

function AnnouncementPreview({
  title,
  body,
  priority,
}: {
  title: string;
  body: string;
  priority: AnnouncementPriority;
}) {
  return (
    <article className="an-preview-card" data-priority={priority}>
      <div className="an-preview-kicker">
        <span>Announcement</span>
        {priority === 'high' ? (
          <Badge intent="warning" size="sm">
            High priority
          </Badge>
        ) : null}
      </div>
      <h3>{title.trim() || 'Your announcement title'}</h3>
      <time>{dateLabel(new Date().toISOString())}</time>
      <div className="an-preview-body">
        {body.trim() ? (
          <AnnouncementContent text={body} />
        ) : (
          <p>Your message preview updates as you type.</p>
        )}
      </div>
    </article>
  );
}

function PublishedList({ announcements }: { announcements: MytrionAnnouncementDto[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (announcements.length === 0) {
    return (
      <EmptyState
        size="panel"
        title="No announcements published"
        description="Compose the first announcement above and publish it to a department."
      />
    );
  }
  return (
    <div className="an-published-list">
      {announcements.map((announcement) => {
        const expanded = selectedId === announcement.id;
        const detailId = `announcement-detail-${announcement.id}`;
        const audience = departmentLabel(announcement.targetDepartments);
        return (
          <article
            className="an-published-row"
            data-expanded={expanded || undefined}
            key={announcement.id}
          >
            <button
              type="button"
              className="an-published-summary"
              aria-expanded={expanded}
              aria-controls={detailId}
              onClick={() => setSelectedId(expanded ? null : announcement.id)}
            >
              <span className="an-published-copy">
                <span className="an-published-title">
                  {announcement.title}
                  {announcement.priority === 'high' ? (
                    <Badge intent="warning" size="sm">
                      High
                    </Badge>
                  ) : null}
                </span>
                <span className="an-published-meta">{audience}</span>
              </span>
              <span className="an-published-stats">
                <span>{announcement.viewCount ?? 0} views</span>
                <time dateTime={announcement.publishedAt}>
                  {dateLabel(announcement.publishedAt)}
                </time>
              </span>
              <span className="an-published-action" aria-hidden="true">
                <Icon name="visibility" size="sm" />
                <span>{expanded ? 'Hide' : 'View'}</span>
                <Icon name="expand_more" size="sm" />
              </span>
            </button>
            {expanded ? (
              <div className="an-published-detail" id={detailId}>
                <dl className="an-published-detail-meta">
                  <div>
                    <dt>Audience</dt>
                    <dd>{audience}</dd>
                  </div>
                  <div>
                    <dt>Published</dt>
                    <dd>
                      <time dateTime={announcement.publishedAt}>
                        {detailedDateLabel(announcement.publishedAt)}
                      </time>
                    </dd>
                  </div>
                  <div>
                    <dt>Views</dt>
                    <dd>{announcement.viewCount ?? 0}</dd>
                  </div>
                </dl>
                <div className="an-published-detail-body">
                  <AnnouncementContent text={announcement.body} />
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export function AnnouncementsBlock() {
  const announcements = useLoad(() => listManagerAnnouncements(), []);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targets, setTargets] = useState<AnnouncementDepartment[]>([]);
  const [priority, setPriority] = useState<AnnouncementPriority>('normal');
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<'compose' | 'preview'>('compose');
  const [editorExpanded, setEditorExpanded] = useState(false);
  const markdownInputRef = useRef<HTMLInputElement>(null);
  const valid =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    body.length <= 10_000 &&
    targets.length > 0;
  const allSelected = targets.length === DEPARTMENTS.length;
  const selectedLabel = useMemo(
    () =>
      DEPARTMENTS.filter((department) => targets.includes(department.id))
        .map((department) => department.label)
        .join(', '),
    [targets],
  );

  const toggleTarget = (id: AnnouncementDepartment): void => {
    setTargets((current) =>
      current.includes(id) ? current.filter((target) => target !== id) : [...current, id],
    );
    setMessage(null);
  };

  const importMarkdown = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!/\.(?:md|markdown)$/i.test(file.name)) {
      setMessage('Choose a Markdown file ending in .md or .markdown.');
      return;
    }
    if (file.size > 1_000_000) {
      setMessage('Choose a Markdown file smaller than 1 MB.');
      return;
    }
    try {
      const { markdownToAnnouncement } = await import('./markdownImport');
      const imported = markdownToAnnouncement(await file.text());
      const nextBody = body.trim() ? `${body}<hr>${imported.html}` : imported.html;
      if (nextBody.length > 10_000) {
        setMessage('The imported article would exceed the 10,000 HTML character limit.');
        return;
      }
      setBody(nextBody);
      if (!title.trim() && imported.title) setTitle(imported.title.slice(0, 200));
      setMessage(
        body.trim()
          ? `Imported ${file.name} below the current draft.`
          : `Imported ${file.name}.`,
      );
    } catch {
      setMessage('Could not read that Markdown file.');
    }
  };

  const publish = async (): Promise<void> => {
    if (!valid) {
      setMessage(
        body.length > 10_000
          ? 'Shorten the message to 10,000 HTML characters before publishing.'
          : 'Add a title, message, and at least one target department.',
      );
      return;
    }
    setPublishing(true);
    setMessage(null);
    try {
      await publishManagerAnnouncement({
        title: title.trim(),
        body: body.trim(),
        targetDepartments: targets,
        priority,
      });
      setTitle('');
      setBody('');
      setPriority('normal');
      setMessage(`Published to ${selectedLabel}.`);
      announcements.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not publish the announcement.');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <section className="an-root" aria-label="Announcements workspace">
      <div className="an-mobile-tabs" role="tablist" aria-label="Announcement composer views">
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'compose'}
          onClick={() => setMobilePane('compose')}
        >
          Compose
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'preview'}
          onClick={() => setMobilePane('preview')}
        >
          Preview
        </button>
      </div>

      <div
        className="an-layout"
        data-mobile-pane={mobilePane}
        data-editor-expanded={editorExpanded || undefined}
      >
        <form
          className="an-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void publish();
          }}
        >
          <header className="an-panel-head an-composer-head">
            <span>New announcement</span>
            <span className="an-composer-tools">
              <input
                ref={markdownInputRef}
                className="an-import-input"
                type="file"
                accept=".md,.markdown,text/markdown,text/plain"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(event) => void importMarkdown(event)}
              />
              <Button
                className="an-import-markdown"
                size="sm"
                variant="ghost"
                icon="description"
                onClick={() => markdownInputRef.current?.click()}
              >
                Import Markdown
              </Button>
              <Button
                className="an-editor-expand"
                size="sm"
                variant="ghost"
                icon={editorExpanded ? 'close_fullscreen' : 'open_in_full'}
                aria-pressed={editorExpanded}
                onClick={() => setEditorExpanded((expanded) => !expanded)}
              >
                {editorExpanded ? 'Restore split view' : 'Expand editor'}
              </Button>
            </span>
          </header>
          <div className="an-form-body">
            <label className="an-field-label" htmlFor="announcement-title">
              Title
            </label>
            <Input
              id="announcement-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setMessage(null);
              }}
              placeholder="Q3 Sales Target Update"
              maxLength={200}
              fullWidth
            />

            <label className="an-field-label" htmlFor="announcement-body">
              Body
            </label>
            <AnnouncementRichEditor
              id="announcement-body"
              value={body}
              onChange={(value) => {
                setBody(value);
                setMessage(null);
              }}
              placeholder="Share the update and any next steps…"
            />

            <fieldset className="an-targets">
              <legend>Target departments</legend>
              <div className="an-target-grid">
                {DEPARTMENTS.map((department) => (
                  <Checkbox
                    key={department.id}
                    checked={targets.includes(department.id)}
                    onChange={() => toggleTarget(department.id)}
                    label={department.label}
                    size="sm"
                  />
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setTargets(allSelected ? [] : DEPARTMENTS.map((department) => department.id))
                }
              >
                {allSelected ? 'Clear all' : 'Select all'}
              </Button>
            </fieldset>

            <fieldset className="an-priority">
              <legend>Priority</legend>
              <label>
                <input
                  type="radio"
                  name="announcement-priority"
                  value="normal"
                  checked={priority === 'normal'}
                  onChange={() => setPriority('normal')}
                />{' '}
                Standard
              </label>
              <label>
                <input
                  type="radio"
                  name="announcement-priority"
                  value="high"
                  checked={priority === 'high'}
                  onChange={() => setPriority('high')}
                />{' '}
                High priority
              </label>
            </fieldset>

            <div className="an-actions">
              <Button type="submit" variant="primary" loading={publishing}>
                Publish announcement
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!title && !body}
                onClick={() => {
                  setTitle('');
                  setBody('');
                  setMessage(null);
                }}
              >
                Clear
              </Button>
              <p className="an-form-status" role="status">
                {message}
              </p>
            </div>
          </div>
        </form>

        <aside className="an-preview" aria-label="Live targeted-agent preview">
          <header className="an-panel-head">
            <span className="an-live-dot" aria-hidden="true" /> Targeted agents see
          </header>
          <div className="an-preview-stage">
            <AnnouncementPreview title={title} body={body} priority={priority} />
            <p>Live preview — updates as you type</p>
          </div>
        </aside>
      </div>

      <section
        className="an-published"
        aria-labelledby="an-published-title"
        aria-busy={announcements.loading || undefined}
      >
        <header className="an-panel-head" id="an-published-title">
          Published ({announcements.data?.length ?? 0})
        </header>
        <div className="an-published-body">
          {announcements.loading ? (
            <div className="an-published-skeleton">
              <Skeleton variant="rect" height="var(--space-16)" radius="panel" />
              <Skeleton variant="rect" height="var(--space-16)" radius="panel" />
            </div>
          ) : announcements.error ? (
            <EmptyState
              size="panel"
              tone="error"
              title="Couldn’t load announcements"
              description="Retry the list after checking the connection."
              primaryAction={
                <Button variant="primary" onClick={announcements.reload}>
                  Retry
                </Button>
              }
            />
          ) : (
            <PublishedList announcements={announcements.data ?? []} />
          )}
        </div>
      </section>
    </section>
  );
}
