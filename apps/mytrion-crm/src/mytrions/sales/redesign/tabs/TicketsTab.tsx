/**
 * Sales Mytrion redesign — Tickets tab. A two-pane Desk console: a searchable/filterable
 * ticket list on the left and a conversation thread on the right, with a slide-in details
 * panel. Ported verbatim from the reference prototype's `isTickets` slice + renderVals()
 * ticket view-model; per-tab UI state (selection, filter, search, reply, spin, details) lives
 * in local React state. Data is LIVE: the list comes from Zoho Desk (`loadTickets`, creator-
 * scoped server-side), the open thread from `loadTicketMessages`, replies POST via
 * `replyDeskTicket`, and a servercrm WebSocket reloads on `ticket_comment_added`.
 */
import { useEffect, useRef, useState } from 'react';

import { replyDeskTicket, downloadDeskAttachment } from '@/api/desk';
import { getSession } from '@/api/session';
import { s } from '../dc';
import { badge, type BadgeVM } from '../salesData';
import { useSales } from '../ctx';
import { useLoad, loadTickets, loadTicketMessages, isTicketClosed, type TicketVM, type TicketMsgVM } from '../live';
import { useServerCrmSocket } from '../useServerCrmSocket';
import { useTicketUnread, clearTicketUnread } from '../ticketUnread';

type TicketFilter = 'all' | 'overdue' | 'active' | 'closed';

// ---------- reference view-model helpers ----------

const tkStatusMap: Record<string, string> = {
  Open: 'var(--accent)',
  'On Hold': 'var(--warn)',
  Escalated: 'var(--violet)',
  'Stream Manager Review': 'var(--cyan)',
  'Head of Department Review': 'var(--accent-2)',
  'C-Level Review': 'var(--danger)',
  Resolved: 'var(--ok)',
  Closed: 'var(--muted)',
  Cancelled: 'var(--danger)',
};

const tkPrioCol: Record<string, string> = {
  High: 'var(--danger)',
  Critical: 'var(--danger)',
  Normal: 'var(--accent)',
  Low: 'var(--muted)',
};


const ageText = (h: number): string => {
  const hh = h || 0;
  return hh < 1 ? `${Math.max(1, Math.round(hh * 60))}m` : hh < 24 ? `${Math.round(hh)}h` : `${Math.round(hh / 24)}d`;
};

// SLA — a target response window per priority; the badge counts down (or up, once overdue).
const slaTargetOf = (p: string): number => (p === 'High' || p === 'Critical' ? 4 : p === 'Low' ? 72 : 24);
const slaRemainOf = (t: TicketVM): number => slaTargetOf(t.priority) - (t.ageHrs || 0);
const isOverdue = (t: TicketVM): boolean => !isTicketClosed(t.status) && slaRemainOf(t) < 0;
const fmtH = (h: number): string => {
  const x = Math.max(0, h);
  return x < 1 ? `${Math.max(1, Math.round(x * 60))}m` : x < 24 ? `${Math.round(x)}h` : `${Math.round(x / 24)}d`;
};
function slaInfo(t: TicketVM): { text: string; col: string } {
  if (isTicketClosed(t.status)) return { text: t.status, col: 'var(--muted)' };
  const rem = slaRemainOf(t);
  if (rem < 0) return { text: `Overdue ${fmtH(-rem)}`, col: 'var(--danger)' };
  return { text: `Due in ${fmtH(rem)}`, col: rem < slaTargetOf(t.priority) * 0.25 ? 'var(--warn)' : 'var(--ok)' };
}

// Canned replies, keyed on the ticket type (falls back to a generic set).
const QUICK_REPLIES: Record<string, string[]> = {
  'Card Issue': ['Grant a 30-minute override now', 'Confirm the last 3 swipe locations', 'Card reactivated — try again'],
  'Billing Dispute': ['Pulling the invoice now — one moment', 'Credit requested, shows next cycle', 'Could you attach the statement?'],
  Verification: ['Re-running FMCSA verification now', 'DOT/MC verified — cards can ship', 'Need updated authority docs'],
  'Credit Request': ['Escalated to Finance for approval', 'Reviewing payment history now', 'Approved — new limit is active'],
  'Card Request': ['Cards shipping to address on file', 'Please confirm the shipping address', 'Tracking will arrive by email'],
  'Money Code': ['Money code issued — expires in 24h', 'Confirming the driver + amount', 'Redeemed successfully'],
};
const QUICK_REPLIES_DEFAULT = ['Looking into this now — one moment', 'Could you share a document or photo?', 'This is resolved — anything else?'];

const statusBadgeOf = (st: string): BadgeVM => badge(st, tkStatusMap[st] || 'var(--muted)');

const FILTERS: readonly [TicketFilter, string][] = [
  ['all', 'All'],
  ['overdue', 'Overdue'],
  ['active', 'In Progress'],
  ['closed', 'Closed'],
];

const DETAIL_ROW_STYLE = 'font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)';

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
  const unreadCounts = useTicketUnread();

  const spinRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---------- live data ----------
  const ticketsLoad = useLoad(loadTickets, []);
  const msgsLoad = useLoad(
    () => (selectedTicket ? loadTicketMessages(selectedTicket) : Promise.resolve<TicketMsgVM[]>([])),
    [selectedTicket],
  );

  const allTickets: TicketVM[] = ticketsLoad.data?.tickets ?? [];
  const scoped = ticketsLoad.data?.scoped ?? true;

  // Entering the tab via "open this ticket" (e.g. after Create): select it + consume the flag.
  useEffect(() => {
    if (focusTicketId) {
      setSelectedTicket(focusTicketId);
      clearFocusTicket();
    }
  }, [focusTicketId, clearFocusTicket]);

  // Auto-select the first ticket once the list loads; never override an existing selection (a
  // focused/just-created ticket may not be in the recency window yet — its thread still loads by id).
  useEffect(() => {
    const first = ticketsLoad.data?.tickets?.[0];
    if (!first) return;
    setSelectedTicket((cur) => cur || first.id);
  }, [ticketsLoad.data]);

  // The open ticket is "read": clear its unread whenever it accrues (incl. a live comment that
  // arrives while it's on screen), so the sidebar badge never counts what the user is looking at.
  useEffect(() => {
    if (selectedTicket && unreadCounts[selectedTicket]) clearTicketUnread(selectedTicket);
  }, [selectedTicket, unreadCounts]);

  // ---------- real-time (servercrm WS) ----------
  const zohoUserId = getSession()?.worker.zohoUserId ?? '';
  const ticketIds = allTickets.map((t) => t.id);
  const ticketIdsKey = ticketIds.join(',');
  const { resubscribe } = useServerCrmSocket({
    enabled: !!zohoUserId,
    subscribe: { type: 'subscribe', userId: zohoUserId, ticketIds },
    onMessage: (m) => {
      if (m.type !== 'ticket_comment_added' && m.type !== 'ticket_attachment_added') return;
      const tid = String(m.ticketId ?? '');
      if (tid && tid === selectedTicket) {
        msgsLoad.reload();
      } else if (tid) {
        // Not the open ticket — surface a toast (matches the reference dashboard's notification),
        // same as the sidebar unread badge already does for this event.
        const t = allTickets.find((x) => x.id === tid);
        const label = m.type === 'ticket_attachment_added' ? 'New attachment' : 'New message';
        pushToast(label, t ? `#${t.num} · ${t.subject}` : `Ticket #${tid}`);
      }
      ticketsLoad.reload();
    },
  });
  // Push a fresh subscribe frame whenever the loaded ticket-id set changes.
  useEffect(() => {
    resubscribe();
    // eslint-disable-next-line
  }, [ticketIdsKey]);

  // Belt-and-suspenders poll: the WS only ever fires on a new comment/attachment, so a pure status
  // change (re-assigned, closed, reopened — no message) never pushes an event. Without this, that
  // kind of update would only ever appear after a manual refresh.
  useEffect(() => {
    const iv = setInterval(() => ticketsLoad.reload(), 25_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line
  }, []);

  // Auto-scroll the thread to the bottom on selection change / new reply (reference scrollTicket).
  useEffect(() => {
    const el = bodyRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [selectedTicket, msgsLoad.data]);

  useEffect(() => () => { if (spinRef.current) clearTimeout(spinRef.current); }, []);

  // ---------- handlers ----------
  const selectTicket = (id: string): void => {
    clearTicketUnread(id); // opening a ticket marks its new messages read → drops the sidebar badge
    setSelectedTicket(id);
  };

  const refreshTickets = (): void => {
    setTicketsSpin(true);
    ticketsLoad.reload();
    msgsLoad.reload();
    if (spinRef.current) clearTimeout(spinRef.current);
    spinRef.current = setTimeout(() => setTicketsSpin(false), 900);
  };

  const sendTicketReply = async (): Promise<void> => {
    const text = ticketReply.trim();
    const file = attachFile;
    if ((!text && !file) || !selectedTicket || sending) return;
    setSending(true);
    try {
      await replyDeskTicket(selectedTicket, text, file); // empty text + file → server captions it
      // Clear the composer only AFTER the send succeeds — a failed send keeps the draft.
      setTicketReply('');
      setAttachFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      msgsLoad.reload();
      ticketsLoad.reload();
    } catch (e) {
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

  const threadMsgs = msgsLoad.data ?? [];
  const tkInitials = (tkSel?.contact || '?').split(' ').map((w) => w[0]).slice(0, 2).join('');
  const tkStatusBadge = tkSel?.status ? statusBadgeOf(tkSel.status) : { text: '', style: '' };
  const tkCompany = (tkEsc ? tkSel?.targetDept : tkSel?.company) || '—';
  const tkSla = tkSel ? slaInfo(tkSel) : { text: '', col: 'var(--muted)' };
  const quickReplies = tkSel ? QUICK_REPLIES[tkSel.ticketType] ?? QUICK_REPLIES_DEFAULT : QUICK_REPLIES_DEFAULT;

  const detailRows: [string, string, boolean][] = tkSel
    ? [
        ['Department', (tkEsc ? tkSel.targetDept : tkSel.dept) || '—', false],
        ['Priority', tkSel.priority || '—', false],
        ['Assignee', tkSel.agent || 'N/A', true],
        ['Ticket Type', tkSel.ticketType || 'N/A', false],
        ['Channel', tkSel.channel || '—', false],
        ['Carrier ID / Application ID', tkSel.carrierId || 'N/A', false],
        ['Is Escalated', tkSel.escalated ? 'Yes' : 'No', false],
        ['Is Overdue', tkSel.overdue ? 'Yes' : 'No', false],
      ]
    : [];

  const ticketsSpinStyle = ticketsSpin ? 'animation:ss-spin .9s linear infinite' : '';
  const detailsOpen = ticketDetailsOpen && !!tkSel;

  return (
    <>
      <div className="ss-fu" style={s('display:flex;flex-direction:column;gap:10px;height:100%;min-height:0')}>
        {!scoped && (
          <div style={s('flex-shrink:0;display:flex;align-items:center;gap:9px;padding:9px 13px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--warn) 34%,transparent);font-size:12px;color:var(--text2);line-height:1.4')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            <span>Showing <strong style={s('color:var(--text)')}>recent org tickets</strong> — filtering to your own tickets needs the Desk <em>search</em> permission on the connection.</span>
          </div>
        )}
        <div style={s('flex:1;min-height:0;display:flex;gap:14px')}>
        {/* LIST */}
        <div style={s('width:320px;flex-shrink:0;display:flex;flex-direction:column;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)')}>
          <div style={s('padding:14px 15px 12px;border-bottom:1px solid var(--border)')}>
            <div style={s('display:flex;align-items:center;justify-content:space-between;margin-bottom:11px')}>
              <span style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;letter-spacing:.05em;text-transform:uppercase')}>My Tickets</span>
              <div style={s('display:flex;align-items:center;gap:7px')}>
                <span title={scoped ? undefined : 'Showing recent tickets — Desk search scope unavailable'} style={s('font-size:10.5px;font-weight:700;color:var(--ok);display:flex;align-items:center;gap:5px')}><span style={s('width:6px;height:6px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 22%,transparent)')} />LIVE</span>
                <button onClick={refreshTickets} aria-label="Refresh" className="ss-ico-btn" style={s('width:28px;height:28px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={s(ticketsSpinStyle)}><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg></button>
              </div>
            </div>
            <div style={s('position:relative;margin-bottom:9px')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={s('position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--muted)')}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input value={ticketSearch} onChange={(e) => setTicketSearch(e.currentTarget.value)} placeholder="Search tickets…" className="ss-in" style={s('width:100%;height:36px;padding:0 12px 0 34px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:12.5px')} />
            </div>
            <button onClick={() => go('create')} className="ss-btn-p" style={s('width:100%;height:36px;margin-bottom:9px;border-radius:var(--radius-md);border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:12.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              New Ticket
            </button>
            <div style={s('display:flex;gap:3px;padding:3px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
              {FILTERS.map(([id, label]) => {
                const on = tkF === id;
                return (
                  <button key={id} onClick={() => setTicketFilter(id)} style={s(`flex:1;padding:6px 4px;border-radius:var(--radius-md);border:none;cursor:pointer;font-size:11px;font-weight:700;background:${on ? 'var(--accent)' : 'transparent'};color:${on ? '#fff' : 'var(--muted)'};transition:all .14s;white-space:nowrap`)}>{label}</button>
                );
              })}
            </div>
          </div>
          <div className="ss-scroll" style={s('flex:1;min-height:0;padding:11px;display:flex;flex-direction:column;gap:9px')}>
            {ticketsLoad.loading && allTickets.length === 0 &&
              Array.from({ length: 6 }).map((_, i) => (
                <div key={`sk-${i}`} style={s('display:flex;flex-direction:column;gap:10px;padding:13px 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)')}>
                  <div className="ss-skel" style={s('height:13px;width:82%;border-radius:var(--radius-md)')} />
                  <div className="ss-skel" style={s('height:10px;width:44%;border-radius:var(--radius-md)')} />
                  <div style={s('display:flex;align-items:center;gap:8px')}>
                    <div className="ss-skel" style={s('width:22px;height:22px;border-radius:50%')} />
                    <div className="ss-skel" style={s('height:10px;flex:1;border-radius:var(--radius-md)')} />
                  </div>
                </div>
              ))}
            {ticketsLoad.error && (
              <div style={s('padding:40px 16px;text-align:center;color:var(--danger);font-size:12.5px')}>{ticketsLoad.error}</div>
            )}
            {tkList.map((t) => {
              const active = selectedTicket === t.id;
              const esc = t.channel === 'Escalation';
              const unreadN = unreadCounts[t.id] ?? 0;
              const prioCol = tkPrioCol[t.priority] || 'var(--muted)';
              const statusCol = tkStatusMap[t.status] || 'var(--muted)';
              const sla = slaInfo(t);
              const company = (esc ? t.targetDept : t.company) || '—';
              const contact = t.contact || '—';
              const contactInitials = contact === '—' ? '?' : contact.split(' ').map((w) => w[0]).slice(0, 2).join('');
              return (
                <button key={t.id} onClick={() => selectTicket(t.id)} className="ss-card-h" style={s(`position:relative;display:flex;flex-direction:column;gap:9px;padding:13px 14px 13px 15px;border-radius:var(--radius-md);border:1px solid ${active ? 'rgba(var(--accent-rgb),.5)' : 'var(--border)'};border-left:3px solid ${prioCol};background:${active ? 'rgba(var(--accent-rgb),.09)' : 'var(--surface)'};cursor:pointer;transition:all .14s;text-align:left;width:100%`)}>
                  <div style={s('font-size:13px;font-weight:700;line-height:1.35;text-align:left;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical')}>{t.subject}</div>
                  <div style={s('display:flex;align-items:center;gap:8px;font-size:11px')}>
                    <span style={s("font-family:'JetBrains Mono',monospace;color:var(--muted)")}>#{t.num}</span>
                    <span style={s('color:var(--border)')}>·</span>
                    <span style={s(`color:${statusCol};font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{t.status}</span>
                  </div>
                  <div style={s('display:flex;align-items:center;gap:8px')}>
                    <div style={s("width:22px;height:22px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:var(--raised);color:var(--text2);font-size:9.5px;font-weight:700;font-family:Rajdhani,sans-serif")}>{contactInitials}</div>
                    <span style={s('font-size:11.5px;color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{contact} · {company}</span>
                    <span style={s(`margin-left:auto;flex-shrink:0;font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:color-mix(in srgb,${sla.col} 14%,transparent);color:${sla.col};white-space:nowrap`)}>{sla.text}</span>
                    {unreadN > 0 && (
                      <span style={s('flex-shrink:0;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:var(--danger);color:#fff;font-size:10px;font-weight:800;display:inline-flex;align-items:center;justify-content:center')}>{unreadN > 99 ? '99+' : unreadN}</span>
                    )}
                  </div>
                </button>
              );
            })}
            {ticketListEmpty && !ticketsLoad.loading && !ticketsLoad.error && (
              <div style={s('padding:40px 16px;text-align:center;color:var(--muted);font-size:12.5px')}>No tickets match your search.</div>
            )}
          </div>
        </div>

        {/* CHAT */}
        <div style={s('flex:1;min-width:0;display:flex;flex-direction:column;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)')}>
          {tkSel ? (
            <>
              <div style={s('flex-shrink:0;padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:13px')}>
                <div style={s('width:40px;height:40px;border-radius:var(--radius-md);background:linear-gradient(140deg,var(--accent),var(--accent-2));color:#fff;display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;flex-shrink:0')}>{tkInitials}</div>
                <div style={s('flex:1;min-width:0')}>
                  <div style={s('font-size:14.5px;font-weight:700;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{tkSel.subject}</div>
                  <div style={s("font-size:11.5px;color:var(--muted);margin-top:3px;font-family:'JetBrains Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>#{tkSel.num} · {tkCompany} · {tkSel.contact || 'N/A'}</div>
                </div>
                <div style={s('display:flex;align-items:center;gap:6px;flex-shrink:0')}>
                  {tkSla.text && (
                    <span style={s(`flex-shrink:0;font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:99px;background:color-mix(in srgb,${tkSla.col} 14%,transparent);color:${tkSla.col};white-space:nowrap`)}>{tkSla.text}</span>
                  )}
                  <span style={s(tkStatusBadge.style)}>{tkStatusBadge.text}</span>
                  <button onClick={() => setTicketDetailsOpen((v) => !v)} aria-label="Ticket details" className="ss-ico-btn" style={s('width:34px;height:34px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="8" x2="12" y2="8" /></svg></button>
                </div>
              </div>
              <div ref={bodyRef} className="ss-scroll" style={s('flex:1;min-height:0;padding:18px;display:flex;flex-direction:column;gap:14px;background:var(--bg)')}>
                <div style={s('text-align:center;font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)')}>{tkSel.channel} · opened {ageText(tkSel.ageHrs)} ago</div>
                {msgsLoad.loading &&
                  threadMsgs.length === 0 &&
                  [0, 1, 2].map((i) => {
                    const me = i % 2 === 1;
                    return (
                      <div key={`mk-${i}`} style={s(`display:flex;gap:9px;align-items:flex-end;${me ? 'flex-direction:row-reverse' : ''}`)}>
                        <div className="ss-skel" style={s('width:28px;height:28px;border-radius:50%;flex-shrink:0')} />
                        <div className="ss-skel" style={s(`height:${me ? 38 : 48}px;width:${me ? '52%' : '64%'};border-radius:14px`)} />
                      </div>
                    );
                  })}
                {msgsLoad.error && (
                  <div style={s('text-align:center;color:var(--danger);font-size:12.5px;padding:20px')}>{msgsLoad.error}</div>
                )}
                {threadMsgs.map((m, i) => {
                  const me = m.from === 'me';
                  const who = me ? 'You' : m.from || tkSel.agent || 'Support';
                  const type = m.type || 'comment';
                  const rowStyle = `display:flex;gap:9px;align-items:flex-end;${me ? 'flex-direction:row-reverse' : ''}`;
                  const colAlign = me ? 'align-items:flex-end' : 'align-items:flex-start';
                  const avStyle = `width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:${me ? 'linear-gradient(140deg,var(--accent),var(--accent-2))' : 'linear-gradient(140deg,#94a3b8,#64748b)'}`;
                  const bubbleStyle = me
                    ? 'padding:10px 13px;border-radius:14px 14px 4px 14px;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:#fff;font-size:13px;line-height:1.5;word-break:break-word'
                    : 'padding:10px 13px;border-radius:14px 14px 14px 4px;background:var(--alt);border:1px solid var(--border);color:var(--text);font-size:13px;line-height:1.5;word-break:break-word';
                  const attachStyle = `display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--radius-md);border:1px solid ${me ? 'rgba(var(--accent-rgb),.4)' : 'var(--border)'};background:${me ? 'rgba(var(--accent-rgb),.12)' : 'var(--alt)'};cursor:pointer;min-width:190px;max-width:260px`;
                  return (
                    <div key={i} style={s(rowStyle)}>
                      <div style={s(avStyle)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg></div>
                      <div style={s(`display:flex;flex-direction:column;gap:3px;min-width:0;max-width:80%;${colAlign}`)}>
                        {type === 'comment' && <div style={s(bubbleStyle)}>{m.text}</div>}
                        {type === 'attachment' && m.file && (
                          <div onClick={() => downloadAttachment(m.file!)} style={s(attachStyle)}>
                            <div style={s('width:34px;height:34px;border-radius:var(--radius-md);flex-shrink:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--accent) 15%,transparent);color:var(--accent)')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg></div>
                            <div style={s('min-width:0')}><div style={s('font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{m.file.name}</div><div style={s('font-size:10.5px;color:var(--muted)')}>{[m.file.size, 'Click to download'].filter(Boolean).join(' · ')}</div></div>
                          </div>
                        )}
                        <span style={s('font-size:10px;color:var(--muted);padding:0 4px')}>{who} · {m.time}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {tkOpen && (
                // The right padding keeps the composer (incl. the send button) clear of the shell's
                // fixed AI-copilot FAB, which floats over the bottom-right corner on this full-bleed tab.
                <div style={s('flex-shrink:0;border-top:1px solid var(--border)')}>
                  <div className="ss-scroll" style={s('display:flex;gap:7px;padding:11px 78px 0 14px;overflow-x:auto')}>
                    {quickReplies.map((qr) => (
                      <button key={qr} onClick={() => setTicketReply(qr)} className="ss-tab-x" style={s('flex-shrink:0;padding:6px 12px;border-radius:99px;border:1px solid var(--border);background:var(--alt);color:var(--text2);font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap')}>{qr}</button>
                    ))}
                  </div>
                  {attachFile && (
                    <div style={s('display:flex;align-items:center;gap:8px;margin:9px 78px 0 14px;padding:7px 11px;border-radius:var(--radius-md);background:rgba(var(--accent-rgb),.1);border:1px solid rgba(var(--accent-rgb),.3);width:fit-content;max-width:calc(100% - 92px)')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                      <span style={s('font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{attachFile.name}</span>
                      <button onClick={() => { setAttachFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} aria-label="Remove attachment" style={s('flex-shrink:0;border:none;background:transparent;color:var(--danger);font-size:11px;font-weight:700;cursor:pointer')}>✕</button>
                    </div>
                  )}
                  <div style={s('padding:11px 78px 12px 14px;display:flex;gap:10px;align-items:flex-end')}>
                    <input ref={fileInputRef} type="file" onChange={onPickFile} style={{ display: 'none' }} />
                    <button onClick={() => fileInputRef.current?.click()} aria-label="Attach file" title="Attach a file" className="ss-ico-btn" style={s(`width:40px;height:40px;flex-shrink:0;border-radius:var(--radius-md);border:1px solid ${attachFile ? 'rgba(var(--accent-rgb),.5)' : 'var(--border)'};background:${attachFile ? 'rgba(var(--accent-rgb),.12)' : 'var(--alt)'};color:${attachFile ? 'var(--accent)' : 'var(--text2)'};cursor:pointer;display:flex;align-items:center;justify-content:center`)}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg></button>
                    <input value={ticketReply} onChange={(e) => setTicketReply(e.currentTarget.value)} onKeyDown={ticketReplyKey} onPaste={onPasteReply} placeholder={attachFile ? 'Add a message (optional)…' : 'Type or paste a reply…'} className="ss-in" style={s('flex:1;height:40px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13px')} />
                    <button onClick={sendTicketReply} disabled={sending} aria-label="Send reply" className="ss-btn-p" style={s(`width:40px;height:40px;flex-shrink:0;border-radius:var(--radius-md);border:none;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:#fff;cursor:${sending ? 'default' : 'pointer'};opacity:${sending ? '.7' : '1'};display:flex;align-items:center;justify-content:center`)}>{sending ? <span style={s('width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:ss-spin .8s linear infinite')} /> : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>}</button>
                  </div>
                </div>
              )}
              {tkClosed && (
                <div style={s('flex-shrink:0;padding:15px;border-top:1px solid var(--border);text-align:center;font-size:12px;color:var(--muted);background:var(--alt)')}>This ticket is {tkStatusBadge.text}. Reopen it to reply.</div>
              )}
            </>
          ) : (
            <div style={s('flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;color:var(--muted);padding:24px;text-align:center')}><div style={s('width:64px;height:64px;border-radius:var(--radius-md);background:var(--raised);display:flex;align-items:center;justify-content:center;color:var(--accent)')}><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg></div><div style={s('font-size:14px;font-weight:700;color:var(--text)')}>{ticketsLoad.loading ? 'Loading tickets…' : ticketsLoad.error ? 'Could not load tickets' : 'No ticket selected'}</div><div style={s('font-size:12.5px')}>{ticketsLoad.error ? ticketsLoad.error : 'Pick a ticket from the list to view the thread and reply.'}</div></div>
          )}
        </div>
        </div>
      </div>

      {detailsOpen && tkSel && (
        <>
          <div onClick={() => setTicketDetailsOpen(false)} style={s('position:fixed;inset:0;z-index:130;background:rgba(3,7,14,.5);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)')} />
          <div style={s('position:fixed;top:0;right:0;bottom:0;z-index:131;width:330px;max-width:92vw;background:var(--surface);border-left:1px solid var(--border);box-shadow:var(--shadow);display:flex;flex-direction:column;animation:ss-slidein .25s cubic-bezier(.2,0,0,1) both')}>
            <div style={s('display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--border)')}>
              <span style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;letter-spacing:.05em;text-transform:uppercase')}>Ticket Details</span>
              <button onClick={() => setTicketDetailsOpen(false)} className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
            </div>
            <div className="ss-scroll" style={s('flex:1;min-height:0;padding:16px 18px 22px;display:flex;flex-direction:column;gap:15px')}>
              <div><div style={s(`${DETAIL_ROW_STYLE};margin-bottom:5px`)}>Subject</div><div style={s('font-size:13.5px;font-weight:700;line-height:1.4')}>{tkSel.subject}</div></div>
              <div><div style={s(`${DETAIL_ROW_STYLE};margin-bottom:5px`)}>Description</div><div style={s('padding:11px 12px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2);font-size:12.5px;line-height:1.5;color:var(--text2);white-space:pre-wrap')}>{tkSel.description || '—'}</div></div>
              <div><div style={s(`${DETAIL_ROW_STYLE};margin-bottom:6px`)}>Status</div><span style={s(tkStatusBadge.style)}>{tkStatusBadge.text}</span></div>
              {detailRows.map(([label, value, accent]) => (
                <div key={label}><div style={s(`${DETAIL_ROW_STYLE};margin-bottom:4px`)}>{label}</div><div style={s(`font-size:12.5px;font-weight:700;color:${accent ? 'var(--accent)' : 'var(--text)'}`)}>{value}</div></div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
