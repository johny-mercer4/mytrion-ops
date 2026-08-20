/**
 * Server-paginated, realtime Sales inbox with optimistic read/unread/delete actions.
 * Page chrome is the shared `SalesPage` — the top bar already says "Inbox", so the tab doesn't.
 */
import { useEffect, useState, type MouseEvent } from 'react';
import { getSession } from '@/api/session';
import { useImpersonation } from '@/context/ImpersonationProvider';
import { s } from '../dc';
import { Icon, type IconName } from '../icons';
import { badge, iconBox, ICO, NAV_DESC } from '../salesData';
import { useSales } from '../ctx';
import {
  SalesEmpty,
  SalesErrorNote,
  SalesPage,
  SalesPageHead,
  SalesPager,
  SalesSubTabs,
  type SalesSubTab,
} from '../SalesPage';
import { SalesBodySkeleton } from '../SalesTabSkeleton';
import {
  deleteInboxMessage,
  invalidateInboxCache,
  loadInboxPage,
  setAllInboxRead,
  setInboxRead,
  type InboxVM,
} from '../live';
import { publishInboxReload, subscribeInboxLive } from '../inboxLiveBus';
import { useSocketConnected } from '../socketStatus';
import { useCachedLoad, writeDcCache } from '../dcCache';
import { emitKpiActivity, useKpiSearchCompleted } from '../kpiTelemetry';

type FilterId = 'all' | 'unread' | 'task' | 'alert' | 'reminder';
type InboxPageVM = Awaited<ReturnType<typeof loadInboxPage>>;

const PAGE_SIZE = 25;
const iconOf: Record<InboxVM['type'], IconName> = {
  critical: ICO.warn,
  task: ICO.check,
  warning: ICO.warn,
  reminder: ICO.clock,
  info: ICO.bell,
};
const colOf: Record<InboxVM['type'], string> = {
  critical: 'var(--danger)',
  task: 'var(--accent)',
  warning: 'var(--orange)',
  reminder: 'var(--warn)',
  info: 'var(--ok)',
};
const prioCol: Record<string, string> = {
  high: 'var(--danger)',
  medium: 'var(--warn)',
  small: 'var(--ok)',
  low: 'var(--ok)',
};
const TAB_DEFS: ReadonlyArray<readonly [FilterId, string]> = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['task', 'Tasks'],
  ['alert', 'Alerts'],
  ['reminder', 'Reminders'],
];

function categoryOf(item: InboxVM): Exclude<FilterId, 'all' | 'unread'> {
  if (item.type === 'task') return 'task';
  if (item.type === 'warning' || item.type === 'critical') return 'alert';
  return 'reminder';
}

export function InboxTab() {
  const { openDetail, pushToast } = useSales();
  const { actingAs } = useImpersonation();
  const currentUserId = String(actingAs?.zohoUserId ?? getSession()?.worker.zohoUserId ?? '');
  const wsReady = useSocketConnected();
  const [filter, setFilter] = useState<FilterId>('all');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageCursors, setPageCursors] = useState<Array<string | undefined>>([undefined]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const cursor = pageCursors[page - 1];
  const cacheKey = `sales:inbox:${currentUserId}:${filter}:${page}:${encodeURIComponent(debouncedQuery)}`;
  const load = useCachedLoad(
    cacheKey,
    () => loadInboxPage({
      page,
      pageSize: PAGE_SIZE,
      filter,
      query: debouncedQuery,
      ...(cursor ? { cursor } : {}),
    }),
    { staleMs: 30_000 },
  );
  const items = load.data?.items ?? [];
  const counts = load.data?.counts ?? { all: 0, unread: 0, task: 0, alert: 0, reminder: 0 };
  const total = load.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useKpiSearchCompleted(
    'inbox.messages',
    debouncedQuery,
    total,
    !load.loading && !load.revalidating,
  );

  const resetPaging = (): void => {
    setPage(1);
    setPageCursors([undefined]);
  };

  const nextPage = (): void => {
    const nextCursor = load.data?.nextCursor;
    if (!nextCursor) return;
    setPageCursors((current) => {
      const next = [...current];
      next[page] = nextCursor;
      return next;
    });
    setPage((value) => value + 1);
  };

  useEffect(() => subscribeInboxLive(() => load.reload()), [load.reload]);

  const sync = (value: InboxPageVM): void => {
    writeDcCache(cacheKey, value);
  };
  const finishMutation = (): void => {
    invalidateInboxCache();
    publishInboxReload();
  };

  const toggleRead = (item: InboxVM, event?: MouseEvent<HTMLButtonElement>): void => {
    event?.stopPropagation();
    if (!load.data) return;
    const previous = load.data;
    const nextRead = !item.read;
    const nextItems = previous.items
      .map((row) => (row.id === item.id ? { ...row, read: nextRead } : row))
      .filter((row) => filter !== 'unread' || !row.read);
    sync({
      ...previous,
      items: nextItems,
      counts: {
        ...previous.counts,
        unread: Math.max(0, previous.counts.unread + (nextRead ? -1 : 1)),
      },
      total: filter === 'unread' ? Math.max(0, previous.total + (nextRead ? -1 : 1)) : previous.total,
    });
    void setInboxRead(item.id, nextRead)
      .then(() => finishMutation())
      .catch((error: unknown) => {
        sync(previous);
        pushToast('Inbox not updated', error instanceof Error ? error.message : 'Try again.');
      });
  };

  const markAllRead = (): void => {
    if (!load.data) return;
    const previous = load.data;
    sync({
      ...previous,
      items: filter === 'unread' ? [] : previous.items.map((item) => ({ ...item, read: true })),
      counts: { ...previous.counts, unread: 0 },
      total: filter === 'unread' ? 0 : previous.total,
      hasMore: filter === 'unread' ? false : previous.hasMore,
    });
    void setAllInboxRead()
      .then(() => {
        finishMutation();
        pushToast('All caught up', 'Marked every inbox message as read.');
      })
      .catch((error: unknown) => {
        sync(previous);
        pushToast('Inbox not updated', error instanceof Error ? error.message : 'Try again.');
      });
  };

  const remove = (item: InboxVM, event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (!load.data) return;
    const previous = load.data;
    const group = categoryOf(item);
    sync({
      ...previous,
      items: previous.items.filter((row) => row.id !== item.id),
      counts: {
        ...previous.counts,
        all: Math.max(0, previous.counts.all - 1),
        unread: Math.max(0, previous.counts.unread - (item.read ? 0 : 1)),
        [group]: Math.max(0, previous.counts[group] - 1),
      },
      total: Math.max(0, previous.total - 1),
    });
    void deleteInboxMessage(item.id)
      .then(() => {
        finishMutation();
        pushToast('Message removed', '');
      })
      .catch((error: unknown) => {
        sync(previous);
        pushToast('Delete failed', error instanceof Error ? error.message : 'Could not remove the message.');
      });
  };

  const openInbox = (item: InboxVM): void => {
    emitKpiActivity('ui.record_open', {
      entityType: 'inbox_message',
      entityId: item.id,
    });
    if (!item.read) toggleRead(item);
    openDetail({
      title: item.title,
      body: item.desc,
      icon: iconOf[item.type],
      iconStyle: iconBox(colOf[item.type], 44),
      metaLabel: 'Received:',
      meta: item.time,
      badges: [badge(item.prio.toUpperCase(), colOf[item.type]), ...(item.tag ? [badge(item.tag, 'var(--muted)')] : [])],
    });
  };

  const cold = load.loading && !load.data;
  const filterTabs: ReadonlyArray<SalesSubTab<FilterId>> = TAB_DEFS.map(([id, label]) => ({
    id,
    label,
    count: counts[id] || undefined,
  }));

  return (
    <SalesPage busy={cold || load.revalidating}>
      <SalesPageHead
        description={NAV_DESC.inbox}
        eyebrow={wsReady ? 'Live' : 'Reconnecting'}
        eyebrowTone={wsReady ? 'ok' : 'warn'}
        actions={
          counts.unread > 0 ? (
            <button type="button" onClick={markAllRead} className="ss-pager-btn">
              Mark all read
            </button>
          ) : null
        }
      />

      <div className="ss-toolbar">
        <div className="ss-search">
          <Icon name="search" size={16} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              resetPaging();
            }}
            aria-label="Search inbox"
            placeholder="Search subject, content or tag…"
          />
          {query ? (
            <button
              type="button"
              className="ss-search-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                resetPaging();
              }}
            >
              <Icon name="close" size={13} strokeWidth={2.4} />
            </button>
          ) : null}
        </div>
      </div>

      <SalesSubTabs
        items={filterTabs}
        value={filter}
        label="Inbox filter"
        size="sm"
        onChange={(next) => {
          setFilter(next);
          resetPaging();
        }}
      />

      {cold ? <SalesBodySkeleton variant="rows" rows={4} /> : null}
      {/* An error on a background refresh must not hide the rows that are already working — hence
          `inline` above the list rather than a state that replaces it. */}
      {load.error ? <SalesErrorNote inline={items.length > 0}>{load.error}</SalesErrorNote> : null}
      {!cold && !load.error && items.length === 0 ? (
        <SalesEmpty
          icon="check"
          tone="ok"
          title="All caught up"
          body={
            debouncedQuery
              ? 'No messages match this search.'
              : `No ${filter === 'all' ? '' : `${filter} `}messages right now.`
          }
        />
      ) : null}

      {items.length ? <div style={s('display:flex;flex-direction:column;gap:11px')}>
        {items.map((item) => {
          const unread = !item.read;
          const tone = colOf[item.type];
          const priority = badge(item.prio.toUpperCase(), prioCol[item.prio] || 'var(--muted)');
          return (
            <div key={item.id} className="ss-card-h" style={s(`width:100%;display:flex;align-items:stretch;gap:8px;padding:12px 12px 12px 16px;border-radius:var(--radius-md);background:var(--surface);border:1px solid ${unread ? 'rgba(var(--accent-rgb),.28)' : 'var(--border)'};color:var(--text);box-shadow:var(--shadow-sm);position:relative;overflow:hidden`)}>
              <span style={s(`position:absolute;left:0;inset-block:0;width:3px;background:${tone}`)} />
              <button type="button" onClick={() => openInbox(item)} style={s('flex:1;min-width:0;display:flex;align-items:flex-start;gap:13px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:3px 4px')}>
                <span style={s(`${iconBox(tone, 40)};margin-left:1px`)}><Icon name={iconOf[item.type]} size={17} /></span>
                <span style={s('flex:1;min-width:0')}>
                  <span style={s('display:block;font-size:14px;font-weight:700;line-height:1.35')}>{item.title}</span>
                  <span style={s('display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13px;color:var(--muted);margin-top:4px;line-height:1.5')}>{item.desc}</span>
                  <span style={s('display:flex;align-items:center;gap:7px;margin-top:9px;flex-wrap:wrap')}>
                    <span style={s("font-size:12px;color:var(--muted);font-family:var(--font-mono)")}>{item.time}</span>
                    <span style={s(priority.style)}>{priority.text}</span>
                    {item.tag ? <span style={s('font-size:11px;font-weight:700;padding:3px 8px;border-radius:99px;background:var(--raised);color:var(--text2)')}>{item.tag}</span> : null}
                  </span>
                </span>
              </button>
              <span style={s('display:flex;flex-direction:column;gap:7px;flex-shrink:0')}>
                <button type="button" onClick={(event) => toggleRead(item, event)} aria-label={unread ? 'Mark read' : 'Mark unread'} title={unread ? 'Mark read' : 'Mark unread'} className="ss-ico-btn" style={s('width:40px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}><Icon name={unread ? 'check' : 'inbox'} size={15} /></button>
                <button type="button" onClick={(event) => remove(item, event)} aria-label="Delete message" title="Delete message" className="ss-ico-btn" style={s('width:40px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}><Icon name="close" size={15} /></button>
              </span>
            </div>
          );
        })}
      </div> : null}

      {total > PAGE_SIZE ? (
        <SalesPager
          page={page}
          pageCount={pageCount}
          // Cursor-paged: forward needs the server's cursor, back is plain state.
          onPage={(next) => (next > page ? nextPage() : setPage(next))}
          nextDisabled={!load.data?.nextCursor}
          summary={`Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
        />
      ) : null}
    </SalesPage>
  );
}
