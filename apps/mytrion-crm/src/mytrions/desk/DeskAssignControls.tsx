import { useCallback, useState } from 'react';
import { UserCheck, UserPlus, UserX } from 'lucide-react';
import { Button, Dialog } from '@/ds';
import {
  assignTicket,
  getQueueRoster,
  releaseTicket,
  type RosterMemberDto,
  type TicketDto,
} from '@/api/comms';
import styles from './desk.module.css';

/**
 * Ticket assignment cluster for the conversation header: claim, assign/reassign to a roster colleague, or
 * hand back to the queue. The candidate pool IS the department roster the round-robin draws from, fetched
 * on demand when the picker opens so the two can never disagree about who works the queue. Every action's
 * result reaches the list and this header through the realtime frame the queue routes publish, so there is
 * no local mutation to reconcile — the console reloads the row.
 */
export function DeskAssignControls({
  ticket,
  me,
  admin,
}: {
  ticket: TicketDto;
  /** The signed-in worker's Zoho id — tells "assigned to you" from "assigned to <name>". */
  me: string;
  admin: boolean;
}) {
  const [busy, setBusy] = useState<'claim' | 'release' | 'reassign' | null>(null);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [roster, setRoster] = useState<RosterMemberDto[] | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);

  const assignee = ticket.assignee;
  const mine = assignee?.zohoUserId === me;
  // Assigning to a colleague needs a department to draw a roster from; claiming for yourself does not.
  const canAssignOther = ticket.targetDepartment !== null;
  // Releasing someone else's ticket is an admin act — the backend enforces this too; the UI just hides it.
  const canRelease = Boolean(assignee) && (mine || admin);

  const run = useCallback(
    async (kind: 'claim' | 'release', fn: () => Promise<unknown>) => {
      if (busy) return;
      setBusy(kind);
      setError('');
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [busy],
  );

  const openPicker = useCallback(async () => {
    const dept = ticket.targetDepartment;
    if (!dept) return;
    setPickerOpen(true);
    setRosterLoading(true);
    try {
      setRoster((await getQueueRoster(dept)).roster);
    } catch {
      setRoster([]);
    } finally {
      setRosterLoading(false);
    }
  }, [ticket.targetDepartment]);

  const assignTo = useCallback(
    async (zohoUserId: string) => {
      setBusy('reassign');
      setError('');
      try {
        await assignTicket(ticket.id, zohoUserId);
        setPickerOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [ticket.id],
  );

  return (
    <div className={styles.assign}>
      <span className={styles.assignWho} data-assigned={assignee ? 'true' : 'false'}>
        <UserCheck size={13} aria-hidden="true" />
        {assignee ? (mine ? 'You' : (assignee.name ?? assignee.zohoUserId)) : 'Unassigned'}
      </span>

      {!assignee ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void run('claim', () => assignTicket(ticket.id))}
          loading={busy === 'claim'}
          disabled={busy !== null}
        >
          <UserPlus size={14} aria-hidden="true" /> Claim
        </Button>
      ) : null}

      {canAssignOther ? (
        <Button size="sm" variant="ghost" onClick={() => void openPicker()} disabled={busy !== null}>
          {assignee ? 'Reassign' : 'Assign'}
        </Button>
      ) : null}

      {canRelease ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void run('release', () => releaseTicket(ticket.id))}
          loading={busy === 'release'}
          disabled={busy !== null}
        >
          <UserX size={14} aria-hidden="true" /> Release
        </Button>
      ) : null}

      {error ? (
        <span className={styles.ticketActionsError} role="alert">
          {error}
        </span>
      ) : null}

      <Dialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={assignee ? 'Reassign to' : 'Assign to'}
        subtitle={ticket.number}
        size="sm"
      >
        {rosterLoading ? (
          <p className={styles.cardHint}>Loading roster…</p>
        ) : roster && roster.length > 0 ? (
          <ul className={styles.rosterList}>
            {roster.map((m) => {
              const isCurrent = m.zohoUserId === assignee?.zohoUserId;
              return (
                <li key={m.zohoUserId}>
                  <button
                    type="button"
                    className={styles.rosterItem}
                    onClick={() => void assignTo(m.zohoUserId)}
                    disabled={busy !== null || isCurrent || !m.active}
                    data-current={isCurrent || undefined}
                  >
                    <span className={styles.rosterName}>
                      {m.name ?? m.zohoUserId}
                      {m.roleTitle ? <span className={styles.rosterRole}>{m.roleTitle}</span> : null}
                    </span>
                    <span className={styles.rosterLoad}>
                      {isCurrent
                        ? 'Current'
                        : !m.active
                          ? 'Inactive'
                          : `${m.assignedCount} assigned`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.cardHint}>
            No one is on this department&rsquo;s roster yet. Add agents in Routing.
          </p>
        )}
      </Dialog>
    </div>
  );
}
