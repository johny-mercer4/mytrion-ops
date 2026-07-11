/**
 * Sales Mytrion redesign — Inbox tab. Ported verbatim from the reference prototype's
 * `isInbox` slice + renderVals() view-model (script.js). Filter tabs (All/Unread/Tasks/
 * Alerts/Reminders) with live counts; message rows with a type icon + colored bar, priority
 * badge, tag, unread dot, per-row mark-read + delete actions; "Mark all read"; empty state.
 * DATA: live CRM inbox via loadInbox() (inbox.list); delete via deleteInboxMessage (optimistic);
 * read-state kept local in localStorage; real-time refresh over the servercrm WebSocket
 * (subscribe {type:'subscribe'} → reload on crm_inbox_notification).
 */
import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { getSession } from '@/api/session';
import { useImpersonation } from '@/context/ImpersonationProvider';
import { s, Svg } from '../dc';
import { badge, iconBox, ICO } from '../salesData';
import { useSales } from '../ctx';
import { useLoad, loadInbox, deleteInboxMessage, type InboxVM } from '../live';
import { useServerCrmSocket } from '../useServerCrmSocket';

type InboxItem = InboxVM;
type IType = InboxItem['type'];
type FilterId = 'all' | 'unread' | 'task' | 'alert' | 'reminder';

// type → icon path / bar color (reference iconOf/colOf)
const iconOf: Record<IType, string> = {
  critical: ICO.warn, task: ICO.check, warning: ICO.warn, reminder: ICO.clock, info: ICO.bell,
};
const colOf: Record<IType, string> = {
  critical: 'var(--danger)', task: 'var(--accent)', warning: 'var(--orange)', reminder: 'var(--warn)', info: 'var(--ok)',
};
const prioCol: Record<string, string> = {
  high: 'var(--danger)', medium: 'var(--warn)', small: 'var(--ok)', low: 'var(--ok)',
};

const TAB_DEFS: ReadonlyArray<readonly [FilterId, string]> = [
  ['all', 'All'], ['unread', 'Unread'], ['task', 'Tasks'], ['alert', 'Alerts'], ['reminder', 'Reminders'],
];

// ---- read-state (local, persisted to localStorage) ----
const READ_KEY = 'octane.sales.redesign.inbox.read';
function loadReadIds(): Record<string, boolean> {
  try {
    const ids = JSON.parse(localStorage.getItem(READ_KEY) ?? '[]') as string[];
    const r: Record<string, boolean> = {};
    for (const id of ids) r[id] = true;
    return r;
  } catch {
    return {};
  }
}
function persistReadIds(read: Record<string, boolean>): void {
  try {
    const ids = Object.keys(read).filter((k) => read[k]);
    localStorage.setItem(READ_KEY, JSON.stringify(ids.slice(-500)));
  } catch {
    /* noop */
  }
}

export function InboxTab() {
  const { openDetail, pushToast } = useSales();
  const { actingAs } = useImpersonation();
  const [inboxFilter, setInboxFilter] = useState<string>('all');
  const [read, setRead] = useState<Record<string, boolean>>(() => loadReadIds());
  const [items, setItems] = useState<InboxItem[]>([]);
  const [wsReady, setWsReady] = useState(false);

  // The effective CRM user this inbox belongs to (the acted-as agent for an admin, else the
  // signed-in worker) — the same id the fetch is scoped to and that WS events must match.
  const currentUserId = String(actingAs?.zohoUserId ?? getSession()?.worker.zohoUserId ?? '');

  // ---- live data (inbox.list) mirrored into local state for optimistic delete ----
  const { data, loading, error, reload } = useLoad(loadInbox, []);
  useEffect(() => {
    if (data) setItems(data);
  }, [data]);
  useEffect(() => {
    persistReadIds(read);
  }, [read]);

  // ---- real-time: only react to a notification addressed to THIS user (ownerId === currentUserId),
  //      exactly like the reference self-service InboxPanel._handleWsMessage — toast + refetch. ----
  useServerCrmSocket({
    subscribe: { type: 'subscribe' },
    onOpen: () => setWsReady(true),
    onClose: () => setWsReady(false),
    onMessage: (msg) => {
      if (msg.type !== 'crm_inbox_notification') return;
      const ownerId = String(msg.ownerId ?? '');
      if (ownerId && currentUserId && ownerId === currentUserId) {
        pushToast('New message', String(msg.subject ?? msg.name ?? 'New notification'));
        reload();
      }
    },
  });

  // ---- view-model (mirrors renderVals()) ----
  const fMatch = (i: InboxItem): boolean => {
    const f = inboxFilter;
    if (f === 'all') return true;
    if (f === 'unread') return !read[i.id];
    if (f === 'alert') return i.type === 'warning' || i.type === 'critical';
    if (f === 'reminder') return i.type === 'reminder' || i.type === 'info';
    return i.type === f;
  };
  const iCount: Record<FilterId, number> = {
    all: items.length,
    unread: items.filter((i) => !read[i.id]).length,
    task: items.filter((i) => i.type === 'task').length,
    alert: items.filter((i) => i.type === 'warning' || i.type === 'critical').length,
    reminder: items.filter((i) => i.type === 'reminder' || i.type === 'info').length,
  };
  const filtered = items.filter(fMatch);
  const isInitialLoading = loading && items.length === 0;
  const hasError = Boolean(error) && items.length === 0;
  const inboxHas = filtered.length > 0;
  const inboxEmpty = !isInitialLoading && !hasError && filtered.length === 0;
  const inboxUnreadHas = iCount.unread > 0;
  const inboxEmptyLabel = inboxFilter === 'all' ? '' : inboxFilter + ' ';

  // ---- handlers ----
  const markAllRead = () => {
    const r = { ...read };
    items.forEach((i) => { r[i.id] = true; });
    setRead(r);
    pushToast('All caught up', 'Marked everything as read');
  };
  const markReadOnly = (i: InboxItem, e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setRead((sr) => ({ ...sr, [i.id]: true }));
  };
  const deleteInbox = (i: InboxItem, e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setItems((xs) => xs.filter((x) => x.id !== i.id));
    pushToast('Message removed', '');
    void deleteInboxMessage(i.id).catch((err: unknown) => {
      pushToast('Delete failed', err instanceof Error ? err.message : 'Could not remove the message');
    });
  };
  const openInbox = (i: InboxItem) => {
    setRead((sr) => ({ ...sr, [i.id]: true }));
    openDetail({
      title: i.title,
      body: i.desc,
      icon: iconOf[i.type],
      iconStyle: iconBox(colOf[i.type], 44),
      metaLabel: 'Received:',
      meta: i.time,
      badges: [badge(i.prio.toUpperCase(), colOf[i.type]), ...(i.tag ? [badge(i.tag, 'var(--muted)')] : [])],
    });
  };

  return (
    <div className="ss-fu">
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px')}>
        <div>
          <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase')}>Inbox</div>
          <div style={s('font-size:12.5px;color:var(--muted);margin-top:2px')}>Reminders, alerts &amp; tasks assigned to you</div>
        </div>
        <div style={s('display:flex;align-items:center;gap:9px')}>
          <span style={s(`display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:${wsReady ? 'var(--ok)' : 'var(--muted)'}`)}>
            <span style={s(`width:7px;height:7px;border-radius:50%;background:${wsReady ? 'var(--ok)' : 'var(--muted)'};box-shadow:0 0 0 3px color-mix(in srgb,${wsReady ? 'var(--ok)' : 'var(--muted)'} 22%,transparent)`)}></span>{wsReady ? 'LIVE' : 'OFFLINE'}
          </span>
          {inboxUnreadHas && (
            <button onClick={markAllRead} className="ss-ico-btn" style={s('height:34px;padding:0 13px;border-radius:9px;border:1px solid var(--border);background:var(--surface);color:var(--text2);font-size:12px;font-weight:700;cursor:pointer')}>Mark all read</button>
          )}
        </div>
      </div>
      <div style={s('display:flex;gap:9px;margin-bottom:16px;overflow-x:auto;padding-bottom:4px')}>
        {TAB_DEFS.map(([id, label]) => {
          const on = inboxFilter === id;
          const count = iCount[id];
          const style = `padding:8px 15px;border:1px solid ${on ? 'rgba(var(--accent-rgb),.4)' : 'var(--border)'};background:${on ? 'rgba(var(--accent-rgb),.12)' : 'var(--surface)'};color:${on ? 'var(--accent)' : 'var(--muted)'};border-radius:99px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .14s`;
          return (
            <button key={id} onClick={() => setInboxFilter(id)} style={s(style)}>
              {label} {count > 0 && (<span style={s('opacity:.7')}>· {String(count)}</span>)}
            </button>
          );
        })}
      </div>
      {isInitialLoading && (
        <div style={s('text-align:center;padding:64px 20px;color:var(--muted);font-size:13px')}>Loading…</div>
      )}
      {hasError && (
        <div style={s('text-align:center;padding:64px 20px;color:var(--danger);font-size:13px')}>{error}</div>
      )}
      {inboxHas && (
        <div style={s('display:flex;flex-direction:column;gap:11px')}>
          {filtered.map((i) => {
            const unread = !read[i.id];
            const barColor = colOf[i.type];
            const rowStyle = `display:flex;gap:13px;padding:15px 16px;border-radius:14px;background:var(--surface);border:1px solid ${unread ? 'rgba(var(--accent-rgb),.25)' : 'var(--border)'};cursor:pointer;box-shadow:var(--shadow-sm);position:relative;overflow:hidden`;
            const prioBadge = badge(i.prio.toUpperCase(), prioCol[i.prio] || 'var(--muted)');
            return (
              <div key={i.id} onClick={() => openInbox(i)} className="ss-card-h" style={s(rowStyle)}>
                <div style={s('position:absolute;left:0;top:0;bottom:0;width:3px;background:' + barColor)}></div>
                {unread && (<div style={s('position:absolute;left:11px;top:14px;width:7px;height:7px;border-radius:50%;background:var(--accent)')}></div>)}
                <div style={s(iconBox(colOf[i.type], 38) + ';margin-left:6px')}><Svg d={iconOf[i.type]} size={16} /></div>
                <div style={s('flex:1;min-width:0')}>
                  <div style={s('font-size:13.5px;font-weight:700;line-height:1.3')}>{i.title}</div>
                  <div style={s('font-size:12px;color:var(--muted);margin-top:4px;line-height:1.45;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical')}>{i.desc}</div>
                  <div style={s('display:flex;align-items:center;gap:7px;margin-top:9px;flex-wrap:wrap')}>
                    <span style={s("font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace")}>{i.time}</span>
                    <span style={s(prioBadge.style)}>{prioBadge.text}</span>
                    {i.tag && <span style={s('font-size:10px;font-weight:700;padding:3px 8px;border-radius:99px;background:var(--raised);color:var(--text2)')}>{i.tag}</span>}
                  </div>
                </div>
                <div style={s('display:flex;flex-direction:column;gap:6px;flex-shrink:0')}>
                  {unread && (
                    <button onClick={(e) => markReadOnly(i, e)} aria-label="Mark read" className="ss-ico-btn" style={s('width:28px;height:28px;border-radius:8px;border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}>
                      <Svg d="M5 13l4 4L19 7" size={14} strokeWidth={2.4} />
                    </button>
                  )}
                  <button onClick={(e) => deleteInbox(i, e)} aria-label="Delete" className="ss-ico-btn" style={s('width:28px;height:28px;border-radius:8px;border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {inboxEmpty && (
        <div style={s('text-align:center;padding:64px 20px;color:var(--muted)')}>
          <div style={s('width:72px;height:72px;border-radius:50%;background:var(--raised);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:var(--ok)')}>
            <Svg d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" size={34} strokeWidth={1.6} />
          </div>
          <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:18px;text-transform:uppercase;letter-spacing:.05em;color:var(--text)')}>All caught up!</div>
          <div style={s('font-size:13px;margin-top:5px')}>No {inboxEmptyLabel}notifications right now.</div>
        </div>
      )}
    </div>
  );
}
