import { useCallback, useEffect, useState } from 'react';
import { MessageSquarePlus, Trash2 } from 'lucide-react';
import { Button, Dialog, Input } from '@/ds';
import {
  createCannedReply,
  deleteCannedReply,
  listCannedReplies,
  type CannedReplyDto,
} from '@/api/comms';
import c from './comms.module.css';

/**
 * Canned-replies control for the composer: a button that opens a picker of team templates. Clicking one
 * inserts its body into the draft; the current draft can be saved as a new template inline, and the
 * author can delete their own. Templates are shared, tenant-scoped, and loaded on open.
 */
export function CannedReplies({
  department,
  currentDraft,
  onInsert,
}: {
  department?: string | null;
  currentDraft: string;
  onInsert: (body: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<CannedReplyDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReplies(await listCannedReplies(department ?? undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setReplies([]);
    } finally {
      setLoading(false);
    }
  }, [department]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const saveCurrent = useCallback(async () => {
    const t = title.trim();
    const body = currentDraft.trim();
    if (!t || !body) return;
    setSaving(true);
    setError('');
    try {
      await createCannedReply({ title: t, body });
      setTitle('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [title, currentDraft, load]);

  const remove = useCallback(async (id: string) => {
    try {
      await deleteCannedReply(id);
      setReplies((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <>
      <button
        type="button"
        className={c.iconBtn}
        onClick={() => setOpen(true)}
        title="Canned replies"
        aria-label="Canned replies"
      >
        <MessageSquarePlus size={18} aria-hidden="true" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Canned replies" size="sm">
        {loading ? (
          <p className={c.cannedHint}>Loading…</p>
        ) : replies && replies.length > 0 ? (
          <ul className={c.cannedList}>
            {replies.map((r) => (
              <li key={r.id} className={c.cannedItem}>
                <button
                  type="button"
                  className={c.cannedInsert}
                  onClick={() => {
                    onInsert(r.body);
                    setOpen(false);
                  }}
                >
                  <span className={c.cannedTitle}>{r.title}</span>
                  <span className={c.cannedBody}>{r.body}</span>
                </button>
                <button
                  type="button"
                  className={c.cannedDelete}
                  onClick={() => void remove(r.id)}
                  aria-label={`Delete ${r.title}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={c.cannedHint}>
            No canned replies yet. Type a message, then save it as a template below.
          </p>
        )}
        <div className={c.cannedSave}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Save the current draft as…"
          />
          <Button
            size="sm"
            variant="primary"
            onClick={() => void saveCurrent()}
            disabled={saving || !title.trim() || !currentDraft.trim()}
          >
            Save draft
          </Button>
        </div>
        {error ? (
          <p className={c.errorNote} role="alert">
            {error}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
