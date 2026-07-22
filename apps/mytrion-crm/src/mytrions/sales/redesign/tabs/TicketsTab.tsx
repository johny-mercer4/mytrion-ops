/**
 * Sales Mytrion Tickets — two-pane Desk console (creator-scoped list + thread).
 * Shell `useSidebarBadges` owns WS subscribe + toast + unread; this tab listens on
 * `ticketLiveBus` to refresh the open thread and soft-updates the list.
 */
import { useEffect, useRef, useState } from 'react';

import { replyDeskTicket, downloadDeskAttachment } from '@/api/desk';
import { s } from '../dc';
import { Icon } from '../icons';
import { useSales } from '../ctx';
import { useLoad, loadTicketMessages, isTicketClosed, type TicketMsgVM } from '../live';
import { useTicketUnread, clearTicketUnread } from '../ticketUnread';
import { useTicketsFeed } from '../useTicketsFeed';
import { ticketStatusColor } from '../ticketStatus';
import {
  ageText,
  isOverdue,
  slaInfo,
  statusBadgeOf,
  tkPrioCol,
  TICKET_FILTERS,
  type TicketFilter,
} from '../ticketListMeta';
import { setOpenTicketId, subscribeTicketLive } from '../ticketLiveBus';
import {
  buildPendingMsgs,
  mergeTicketThread,
  prunePending,
  type PendingTicketMsg,
} from '../ticketOptimistic';
import { TicketsBootSkeleton } from '../TicketsBootSkeleton';
import '../tickets.css';

export function TicketsTab() {
  const { pushToast, go, focusTicketId, clearFocusTicket } = useSales();

  const [selectedTicket, setSelectedTicket] = useState<string>(focusTicketId ?? '');
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>('all');
  const [ticketSearch, setTicketSearch] = useState<string>('');
  const [ticketReply, setTicketReply] = useState<string>('');
  const [ticketsSpin, setTicketsSpin] = useState<boolean>(false);
  const [ticketDetailsOpen, setTicketDetailsOpen] = useState<boolean>(false);
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [sending, setSending] = useState<boolean>(false);
  /** Local bubbles shown instantly while Desk POST + thread reload catch up. */
  const [pendingMsgs, setPendingMsgs] = useState<PendingTicketMsg[]>([]);
  const unreadCounts = useTicketUnread();

  const spinRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---------- live data (infinite-scroll feed + open-thread messages) ----------
  const feed = useTicketsFeed();
  const msgsLoad = useLoad(
    () => (selectedTicket ? loadTicketMessages(selectedTicket) : Promise.resolve<TicketMsgVM[]>([])),
    [selectedTicket],
  );

  const allTickets = feed.tickets;
  const scoped = feed.scoped;

  // Entering the tab via "open this ticket" (e.g. after Create): select it + consume the flag.
  useEffect(() => {
    if (focusTicketId) {
      setSelectedTicket(focusTicketId);
      clearFocusTicket();
    }
  }, [focusTicketId, clearFocusTicket]);

  // Auto-select the first ticket once the list loads; never override an existing selection.
  useEffect(() => {
    const first = allTickets[0];
    if (!first) return;
    setSelectedTicket((cur) => cur || first.id);
  }, [allTickets]);

  // Shell open-ticket focus (suppress toast/unread) + clear badge when selected.
  useEffect(() => {
    setOpenTicketId(selectedTicket);
    if (selectedTicket) clearTicketUnread(selectedTicket);
    return () => setOpenTicketId('');
  }, [selectedTicket]);

  // Shell WS → pin ticket to top; reload thread when open (no softReload — preserves promote).
  useEffect(() => {
    return subscribeTicketLive((e) => {
      feed.promoteTicket(e.ticketId);
      // Show the bumped card (old tickets may have been far down / not loaded yet).
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = 0;
      });
      if (e.ticketId === selectedTicket) {
        clearTicketUnread(e.ticketId);
        msgsLoad.reload();
      }
    });
    // eslint-disable-next-line
  }, [selectedTicket]);

  useEffect(() => {
    const iv = setInterval(() => feed.softReload(), 25_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line
  }, []);

  // Drop optimistic rows once the server thread includes them.
  useEffect(() => {
    const server = msgsLoad.data ?? [];
    setPendingMsgs((prev) => prunePending(prev, server));
  }, [msgsLoad.data]);

  useEffect(() => {
    setPendingMsgs([]);
  }, [selectedTicket]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [selectedTicket, msgsLoad.data, pendingMsgs.length]);

  useEffect(() => () => { if (spinRef.current) clearTimeout(spinRef.current); }, []);

  // ---------- handlers ----------
  const selectTicket = (id: string): void => {
    clearTicketUnread(id);
    setOpenTicketId(id);
    setSelectedTicket(id);
  };

  const refreshTickets = (): void => {
    setTicketsSpin(true);
    feed.reload();
    msgsLoad.reload();
    if (spinRef.current) clearTimeout(spinRef.current);
    spinRef.current = setTimeout(() => setTicketsSpin(false), 900);
  };

  /** Reference handleScroll — near bottom loads the next page of 20. */
  const onListScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget;
    if (!feed.hasMore || feed.loadingMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) feed.loadMore();
  };

  const sendTicketReply = async (): Promise<void> => {
    const text = ticketReply.trim();
    const file = attachFile;
    if ((!text && !file) || !selectedTicket || sending) return;
    const ticketId = selectedTicket;
    const pending = buildPendingMsgs(ticketId, text, file);
    // Instant UI: bubble + clear composer before Desk round-trip.
    setPendingMsgs((prev) => [...prev, ...pending]);
    setTicketReply('');
    setAttachFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setSending(true);
    try {
      await replyDeskTicket(ticketId, text, file);
      // Background reconcile only — no ticket-list softReload (that was competing with chat).
      msgsLoad.reload();
    } catch (e) {
      const ids = new Set(pending.map((p) => p.id));
      setPendingMsgs((prev) => prev.filter((p) => !ids.has(p.id)));
      setTicketReply(text);
      if (file) setAttachFile(file);
      pushToast('Reply failed', e instanceof Error ? e.message : 'Could not send your reply.');
    } finally {
      setSending(false);
    }
  };

  const ticketReplyKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendTicketReply();
    }
  };

  const takeAttach = (f: File | null): void => {
    if (f && f.size > 20 * 1024 * 1024) {
      pushToast('File too large', 'Attachments must be 20MB or smaller.');
      return;
    }
    setAttachFile(f);
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    takeAttach(e.currentTarget.files?.[0] ?? null);
  };

  // Paste-to-attach in the composer: grab a pasted file/image; let plain-text pastes fall through.
  const onPasteReply = (e: React.ClipboardEvent<HTMLInputElement>): void => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of Array.from(items)) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) { takeAttach(f); e.preventDefault(); break; }
      }
    }
  };

  const downloadAttachment = (file: NonNullable<TicketMsgVM['file']>): void => {
    pushToast('Downloading', file.name || 'Attachment');
    void downloadDeskAttachment(file.ticketId, file.attId, file.name).catch((err: unknown) =>
      pushToast('Download failed', err instanceof Error ? err.message : 'Could not download the file.'),
    );
  };

  // ---------- view-model ----------
  const tkF = ticketFilter;
  const tq = ticketSearch.toLowerCase();
  let tkList = allTickets.filter((t) =>
    tkF === 'all'
      ? true
      : tkF === 'overdue'
        ? isOverdue(t)
        : tkF === 'closed'
          ? isTicketClosed(t.status)
          : !isTicketClosed(t.status),
  );
  if (tq) {
    tkList = tkList.filter((t) =>
      `${t.num || ''} ${t.subject} ${t.company} ${t.contact || ''} ${t.agent || ''}`.toLowerCase().includes(tq),
    );
  }
  const ticketListEmpty = tkList.length === 0;

  const tkSel = allTickets.find((t) => t.id === selectedTicket);
  const tkEsc = tkSel?.channel === 'Escalation';
  const tkClosed = isTicketClosed(tkSel?.status || '');
  const tkOpen = !tkClosed;

  const threadMsgs = mergeTicketThread(msgsLoad.data ?? [], pendingMsgs);
  const tkInitials = (tkSel?.contact || '?').split(' ').map((w) => w[0]).slice(0, 2).join('');
  const tkStatusBadge = tkSel?.status ? statusBadgeOf(tkSel.status) : { text: '', style: '' };
  const tkCompany = (tkEsc ? tkSel?.targetDept : tkSel?.company) || '—';
  const tkSla = tkSel ? slaInfo(tkSel) : null;

  const detailRows: [string, string, boolean][] = tkSel
    ? [
        ['Department', (tkEsc ? tkSel.targetDept : tkSel.dept) || '—', false],
        ['Priority', tkSel.priority || '—', false],
        ['Assignee', tkSel.agent || 'N/A', true],
        ['Ticket Type', tkSel.ticketType || 'N/A', false],
        ['Channel', tkSel.channel || '—', false],
        ['Carrier / Application ID', tkSel.carrierId || 'N/A', false],
      ]
    : [];

  const ticketsSpinStyle = ticketsSpin ? 'animation:ss-spin .9s linear infinite' : '';
  const detailsOpen = ticketDetailsOpen && !!tkSel;

  return (
    <>
      <div className="ss-fu ss-tk">
        {!scoped && (
          <div className="ss-tk-warn">
            <Icon name="alert" size={15} color="var(--warn)" style={{ flexShrink: 0 }} />
            <span>
              Desk <strong style={s('color:var(--text)')}>search</strong> scope is missing on the server token
              — loading your tickets by scanning recent history (Load more still pages +20). Re-mint
              the Desk refresh token with <em>Desk.search.READ</em> for full ticketdashboard parity.
            </span>
          </div>
        )}
        {feed.loading && allTickets.length === 0 && !feed.error ? (
          <TicketsBootSkeleton />
        ) : (
        <div className="ss-tk-layout">
          <div className="ss-tk-list">
            <div className="ss-tk-list-hd">
              <div className="ss-tk-list-title-row">
                <span className="ss-tk-list-title">My Tickets</span>
                <div className="ss-tk-list-actions">
                  <span className="ss-tk-live" title={scoped ? undefined : 'Showing recent tickets — Desk search scope unavailable'}>
                    <span className="ss-tk-live-dot" />
                    LIVE
                  </span>
                  <button type="button" onClick={refreshTickets} aria-label="Refresh" className="ss-tk-tool ss-ico-btn">
                    <Icon name="refresh" size={14} style={s(ticketsSpinStyle)} />
                  </button>
                  <button type="button" onClick={() => go('create')} aria-label="New ticket" title="New ticket" className="ss-tk-tool ss-tk-tool--primary ss-ico-btn">
                    <Icon name="plus" size={15} strokeWidth={2.4} />
                  </button>
                </div>
              </div>
              <div className="ss-tk-search">
                <Icon name="search" size={14} />
                <input value={ticketSearch} onChange={(e) => setTicketSearch(e.currentTarget.value)} placeholder="Search tickets…" className="ss-in" />
              </div>
              <label className="ss-tk-pick">
                <span className="ss-tk-pick-label">Status</span>
                <select
                  className="ss-tk-pick-select"
                  value={tkF}
                  aria-label="Filter by status"
                  onChange={(e) => setTicketFilter(e.currentTarget.value as TicketFilter)}
                >
                  {TICKET_FILTERS.map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div ref={listRef} className="ss-scroll ss-tk-list-body" onScroll={onListScroll}>
              {feed.error && (
                <div style={s('padding:36px 14px;text-align:center;color:var(--danger);font-size:13px')}>{feed.error}</div>
              )}
              {tkList.map((t) => {
                const active = selectedTicket === t.id;
                const esc = t.channel === 'Escalation';
                const unreadN = unreadCounts[t.id] ?? 0;
                const prioCol = tkPrioCol[t.priority] || 'var(--muted)';
                const statusCol = ticketStatusColor(t.status);
                const sla = slaInfo(t);
                const company = (esc ? t.targetDept : t.company) || '—';
                const contact = t.contact || '—';
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => selectTicket(t.id)}
                    className={`ss-tk-card${active ? ' is-active' : ''}${unreadN > 0 ? ' has-unread' : ''}`}
                    style={{ borderLeftColor: prioCol, ['--tk-status' as string]: statusCol, ...(sla ? { ['--tk-sla' as string]: sla.col } : {}) }}
                  >
                    <div className="ss-tk-card-top">
                      <div className="ss-tk-card-subject">{t.subject}</div>
                      {unreadN > 0 ? (
                        <span className="ss-tk-unread">{unreadN > 99 ? '99+' : unreadN}</span>
                      ) : null}
                    </div>
                    <div className="ss-tk-card-meta">
                      <span className="ss-tk-card-id">#{t.num}</span>
                      <span aria-hidden="true">·</span>
                      <span className="ss-tk-card-who" title={`${contact} · ${company}`}>
                        {contact} · {company}
                      </span>
                    </div>
                    <div className="ss-tk-card-foot">
                      <span className={`ss-tk-chip ss-tk-chip--status${isTicketClosed(t.status) ? ' is-closed' : ''}`}>{t.status}</span>
                      {sla ? <span className="ss-tk-chip ss-tk-chip--sla">{sla.text}</span> : null}
                    </div>
                  </button>
                );
              })}
              {ticketListEmpty && !feed.loading && !feed.error && (
                <div style={s('padding:36px 14px;text-align:center;color:var(--muted);font-size:13px')}>No tickets match your filters.</div>
              )}
            </div>
            <div className="ss-tk-list-ft">
              <div className="ss-tk-list-ft-meta">
                {allTickets.length} loaded{tkList.length !== allTickets.length ? ` · ${tkList.length} shown` : ''}
                {feed.hasMore ? ' · +20' : ''}
              </div>
              <button
                type="button"
                className="ss-tk-load-more-btn"
                disabled={feed.loadingMore || feed.loading || !feed.hasMore}
                onClick={() => feed.loadMore()}
              >
                {feed.loadingMore ? 'Loading…' : feed.hasMore ? 'Load more tickets' : 'All tickets loaded'}
              </button>
            </div>
          </div>

          <div className="ss-tk-chat">
            {tkSel ? (
              <>
                <div className="ss-tk-chat-hd">
                  <div className="ss-tk-avatar">{tkInitials}</div>
                  <div className="ss-tk-chat-hd-body">
                    <div className="ss-tk-chat-subject">{tkSel.subject}</div>
                    <div className="ss-tk-chat-sub">
                      #{tkSel.num} · {tkCompany} · {tkSel.contact || 'N/A'}
                      {tkSel.agent ? ` · ${tkSel.agent}` : ''}
                    </div>
                  </div>
                  <div className="ss-tk-chat-hd-actions">
                    {tkSla ? (
                      <span className="ss-tk-chip ss-tk-chip--sla" style={{ ['--tk-sla' as string]: tkSla.col }}>{tkSla.text}</span>
                    ) : null}
                    <span style={s(tkStatusBadge.style)}>{tkStatusBadge.text}</span>
                    <button
                      type="button"
                      onClick={() => setTicketDetailsOpen((v) => !v)}
                      aria-label="Ticket details"
                      className="ss-tk-tool ss-ico-btn"
                    >
                      <Icon name="info" size={16} />
                    </button>
                  </div>
                </div>
                <div ref={bodyRef} className="ss-scroll ss-tk-thread">
                  <div className="ss-tk-thread-meta">{tkSel.channel} · opened {ageText(tkSel.ageHrs)} ago</div>
                  {msgsLoad.loading &&
                    threadMsgs.length === 0 &&
                    [0, 1, 2].map((i) => {
                      const me = i % 2 === 0;
                      return (
                        <div key={`mk-${i}`} className={`ss-tk-msg${me ? ' is-me' : ' is-agent'}`}>
                          <div className="ss-skel" style={s('width:28px;height:28px;border-radius:50%;flex-shrink:0')} />
                          <div className="ss-skel" style={s(`height:${me ? 38 : 48}px;width:${me ? '48%' : '58%'};border-radius:12px`)} />
                        </div>
                      );
                    })}
                  {msgsLoad.error && (
                    <div style={s('text-align:center;color:var(--danger);font-size:13px;padding:20px')}>{msgsLoad.error}</div>
                  )}
                  {threadMsgs.map((m, i) => {
                    const me = m.from === 'me';
                    const who = me ? 'You' : m.from || tkSel.agent || 'Support';
                    const type = m.type || 'comment';
                    return (
                      <div key={i} className={`ss-tk-msg${me ? ' is-me' : ' is-agent'}`}>
                        <div className="ss-tk-msg-av">
                          <Icon name="user" size={14} color="#fff" />
                        </div>
                        <div className="ss-tk-msg-col">
                          {type === 'comment' && <div className="ss-tk-bubble">{m.text}</div>}
                          {type === 'attachment' && m.file && (
                            <div className={`ss-tk-file${me ? ' is-mine' : ''}`}>
                              <div className="ss-tk-file-icon">
                                <Icon name="file" size={16} />
                              </div>
                              <div className="ss-tk-file-meta">
                                <div className="ss-tk-file-name">{m.file.name}</div>
                                {m.file.size ? <div className="ss-tk-file-size">{m.file.size}</div> : null}
                              </div>
                              {m.file.attId ? (
                                <button
                                  type="button"
                                  className="ss-tk-file-dl"
                                  aria-label={`Download ${m.file.name}`}
                                  title="Download"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    downloadAttachment(m.file!);
                                  }}
                                >
                                  <Icon name="download" size={15} />
                                  <span>Download</span>
                                </button>
                              ) : (
                                <span className="ss-tk-file-pending">Sending…</span>
                              )}
                            </div>
                          )}
                          <span className="ss-tk-msg-time">{who} · {m.time}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {tkOpen && (
                  <div className="ss-tk-composer">
                    {attachFile && (
                      <div className="ss-tk-attach-chip">
                        <Icon name="attach" size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                        <span style={s('overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{attachFile.name}</span>
                        <button
                          type="button"
                          onClick={() => { setAttachFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                          aria-label="Remove attachment"
                          style={s('flex-shrink:0;border:none;background:transparent;color:var(--danger);font-size:11px;font-weight:700;cursor:pointer')}
                        >
                          ✕
                        </button>
                      </div>
                    )}
                    <div className="ss-tk-compose-row">
                      <input ref={fileInputRef} type="file" onChange={onPickFile} style={{ display: 'none' }} />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        aria-label="Attach file"
                        className="ss-tk-tool ss-ico-btn"
                        style={attachFile ? { color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),.5)', background: 'rgba(var(--accent-rgb),.12)' } : undefined}
                      >
                        <Icon name="attach" size={17} />
                      </button>
                      <input
                        value={ticketReply}
                        onChange={(e) => setTicketReply(e.currentTarget.value)}
                        onKeyDown={ticketReplyKey}
                        onPaste={onPasteReply}
                        placeholder="Reply…"
                        className="ss-in"
                      />
                      <button type="button" onClick={sendTicketReply} disabled={sending} aria-label="Send reply" className="ss-tk-send ss-btn-p">
                        {sending ? (
                          <span style={s('width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:ss-spin .8s linear infinite')} />
                        ) : (
                          <Icon name="send" size={17} />
                        )}
                      </button>
                    </div>
                  </div>
                )}
                {tkClosed && (
                  <div className="ss-tk-closed-bar">This ticket is {tkStatusBadge.text}. Reopen it to reply.</div>
                )}
              </>
            ) : (
              <div className="ss-tk-empty">
                <div className="ss-tk-empty-icon">
                  <Icon name="chat" size={28} strokeWidth={1.6} />
                </div>
                <div className="ss-tk-empty-title">
                  {feed.error ? 'Could not load tickets' : 'No ticket selected'}
                </div>
                <div className="ss-tk-empty-sub">
                  {feed.error ? feed.error : 'Pick a ticket from the list to view the thread and reply.'}
                </div>
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {detailsOpen && tkSel && (
        <>
          <div className="ss-scrim" onClick={() => setTicketDetailsOpen(false)} aria-hidden="true" />
          <div className="ss-tk-drawer" role="dialog" aria-label="Ticket details">
            <div className="ss-tk-drawer-hd">
              <span className="ss-tk-drawer-title">Ticket Details</span>
              <button type="button" onClick={() => setTicketDetailsOpen(false)} className="ss-tk-tool ss-ico-btn" aria-label="Close details">
                <Icon name="close" size={15} strokeWidth={2.4} />
              </button>
            </div>
            <div className="ss-scroll ss-tk-drawer-body">
              <div>
                <div className="ss-tk-drawer-label">Subject</div>
                <div className="ss-tk-drawer-value">{tkSel.subject}</div>
              </div>
              <div>
                <div className="ss-tk-drawer-label">Description</div>
                <div className="ss-tk-drawer-desc">{tkSel.description || '—'}</div>
              </div>
              <div>
                <div className="ss-tk-drawer-label">Status</div>
                <span style={s(tkStatusBadge.style)}>{tkStatusBadge.text}</span>
              </div>
              {detailRows.map(([label, value, accent]) => (
                <div key={label}>
                  <div className="ss-tk-drawer-label">{label}</div>
                  <div className={`ss-tk-drawer-value${accent ? ' is-accent' : ''}`}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
