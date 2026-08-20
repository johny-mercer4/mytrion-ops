import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { setTicketTags, type TicketDto } from '@/api/comms';
import styles from './desk.module.css';

/**
 * Tag chip editor for a ticket. Optimistic: chips update immediately and revert on a server error, so
 * adding a label feels instant. The full desired set is sent each time (the server normalises it), and
 * the queue re-renders from the realtime `comms.ticket.tagged` frame — so this never has to reconcile.
 */
export function DeskTicketTags({ ticket }: { ticket: TicketDto }) {
  const [tags, setTags] = useState<string[]>(ticket.tags);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Re-sync to server truth when the ticket (or its tags) reloads underneath us.
  useEffect(() => {
    setTags(ticket.tags);
  }, [ticket.id, ticket.tags]);

  const commit = useCallback(
    async (next: string[]) => {
      const prev = tags;
      setTags(next);
      setBusy(true);
      setError('');
      try {
        await setTicketTags(ticket.id, next);
      } catch (e) {
        setTags(prev);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [tags, ticket.id],
  );

  const add = useCallback(() => {
    const t = input.trim().replace(/\s+/g, ' ').slice(0, 40);
    setInput('');
    if (!t || tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    void commit([...tags, t]);
  }, [input, tags, commit]);

  return (
    <div className={styles.tagEditor}>
      <div className={styles.tagChips}>
        {tags.length === 0 ? <span className={styles.cardHint}>No tags yet.</span> : null}
        {tags.map((t) => (
          <span key={t} className={styles.tagChip}>
            {t}
            <button
              type="button"
              className={styles.tagRemove}
              onClick={() => void commit(tags.filter((x) => x !== t))}
              disabled={busy}
              aria-label={`Remove tag ${t}`}
            >
              <X size={11} strokeWidth={2.6} aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <input
        className={styles.tagInput}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        placeholder="Add a tag and press Enter…"
        disabled={busy}
        aria-label="Add a tag"
      />
      {error ? (
        <span className={styles.ticketActionsError} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
