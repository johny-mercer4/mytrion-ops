import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  assignTicket,
  getTicket,
  listTickets,
  releaseTicket,
  setTicketStatus,
  type TicketDto,
  type ListTicketsParams,
  type TicketKind,
} from '@/api/comms';
import { ApiError } from '@/api/transport';
import { CheckCheck, ChevronLeft, Inbox, MessageSquare, RefreshCw, Search, Ticket, TriangleAlert, X } from 'lucide-react';
import { ChatThread } from './ChatThread';
import { useCommsSocket, type CommsFrame } from './useCommsSocket';
import {
  isOpen,
  OPEN_STATUS_PARAM,
  priorityLabel,
  priorityTone,
  shortAgo,
  showsPriority,
  slaCountdown,
  statusLabel,
  statusTone,
} from './chatFormat';
import c from './comms.module.css';

/**
 * The tickets console — ONE component, mounted by Sales, Customer Service, Billing and Verification.
 *
 * What makes it reusable is that it holds no Mytrion knowledge. Visibility is decided entirely server-side
 * by `commsThreadReaderFilter`: the participant arm gives a Sales agent the tickets they raised, the
 * department arm gives Customer Service its inbound queue, and neither is expressed here. The only props are
 * which department queue to watch and how to label the surface, so adding a fifth Mytrion is a mount, not a
 * fork.
 *
 * `mode` changes only DEFAULTS and copy, never authorization:
 *   'requester'  what I raised            (Sales)
 *   'queue'      what my department got   (CS / Billing / Verification)
 */

export type ConsoleMode = 'requester' | 'queue';

export interface TicketConsoleProps {
  mode: ConsoleMode;
  /** Department slug whose queue this Mytrion works. Omit for a requester-only surface. */
  department?: string;
  title?: string;
  /** Include escalations alongside client tickets. */
  includeEscalations?: boolean;
  /**
   * Restrict the list to a single kind — 'ticket' for a tickets-only surface, 'escalation' for an
   * escalations-only one. Overrides `includeEscalations`. Omit for the default ticket+escalation mix.
   */
  kind?: TicketKind;
  emptyHint?: string;
  /**
   * Open this ticket on entry — how "Create → jump to the new ticket" works.
   *
   * A ticket id rather than an index, and the console fetches it if the first page does not contain it:
   * the filter is "Open" by default and the list is newest-first, so a just-created ticket is usually there,
   * but nothing guarantees it and landing on a list with nothing selected is exactly the bug this closes.
   */
  focusTicketId?: string | null;
  /** Called once the focus has been honoured, so a re-render does not keep re-selecting it. */
  onFocusConsumed?: () => void;
  /**
   * Extra content for the open conversation's header, given the selected ticket. Optional and
   * unused by most mounts; Desk uses it to render the escalation ladder actions on an escalation.
   */
  chatActions?: (ticket: TicketDto) => ReactNode;
  /**
   * Opt-in multi-select + bulk actions (resolve / close / claim / release across a selection). Off by
   * default so every other mount is byte-identical; Desk turns it on for the tickets queue. Escalations
   * leave it off — they move through the ladder, not a queue action.
   */
  enableBulk?: boolean;
}

type StatusFilter = 'open' | 'all' | 'mine';
type BulkAction = 'resolve' | 'close' | 'claim' | 'release';

const REFRESH_DEBOUNCE_MS = 400;
const SEARCH_DEBOUNCE_MS = 300;

export function TicketConsole({
  mode,
  department,
  title,
  includeEscalations = true,
  kind,
  emptyHint,
  focusTicketId,
  onFocusConsumed,
  chatActions,
  enableBulk = false,
}: TicketConsoleProps) {
  const [tickets, setTickets] = useState<TicketDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Bulk-select set (ticket ids). Only ever populated when `enableBulk`. */
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('open');
  const [term, setTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [frame, setFrame] = useState<CommsFrame | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedTerm(term.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [term]);

  const params = useMemo((): ListTicketsParams => {
    const p: ListTicketsParams = { limit: 30 };
    if (filter === 'open') p.status = OPEN_STATUS_PARAM;
    if (filter === 'mine') p.scope = 'mine';
    // A queue console is scoped to its own department so a CS agent's list is CS work — the reader filter
    // would allow more (anything they participate in), and mixing the two makes a queue unusable.
    if (mode === 'queue' && department) p.department = department;
    if (kind) p.kind = kind;
    else if (!includeEscalations) p.kind = 'ticket';
    if (debouncedTerm) p.q = debouncedTerm;
    return p;
  }, [filter, mode, department, includeEscalations, kind, debouncedTerm]);

  const load = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      if (!opts.quiet) setLoading(true);
      setError('');
      setErrorCode('');
      try {
        const page = await listTickets(params, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setTickets(page.tickets);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setErrorCode(err instanceof ApiError ? err.code : 'UNKNOWN');
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          setLoading(false);
        }
      }
    },
    [params],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Honour an incoming focus (Create → "opening it now"). Runs after the first load so the common case is a
  // pure selection; only a ticket outside the current filter costs a fetch.
  useEffect(() => {
    if (!focusTicketId || loading) return;
    let cancelled = false;

    const inList = tickets.some((t) => t.id === focusTicketId);
    if (inList) {
      setSelectedId(focusTicketId);
      setMobileView('chat');
      onFocusConsumed?.();
      return;
    }

    void getTicket(focusTicketId)
      .then((t) => {
        if (cancelled) return;
        // Prepend rather than reload: the ticket may not match the active filter (a resolved one reached
        // from a link), and silently changing the user's filter to make it appear would be worse.
        setTickets((prev) => (prev.some((x) => x.id === t.id) ? prev : [t, ...prev]));
        setSelectedId(t.id);
        setMobileView('chat');
      })
      .catch(() => {
        // Gone or not visible to this user — leave the list alone rather than showing an error for
        // something they did not explicitly ask for.
      })
      .finally(() => {
        if (!cancelled) onFocusConsumed?.();
      });

    return () => {
      cancelled = true;
    };
  }, [focusTicketId, loading, tickets, onFocusConsumed]);

  /**
   * Debounced quiet refresh.
   *
   * A burst of frames (a ticket created, then assigned, then replied to) must not fire three list requests,
   * and it must not flash a skeleton over a list the user is reading — hence `quiet`.
   */
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void load({ quiet: true });
    }, REFRESH_DEBOUNCE_MS);
  }, [load]);

  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      requestRef.current?.abort();
    },
    [],
  );

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  const { status: socketStatus } = useCommsSocket({
    ...(mode === 'queue' && department ? { queues: [department] } : {}),
    openThreadId: selected?.threadId ?? null,
    onFrame: useCallback(
      (f: CommsFrame) => {
        // Handed to the open ChatThread, which decides whether it is for its thread.
        setFrame(f);
        // Anything that changes a row (a new ticket, an assignment, a reply bumping unread) refreshes the
        // list. The open conversation updates itself from the same frame.
        scheduleRefresh();
      },
      [scheduleRefresh],
    ),
  });

  const loadMore = async (): Promise<void> => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listTickets({ ...params, cursor });
      setTickets((prev) => {
        const have = new Set(prev.map((t) => t.id));
        return [...prev, ...page.tickets.filter((t) => !have.has(t.id))];
      });
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const select = (t: TicketDto): void => {
    setSelectedId(t.id);
    setMobileView('chat');
    // Clear the badge immediately; the server call the chat pane makes is what makes it durable.
    setTickets((prev) => prev.map((x) => (x.id === t.id ? { ...x, unread: 0 } : x)));
  };

  // A filter/search change is a different working set — drop any lingering selection so a bulk action
  // can never hit a ticket the user can no longer see.
  useEffect(() => {
    if (enableBulk) setChecked(new Set());
  }, [params, enableBulk]);

  const toggleChecked = useCallback((id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const runBulk = useCallback(
    async (action: BulkAction) => {
      const ids = [...checked];
      if (ids.length === 0 || bulkBusy) return;
      setBulkBusy(true);
      try {
        // allSettled, not all: one stale-version 409 or a status that cannot transition must not abort
        // the rest of the batch. The list reloads off the realtime frames the actions publish anyway.
        await Promise.allSettled(
          ids.map((id) => {
            const t = tickets.find((x) => x.id === id);
            if (!t) return Promise.resolve();
            if (action === 'resolve') return setTicketStatus(id, 'resolved', t.version);
            if (action === 'close') return setTicketStatus(id, 'closed', t.version);
            if (action === 'claim') return assignTicket(id);
            return releaseTicket(id);
          }),
        );
        setChecked(new Set());
        await load({ quiet: true });
      } finally {
        setBulkBusy(false);
      }
    },
    [checked, bulkBusy, tickets, load],
  );

  const heading = title ?? (mode === 'queue' ? 'Inbound tickets' : 'My tickets');
  const openCount = tickets.filter((t) => isOpen(t.status)).length;
  const unavailable = errorCode === 'COMMS_SCHEMA_NOT_READY';

  return (
    <div className={`${c.console}`} data-mobile-view={mobileView}>
      <div className={c.listPane}>
        <div className={c.listHead}>
          <div className={c.listTitleRow}>
            <h2 className={c.listTitle}>{heading}</h2>
            <span
              className={socketStatus === 'live' ? c.liveDot : `${c.liveDot} ${c.liveDotOff}`}
              title={
                socketStatus === 'live'
                  ? 'Live — updates arrive instantly'
                  : 'Reconnecting — the list still refreshes'
              }
            >
              {socketStatus === 'live' ? 'Live' : 'Reconnecting'}
            </span>
          </div>
          <div className={c.searchWrap}>
            <Search className={c.searchIcon} size={15} aria-hidden="true" />
            <input
              className={c.search}
              value={term}
              onChange={(ev) => setTerm(ev.target.value)}
              placeholder="Search number, subject, company…"
              aria-label="Search tickets"
            />
            {term ? (
              <button
                type="button"
                className={c.searchClear}
                onClick={() => setTerm('')}
                aria-label="Clear search"
              >
                <X size={13} strokeWidth={2.4} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className={c.filterRow}>
            <div className={c.filters} role="tablist" aria-label="Ticket filter">
              {(
                [
                  ['open', 'Open'],
                  ['all', 'All'],
                  ...(mode === 'queue' ? ([['mine', 'Raised by me']] as const) : []),
                ] as [StatusFilter, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  className={filter === key ? `${c.chip} ${c.chipOn}` : c.chip}
                  onClick={() => setFilter(key)}
                  aria-selected={filter === key}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* The count keeps its line while loading — it used to blank, so the header jumped by a
                row on every filter change and every background refresh. */}
            <span className={c.count}>
              {loading && tickets.length === 0 ? 'Loading…' : `${openCount} open · ${tickets.length} shown`}
            </span>
          </div>
        </div>

        {enableBulk && checked.size > 0 ? (
          <div className={c.bulkBar} role="region" aria-label="Bulk actions">
            <span className={c.bulkCount}>
              <CheckCheck size={14} aria-hidden="true" />
              {checked.size} selected
            </span>
            <button type="button" className={c.bulkBtn} onClick={() => void runBulk('claim')} disabled={bulkBusy}>
              Claim
            </button>
            <button type="button" className={c.bulkBtn} onClick={() => void runBulk('resolve')} disabled={bulkBusy}>
              Resolve
            </button>
            <button type="button" className={c.bulkBtn} onClick={() => void runBulk('close')} disabled={bulkBusy}>
              Close
            </button>
            <button type="button" className={c.bulkBtn} onClick={() => void runBulk('release')} disabled={bulkBusy}>
              Release
            </button>
            <button
              type="button"
              className={c.bulkClear}
              onClick={() => setChecked(new Set())}
              disabled={bulkBusy}
              aria-label="Clear selection"
            >
              <X size={13} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {error && !unavailable && (
          <p className={c.errorNote} role="alert">
            {error}
          </p>
        )}

        <div className={c.list}>
          {unavailable ? (
            <div className={c.unavailable} role="status">
              <span className={c.unavailableEyebrow}>
                <TriangleAlert size={12} aria-hidden="true" /> Communications is being prepared
              </span>
              <strong className={c.unavailableTitle}>Tickets are temporarily unavailable</strong>
              <span className={c.unavailableBody}>
                The required database migration has not completed yet. Existing features remain
                available; Tickets will enable automatically after the schema readiness check passes.
              </span>
              <button type="button" className={c.ghostBtn} onClick={() => void load()}>
                <RefreshCw size={13} aria-hidden="true" /> Check again
              </button>
            </div>
          ) : loading && tickets.length === 0 ? (
            <div aria-busy="true" aria-label="Loading tickets">
              <div className={c.skelRow} />
              <div className={c.skelRow} />
              <div className={c.skelRow} />
              <div className={c.skelRow} />
            </div>
          ) : tickets.length === 0 ? (
            <div className={c.empty}>
              <div className={c.emptyInner}>
                <span className={c.emptyIcon} aria-hidden="true">
                  {debouncedTerm ? <Search size={22} /> : <Inbox size={22} />}
                </span>
                <span className={c.emptyTitle}>
                  {debouncedTerm ? 'Nothing matches that search' : 'Nothing here yet'}
                </span>
                <span className={c.emptyBody}>
                  {debouncedTerm
                    ? 'Try a ticket number, a company or a word from the subject.'
                    : (emptyHint ??
                      (mode === 'queue'
                        ? 'Tickets filed to this department will appear here the moment they are raised.'
                        : 'Tickets you raise will appear here.'))}
                </span>
                {debouncedTerm ? (
                  <button type="button" className={c.ghostBtn} onClick={() => setTerm('')}>
                    Clear search
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              {tickets.map((t) => {
                const sla = slaCountdown(t.sla.dueAt, t.status);
                const rowBtn = (
                  <button
                    type="button"
                    className={[
                      c.row,
                      t.id === selectedId ? c.rowActive : '',
                      t.unread > 0 ? c.rowUnread : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => select(t)}
                    aria-current={t.id === selectedId}
                  >
                    <span className={c.rowTop}>
                      <span className={c.rowNumber}>{t.number}</span>
                      <span className={c.rowSubject}>{t.subject}</span>
                    </span>
                    <span className={c.rowMeta}>
                      <span className={c.tag} style={{ ['--tag-tone' as string]: statusTone(t.status) }}>
                        <span className={c.dot} />
                        {statusLabel(t.status)}
                      </span>
                      {showsPriority(t.priority) && (
                        <span
                          className={c.tag}
                          style={{ ['--tag-tone' as string]: priorityTone(t.priority) }}
                        >
                          {priorityLabel(t.priority)}
                        </span>
                      )}
                      {t.escalation?.levelLabel && (
                        <span className={c.tag} style={{ ['--tag-tone' as string]: 'var(--tone-violet)' }}>
                          {t.escalation.levelLabel}
                        </span>
                      )}
                      {sla && (
                        <span className={sla.overdue ? `${c.tag} ${c.overdue}` : c.tag}>{sla.text}</span>
                      )}
                      {t.client?.companyName && (
                        <span className={c.rowPreview}>{t.client.companyName}</span>
                      )}
                      {!t.client?.companyName && t.lastMessagePreview && (
                        <span className={c.rowPreview}>{t.lastMessagePreview}</span>
                      )}
                    </span>
                    <span className={c.rowRight}>
                      <span className={c.time} title={new Date(t.lastMessageAt).toLocaleString()}>
                        {shortAgo(t.lastMessageAt)}
                      </span>
                      {t.unread > 0 && (
                        <span className={c.badge} aria-label={`${t.unread} unread`}>
                          {t.unread > 99 ? '99+' : t.unread}
                        </span>
                      )}
                    </span>
                  </button>
                );
                if (!enableBulk) return <Fragment key={t.id}>{rowBtn}</Fragment>;
                return (
                  <div
                    key={t.id}
                    className={checked.has(t.id) ? `${c.rowWrap} ${c.rowWrapOn}` : c.rowWrap}
                  >
                    <input
                      type="checkbox"
                      className={c.rowCheck}
                      checked={checked.has(t.id)}
                      onChange={() => toggleChecked(t.id)}
                      aria-label={`Select ${t.number}`}
                    />
                    {rowBtn}
                  </div>
                );
              })}
              {hasMore && (
                <button
                  type="button"
                  className={c.loadMore}
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className={c.chatPane}>
        {unavailable ? (
          <div className={c.empty}>
            <div className={c.emptyInner}>
              <span className={c.emptyIcon} aria-hidden="true"><Ticket size={22} /></span>
              <span className={c.emptyTitle}>No ticket selected</span>
              <span className={c.emptyBody}>Conversation access resumes when Tickets is ready.</span>
            </div>
          </div>
        ) : !selected ? (
          <div className={c.empty}>
            <div className={c.emptyInner}>
              <span className={c.emptyIcon} aria-hidden="true"><MessageSquare size={22} /></span>
              <span className={c.emptyTitle}>Pick a ticket</span>
              <span className={c.emptyBody}>
                Its conversation opens here — everyone assigned can reply, attach files and see updates live.
              </span>
            </div>
          </div>
        ) : (
          <ChatThread
            key={selected.threadId}
            threadId={selected.threadId}
            frame={frame}
            onActivity={scheduleRefresh}
            disabled={!isOpen(selected.status)}
            disabledReason={`This ${selected.kind} is ${statusLabel(selected.status).toLowerCase()}.`}
            headerSlot={
              <div className={c.chatHead}>
                <button
                  type="button"
                  className={c.backBtn}
                  onClick={() => setMobileView('list')}
                  aria-label="Back to the ticket list"
                >
                  <ChevronLeft size={17} strokeWidth={2.4} aria-hidden="true" />
                </button>
                <div className={c.chatHeadMain}>
                  <span className={c.chatSubject}>{selected.subject}</span>
                  <span className={c.chatFacts}>
                    <span className={c.rowNumber}>{selected.number}</span>
                    <span
                      className={c.tag}
                      style={{ ['--tag-tone' as string]: statusTone(selected.status) }}
                    >
                      <span className={c.dot} />
                      {statusLabel(selected.status)}
                    </span>
                    {showsPriority(selected.priority) && (
                      <span
                        className={c.tag}
                        style={{ ['--tag-tone' as string]: priorityTone(selected.priority) }}
                      >
                        {priorityLabel(selected.priority)}
                      </span>
                    )}
                    {selected.typeLabel && (
                      <>
                        <span className={c.factSep}>·</span>
                        <span className={c.fact}>{selected.typeLabel}</span>
                      </>
                    )}
                    {selected.client?.companyName && (
                      <>
                        <span className={c.factSep}>·</span>
                        <span className={c.fact} title="Client on this ticket">
                          {selected.client.companyName}
                          {selected.client.carrierId ? ` (#${selected.client.carrierId})` : ''}
                        </span>
                      </>
                    )}
                    {selected.client?.cardLast4 && (
                      <>
                        <span className={c.factSep}>·</span>
                        <span className={c.fact}>card ••{selected.client.cardLast4}</span>
                      </>
                    )}
                    <span className={c.factSep}>·</span>
                    <span className={c.fact} title="Who raised it">
                      from {selected.requester.name}
                    </span>
                    {selected.assignee && (
                      <>
                        <span className={c.factSep}>·</span>
                        <span className={c.fact} title="Currently with">
                          → {selected.assignee.name ?? selected.assignee.zohoUserId}
                        </span>
                      </>
                    )}
                    {selected.targetDepartment && (
                      <>
                        <span className={c.factSep}>·</span>
                        <span className={c.fact}>{selected.targetDepartment}</span>
                      </>
                    )}
                  </span>
                </div>
                {chatActions ? chatActions(selected) : null}
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}
