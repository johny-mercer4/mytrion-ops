import { useCallback, useState } from 'react';
import { Button, Dialog, Select, type SelectOption } from '@/ds';
import {
  listTicketEvents,
  setTicketPriority,
  setTicketStatus,
  type TicketDto,
  type TicketEventDto,
  type TicketPriority,
  type TicketStatus,
} from '@/api/comms';
import { DeskAssignControls } from './DeskAssignControls';
import { DeskTicketTags } from './DeskTicketTags';
import styles from './desk.module.css';

const PRIORITY_OPTS: SelectOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

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
  if (e.eventType === 'priority_changed' && e.detail) {
    const from = typeof e.detail.from === 'string' ? e.detail.from : null;
    const to = typeof e.detail.to === 'string' ? e.detail.to : null;
    if (from && to) return `Priority: ${from} → ${to}`;
  }
  return e.eventType.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Ticket lifecycle actions rendered in the conversation header (via TicketConsole's `chatActions`).
 * Status moves carry the ticket's version, so a change made against a stale view 409s rather than
 * overwriting; the console refreshes off the realtime frame the transition publishes. "History" opens
 * the append-only activity trail (assignments, transitions, escalation hops).
 */
export function DeskTicketActions({
  ticket,
  me,
  admin,
}: {
  ticket: TicketDto;
  /** Signed-in worker's Zoho id + admin flag — passed through to the assignment cluster. */
  me: string;
  admin: boolean;
}) {
  const [busyTo, setBusyTo] = useState<TicketStatus | null>(null);
  const [error, setError] = useState('');
  const [prioBusy, setPrioBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
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

  const changePriority = useCallback(
    async (next: string | null) => {
      if (!next || next === ticket.priority || prioBusy) return;
      setPrioBusy(true);
      setError('');
      try {
        await setTicketPriority(ticket.id, next as TicketPriority, ticket.version);
        // The list (and this header) reload off the realtime frame the change publishes.
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPrioBusy(false);
      }
    },
    [ticket.id, ticket.priority, ticket.version, prioBusy],
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
      <DeskAssignControls ticket={ticket} me={me} admin={admin} />
      <span className={styles.priorityWrap} title="Priority">
        <Select
          label="Priority"
          labelHidden
          searchable={false}
          options={PRIORITY_OPTS}
          value={ticket.priority}
          onChange={(v) => void changePriority(v)}
          loading={prioBusy}
        />
      </span>
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
      <Button size="sm" variant="ghost" onClick={() => setTagsOpen(true)}>
        Tags{ticket.tags.length > 0 ? ` (${ticket.tags.length})` : ''}
      </Button>
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

      <Dialog
        open={tagsOpen}
        onClose={() => setTagsOpen(false)}
        title="Tags"
        subtitle={ticket.number}
        size="sm"
      >
        <DeskTicketTags ticket={ticket} />
      </Dialog>
    </div>
  );
}
