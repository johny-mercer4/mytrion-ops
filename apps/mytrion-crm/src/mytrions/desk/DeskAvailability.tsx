import { useState } from 'react';
import { Dialog, Input } from '@/ds';
import { setMyAvailability, type AgentAvailability, type AvailabilityDto } from '@/api/comms';
import styles from './desk.module.css';

const OPTIONS: { value: AgentAvailability; label: string; hint: string }[] = [
  { value: 'available', label: 'Available', hint: 'New tickets can be routed to you.' },
  { value: 'away', label: 'Away', hint: 'Kept off the rotation until you come back.' },
  { value: 'do_not_assign', label: 'Do not assign', hint: 'On shift, but hand-picking your own work.' },
];

/**
 * Set the signed-in agent's availability. It is a declared, durable status the round-robin honours —
 * 'away' / 'do_not_assign' keep new tickets off you without leaving the roster — so this is a work-mode
 * switch, not a presence indicator. The parent owns the current value and the dialog reports the change
 * back; the server clears any auto-away when you choose here (you are opting back in).
 */
export function DeskAvailability({
  open,
  current,
  onClose,
  onChanged,
}: {
  open: boolean;
  current: AvailabilityDto | null;
  onClose: () => void;
  onChanged: (next: AvailabilityDto) => void;
}) {
  const [busy, setBusy] = useState<AgentAvailability | null>(null);
  const [note, setNote] = useState(current?.availabilityNote ?? '');
  const [error, setError] = useState('');

  const pick = async (value: AgentAvailability): Promise<void> => {
    setBusy(value);
    setError('');
    try {
      const next = await setMyAvailability(value, note.trim() || undefined);
      onChanged(next);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Your availability" size="sm">
      <div className={styles.availList}>
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={styles.availItem}
            data-current={current?.availability === o.value || undefined}
            onClick={() => void pick(o.value)}
            disabled={busy !== null}
          >
            <span className={styles.availDot} data-status={o.value} aria-hidden="true" />
            <span className={styles.availText}>
              <span className={styles.availLabel}>{o.label}</span>
              <span className={styles.availHint}>{o.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Note (optional)</span>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. lunch until 14:00"
        />
      </label>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
