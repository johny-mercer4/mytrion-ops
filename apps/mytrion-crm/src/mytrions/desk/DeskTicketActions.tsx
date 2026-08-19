import { useCallback, useState } from 'react';
import { Button, Dialog } from '@/ds';
import {
  listTicketEvents,
  setTicketStatus,
  type TicketDto,
  type TicketEventDto,
  type TicketStatus,
} from '@/api/comms';
import styles from './desk.module.css';

interface StatusAction {
  to: TicketStatus;
  label: string;
  variant: 'primary' | 'secondary' | 'ghost' | 'danger';
}

/** The status moves offered from a given status — the "work a ticket" lifecycle. */
function statusActions(status: TicketStatus): StatusAction[] {
  if (status === 'resolved') {
    return [
      { to: 'open', label: 'Reopen', variant: 'secondary' },
      { to: 'closed', label: 'Close', variant: 'ghost' },
    ];
  }
  if (status === 'closed' || status === 'cancelled') {
    return [{ to: 'open', label: 'Reopen', variant: 'secondary' }];
  }
  const actions: StatusAction[] = [];
  if (status !== 'in_progress') actions.push({ to: 'in_progress', label: 'In progress', variant: 'secondary' });
  actions.push({ to: 'resolved', label: 'Resolve', variant: 'primary' });
  actions.push({ to: 'closed', label: 'Close', variant: 'ghost' });
  return actions;
}

function eventLabel(e: TicketEventDto): string {
  if (e.eventType === 'status_changed' && e.fromStatus && e.toStatus) {
    return `Status: ${e.fromStatus.replace(/_/g, ' ')} → ${e.toStatus.replace(/_/g, ' ')}`;
  }
  return e.eventType.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Ticket lifecycle actions rendered in the conversation header (via TicketConsole's `chatActions`).
 * Status moves carry the ticket's version, so a change made against a stale view 409s rather than
 * overwriting; the console refreshes off the realtime frame the transition publishes. "History" opens
 * the append-only activity trail (assignments, transitions, escalation hops).
 */
export function DeskTicketActions({ ticket }: { ticket: TicketDto }) {
  const [busyTo, setBusyTo] = useState<TicketStatus | null>(null);
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [events, setEvents] = useState<TicketEventDto[] | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);

  const act = useCallback(
    async (to: TicketStatus) => {
      if (busyTo) return;
      setBusyTo(to);
      setError('');
      try {
        await setTicketStatus(ticket.id, to, ticket.version);
        // The console reloads the row (and this header) from the realtime frame the change publishes.
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyTo(null);
      }
    },
    [busyTo, ticket.id, ticket.version],
  );

  const openHistory = useCallback(async () => {
    setHistoryOpen(true);
    setEventsLoading(true);
    try {
      setEvents(await listTicketEvents(ticket.id));
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [ticket.id]);

  return (
    <div className={styles.ticketActions}>
      {statusActions(ticket.status).map((a) => (
        <Button
          key={a.to}
          size="sm"
          variant={a.variant}
          onClick={() => void act(a.to)}
          loading={busyTo === a.to}
          disabled={busyTo !== null}
        >
          {a.label}
        </Button>
      ))}
      <Button size="sm" variant="ghost" onClick={() => void openHistory()}>
        History
      </Button>
      {error ? (
        <span className={styles.ticketActionsError} role="alert">
          {error}
        </span>
      ) : null}

      <Dialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Activity"
        subtitle={ticket.number}
        size="sm"
      >
        {eventsLoading ? (
          <p className={styles.cardHint}>Loading…</p>
        ) : events && events.length > 0 ? (
          <ul className={styles.timeline}>
            {events.map((e) => (
              <li key={e.id} className={styles.timelineItem}>
                <span className={styles.timelineDot} aria-hidden="true" />
                <div className={styles.timelineBody}>
                  <span className={styles.timelineType}>{eventLabel(e)}</span>
                  <span className={styles.timelineMeta}>
                    {e.actor.name ?? 'System'} · {new Date(e.occurredAt).toLocaleString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.cardHint}>No activity yet.</p>
        )}
      </Dialog>
    </div>
  );
}
