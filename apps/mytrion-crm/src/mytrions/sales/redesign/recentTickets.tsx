/**
 * "Your recent tickets" strip under the Create-tab wizard — the ONLY place a rep can change a
 * ticket's Zoho Desk priority after filing it (the Tickets tab is parked, so nothing else in the
 * client reads Desk tickets). Reads the creator-scoped `GET /v1/desk/tickets` and PATCHes
 * `/desk/tickets/:id/priority`, which re-checks ownership server-side.
 *
 * Changing a priority is a select-shaped dropdown + a confirmation modal: the pick is staged, and
 * nothing reaches Desk until the rep confirms — a mis-click on a queue-visible field costs nothing.
 * The row only shows the new value once Desk has accepted it.
 */
import { useState } from 'react';
import { s } from './dc';
import { Icon } from './icons';
import { useSales } from './ctx';
import { useLoad, relTime } from './live';
import { Skel } from './SalesPage';
import { DROP_PANEL } from './createTicketShared';
import {
  listMyDeskTickets,
  NO_PRIORITY,
  updateDeskTicketPriority,
  type MyDeskTicket,
  type PriorityValue,
} from '@/api/desk';

const ROWS = 5;
const OPTIONS: readonly PriorityValue[] = [NO_PRIORITY, 'Low', 'Medium', 'High'];

const CARD =
  'padding:18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm);margin-top:18px';
const ROW =
  'display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:11px 0;border-top:1px solid var(--border)';
/** Select-shaped trigger — the app's own dropdown, because a native <select> popup is drawn by the
 *  OS: unthemed, and in this shell it lands detached from the control. */
const TRIGGER =
  'display:flex;align-items:center;justify-content:space-between;gap:8px;width:126px;height:36px;padding:0 10px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);font-size:13px;font-weight:700;cursor:pointer';

const TONE: Record<PriorityValue, string> = {
  [NO_PRIORITY]: 'var(--muted)',
  Low: 'var(--ok)',
  Medium: 'var(--orange)',
  High: 'var(--danger)',
};

/** Desk's own value is '-None-'; agents read "None". */
function label(p: PriorityValue): string {
  return p === NO_PRIORITY ? 'None' : p;
}

/** The staged change awaiting confirmation. */
interface Pending {
  ticket: MyDeskTicket;
  next: PriorityValue;
}

function ConfirmModal({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: Pending;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { ticket, next } = pending;
  return (
    <div className="ss-scrim" style={{ zIndex: 140 }} onClick={busy ? undefined : onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ss-prio-confirm-title"
        onClick={(e) => e.stopPropagation()}
        style={s('width:min(420px,92vw);padding:22px;border-radius:var(--radius-lg);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow)')}
      >
        <div id="ss-prio-confirm-title" style={s('font-size:17px;font-weight:800;color:var(--text)')}>
          Change priority?
        </div>
        <div style={s('margin-top:8px;font-size:14px;color:var(--text2);line-height:1.5')}>
          {ticket.ticketNumber ? `#${ticket.ticketNumber} · ` : ''}
          {ticket.subject || 'This ticket'}
        </div>
        <div style={s('margin-top:14px;display:flex;align-items:center;gap:10px;font-size:14px;font-weight:700')}>
          <span style={s(`color:${TONE[ticket.priority]}`)}>{label(ticket.priority)}</span>
          <span style={s('color:var(--faint)')}>→</span>
          <span style={s(`color:${TONE[next]}`)}>{label(next)}</span>
        </div>
        <div style={s('margin-top:6px;font-size:13px;color:var(--muted)')}>
          This updates the ticket in Zoho Desk, where the handling team sees it.
        </div>
        <div style={s('margin-top:20px;display:flex;justify-content:flex-end;gap:10px')}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={s('height:42px;padding:0 18px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);font-size:14px;font-weight:700;cursor:pointer')}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={s(`height:42px;padding:0 18px;border-radius:var(--radius-md);border:none;background:var(--accent);color:var(--on-accent);font-size:14px;font-weight:700;cursor:${busy ? 'wait' : 'pointer'}`)}
          >
            {busy ? 'Updating…' : `Set ${label(next)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Skeleton rows — one loading affordance for this region, shaped like the real rows. */
function StripSkeleton() {
  return (
    <div>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} style={s(`${ROW};${i === 0 ? 'border-top:none' : ''}`)}>
          <Skel w="78px" h="14px" radius="var(--radius-xs)" />
          <Skel w="100%" h="14px" radius="var(--radius-xs)" style={{ flex: 1, minWidth: '120px' }} />
          <Skel w="110px" h="36px" />
        </div>
      ))}
    </div>
  );
}

function TicketRow({ ticket, first, onPick }: { ticket: MyDeskTicket; first: boolean; onPick: (p: Pending) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={s(`${ROW};${first ? 'border-top:none' : ''}`)}>
      <div style={s('display:flex;align-items:center;gap:10px;min-width:0;flex:1')}>
        {ticket.ticketNumber ? (
          <span style={s('font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--accent);flex-shrink:0')}>
            #{ticket.ticketNumber}
          </span>
        ) : null}
        <span style={s('font-size:14px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0')}>
          {ticket.subject || 'Untitled ticket'}
        </span>
        {ticket.status ? <span style={s('font-size:12px;color:var(--muted);flex-shrink:0')}>{ticket.status}</span> : null}
        {ticket.createdTime ? (
          <span style={s('font-size:12px;color:var(--faint);flex-shrink:0')}>{relTime(ticket.createdTime)}</span>
        ) : null}
      </div>
      {/* The open row must out-stack LATER rows: positioned siblings at equal z-index paint in DOM
          order, so without this the next row's trigger draws through the panel. */}
      <div style={s(`position:relative;flex-shrink:0${open ? ';z-index:12' : ''}`)}>
        <button
          type="button"
          aria-label={`Priority for ticket ${ticket.ticketNumber || ticket.id}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          style={s(`${TRIGGER};color:${TONE[ticket.priority]}`)}
        >
          <span>{ticket.priority === NO_PRIORITY ? 'Set priority' : label(ticket.priority)}</span>
          <Icon name="chevronDown" size={14} color="var(--muted)" style={{ flexShrink: 0 }} />
        </button>
        {open ? (
          <>
            <div onClick={() => setOpen(false)} style={s('position:fixed;inset:0;z-index:8')} />
            {/* DROP_PANEL paints var(--surface), which is GLASS in this shell (alpha .72) — over a
                ticket row the text below reads through it. Layer it on an opaque token. */}
            <div
              role="listbox"
              aria-label="Priority"
              style={s(
                `${DROP_PANEL};left:auto;right:0;width:126px;background:linear-gradient(var(--surface),var(--surface)),var(--surface-alt)`,
              )}
            >
              {OPTIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="option"
                  aria-selected={p === ticket.priority}
                  onClick={() => {
                    setOpen(false);
                    if (p !== ticket.priority) onPick({ ticket, next: p });
                  }}
                  style={s(
                    `display:flex;align-items:center;justify-content:space-between;width:100%;height:36px;padding:0 10px;border:none;border-radius:var(--radius-sm);background:${p === ticket.priority ? 'var(--alt)' : 'transparent'};color:${TONE[p]};font-size:13px;font-weight:700;cursor:pointer;text-align:left`,
                  )}
                >
                  {label(p)}
                  {p === ticket.priority ? <Icon name="check" size={14} color={TONE[p]} /> : null}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** `refreshKey` bumps when the wizard files a ticket, so the new one appears without a reload. */
export function RecentTicketsStrip({ refreshKey = 0 }: { refreshKey?: number }) {
  const { pushToast } = useSales();
  const load = useLoad(() => listMyDeskTickets(ROWS), [refreshKey]);
  const [edits, setEdits] = useState<Record<string, PriorityValue>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const tickets = (load.data ?? []).map((t) => {
    const edit = edits[t.id];
    return edit ? { ...t, priority: edit } : t;
  });

  const confirm = async (): Promise<void> => {
    if (!pending || busy) return;
    const { ticket, next } = pending;
    setBusy(true);
    try {
      const saved = await updateDeskTicketPriority(ticket.id, next);
      setEdits((prev) => ({ ...prev, [ticket.id]: saved }));
      setPending(null);
      pushToast(
        'Priority updated',
        saved === NO_PRIORITY
          ? `${ticket.ticketNumber ? `#${ticket.ticketNumber}` : 'Ticket'} has no priority now.`
          : `${ticket.ticketNumber ? `#${ticket.ticketNumber}` : 'Ticket'} is now ${saved}.`,
      );
    } catch (e) {
      pushToast('Couldn’t change priority', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={s(CARD)}>
      <div style={s('display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:6px')}>
        <div style={s('font-size:13px;font-weight:700;color:var(--text);text-transform:uppercase;letter-spacing:.05em')}>
          Your recent tickets
        </div>
        <div style={s('font-size:12px;color:var(--faint)')}>Priority is editable after filing</div>
      </div>
      {load.loading ? (
        <StripSkeleton />
      ) : load.error ? (
        <div style={s('padding:12px 0;font-size:13px;color:var(--muted)')}>
          Couldn’t load your tickets — {load.error}.{' '}
          <button type="button" onClick={load.reload} style={s('border:none;background:transparent;color:var(--accent);font-size:13px;font-weight:700;cursor:pointer;padding:0')}>
            Retry
          </button>
        </div>
      ) : tickets.length === 0 ? (
        <div style={s('padding:12px 0;font-size:13px;color:var(--muted)')}>
          Nothing filed yet — tickets you create show up here.
        </div>
      ) : (
        tickets.map((t, i) => <TicketRow key={t.id} ticket={t} first={i === 0} onPick={setPending} />)
      )}
      {pending ? (
        <ConfirmModal
          pending={pending}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </div>
  );
}
