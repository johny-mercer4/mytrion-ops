import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Dialog, Select, Textarea, type SelectOption } from '@/ds';
import {
  actOnEscalation,
  getEscalation,
  type DepartmentOptionDto,
  type EscalationDto,
  type TicketDto,
} from '@/api/comms';
import styles from './desk.module.css';

type LadderAction = 'escalate' | 'handoff' | 'resolve' | 'reject';

const ACTION_LABEL: Record<LadderAction, string> = {
  escalate: 'Escalate up',
  handoff: 'Hand off',
  resolve: 'Resolve',
  reject: 'Reject',
};

const STATUS_LABEL: Record<string, string> = {
  resolved: 'Resolved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
};

/**
 * The escalation ladder actions, rendered in the conversation header of an escalation (via
 * TicketConsole's `chatActions`). Fetches the escalation for its current version, then walks the
 * ladder — escalate up / hand off / resolve / reject — each carrying `expectedVersion` so a decision
 * made against a stale view 409s and reloads rather than overwriting someone else's. Once the
 * escalation leaves `pending` the actions collapse to a status chip.
 */
export function DeskEscalationActions({
  ticket,
  departments,
}: {
  ticket: TicketDto;
  departments: DepartmentOptionDto[];
}) {
  const escId = ticket.escalation?.id ?? null;
  const [esc, setEsc] = useState<EscalationDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<LadderAction | null>(null);
  const [comment, setComment] = useState('');
  const [toDepartment, setToDepartment] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!escId) return;
    setLoading(true);
    setError('');
    try {
      const { escalation } = await getEscalation(escId);
      setEsc(escalation);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [escId]);

  useEffect(() => {
    setEsc(null);
    void load();
  }, [load]);

  const deptOpts = useMemo<SelectOption[]>(
    () =>
      departments
        .filter((d) => d.acceptsEscalations)
        .map((d) => ({ value: d.department, label: d.label || d.department })),
    [departments],
  );

  const openAction = (a: LadderAction): void => {
    setAction(a);
    setComment('');
    setToDepartment(null);
    setError('');
  };

  const confirm = useCallback(async () => {
    if (!escId || !esc || !action || busy) return;
    if (action === 'handoff' && !toDepartment) {
      setError('Choose a department to hand off to.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { escalation } = await actOnEscalation(escId, action, {
        expectedVersion: esc.version,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        ...(action === 'handoff' && toDepartment ? { toDepartment } : {}),
      });
      setEsc(escalation);
      setAction(null);
    } catch (e) {
      // A 409 means someone moved it first; reload so the next attempt carries the fresh version.
      setError(e instanceof Error ? e.message : String(e));
      void load();
    } finally {
      setBusy(false);
    }
  }, [escId, esc, action, busy, comment, toDepartment, load]);

  if (!escId) return null;

  const isPending = esc?.status === 'pending';

  return (
    <div className={styles.escActions}>
      {loading && !esc ? (
        <span className={styles.escStatus}>Loading…</span>
      ) : isPending ? (
        <>
          {esc?.level ? <span className={styles.escLevel}>L{esc.level}</span> : null}
          {(['escalate', 'handoff', 'resolve', 'reject'] as LadderAction[]).map((a) => (
            <Button
              key={a}
              size="sm"
              variant={a === 'resolve' ? 'primary' : a === 'reject' ? 'danger' : 'secondary'}
              onClick={() => openAction(a)}
            >
              {ACTION_LABEL[a]}
            </Button>
          ))}
        </>
      ) : esc ? (
        <span className={styles.escStatus} data-status={esc.status}>
          {STATUS_LABEL[esc.status] ?? esc.status}
        </span>
      ) : null}

      <Dialog
        open={action !== null}
        onClose={() => {
          if (!busy) setAction(null);
        }}
        title={action ? ACTION_LABEL[action] : ''}
        subtitle={esc ? `${ticket.number} · ${esc.reasonLabel ?? esc.reasonCode ?? 'Escalation'}` : undefined}
        size="sm"
        footer={
          <div className={styles.composeFooter}>
            <Button
              variant="ghost"
              onClick={() => {
                if (!busy) setAction(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant={action === 'reject' ? 'danger' : 'primary'}
              onClick={() => void confirm()}
              loading={busy}
            >
              {action ? ACTION_LABEL[action] : 'Confirm'}
            </Button>
          </div>
        }
      >
        <div className={styles.composeForm}>
          {action === 'handoff' ? (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Hand off to department</span>
              <Select
                label="Hand off to department"
                labelHidden
                options={deptOpts}
                value={toDepartment}
                onChange={setToDepartment}
                placeholder="Choose a department"
                emptyLabel="No departments accept escalations"
              />
            </div>
          ) : null}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              {action === 'resolve' || action === 'reject' ? 'Comment' : 'Comment (optional)'}
            </span>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder={
                action === 'resolve'
                  ? 'How was it resolved?'
                  : action === 'reject'
                    ? 'Why is it rejected?'
                    : action === 'handoff'
                      ? 'Context for the receiving team…'
                      : 'Why does this need to go up a level?'
              }
            />
          </label>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
