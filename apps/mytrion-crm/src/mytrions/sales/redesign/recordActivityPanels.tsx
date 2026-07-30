/**
 * Data Center Lead/Deal modal panels — call history (our mytrion_calls + Zoho Calls, badged by
 * source) and Zoho Notes (list + "Log a note" with an optional attachment). Read from / written to
 * Zoho via the owner-scoped /data-center/{leads|deals}/:id/{calls,notes} routes.
 */
import { useCallback, useEffect, useState } from 'react';
import { s } from './dc';
import { badge } from './salesData';
import { AttachZone } from './createTicketShared';
import { useSales } from './ctx';
import { getImpersonation } from '@/api/impersonation';
import {
  createRecordNote,
  listRecordCalls,
  listRecordNotes,
  type CallHistoryItem,
  type NoteItem,
} from '@/api/dataCenter';
import { DcPanelSkeleton } from './DataCenterSkeletons';
import { Icon } from './icons';

const CARD = 'padding:15px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)';
const CARD_LABEL = 'font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em';
const ROW = 'padding:8px 0;border-top:1px solid var(--border2)';
const MUTED = 'font-size:13px;color:var(--muted)';
const SMALL_BTN =
  'height:26px;padding:0 10px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--accent);font-size:12px;font-weight:700;cursor:pointer';
const SAVE_BTN =
  'height:34px;padding:0 16px;border-radius:var(--radius-md);border:none;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:var(--on-accent);font-size:13px;font-weight:700;cursor:pointer;margin-top:8px';
const NOTE_AREA =
  'width:100%;padding:9px 11px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px;font-family:inherit;resize:vertical;min-height:70px';

type Kind = 'leads' | 'deals';

function fmtWhen(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtDur(secs: number | null): string {
  if (secs == null) return '';
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

function CallsPanel({ kind, id }: { kind: Kind; id: string }) {
  const [calls, setCalls] = useState<CallHistoryItem[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    setErr(false);
    listRecordCalls(kind, id, getImpersonation()?.zohoUserId)
      .then((c) => alive && setCalls(c))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [kind, id]);

  return (
    <div style={s(`${CARD}`)}>
      <div style={s(`${CARD_LABEL};margin-bottom:10px;display:inline-flex;align-items:center;gap:6px`)}>
        <Icon name="calls" size={12} color="var(--accent)" />
        Call history
      </div>
      {!calls && !err && <DcPanelSkeleton rows={3} />}
      {err && <div style={s(MUTED)}>Couldn’t load call history.</div>}
      {calls && calls.length === 0 && <div style={s(MUTED)}>No calls logged yet.</div>}
      {calls && calls.length > 0 && (
        <div style={s('display:flex;flex-direction:column')}>
          {calls.map((c) => {
            const b =
              c.source === 'mytrion'
                ? badge('Mytrion', 'var(--accent-2)')
                : badge('Zoho', 'var(--accent)');
            const dur = fmtDur(c.durationSeconds);
            return (
              <div key={`${c.source}-${c.id}`} style={s(`display:flex;align-items:center;gap:10px;${ROW}`)}>
                <span style={s(b.style)}>{b.text}</span>
                <div style={s('flex:1;min-width:0')}>
                  <div style={s('font-size:13px;font-weight:600;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                    {c.label || c.number || 'Call'}
                  </div>
                  <div style={s('font-size:12px;color:var(--muted);margin-top:2px')}>
                    {fmtWhen(c.when)}
                    {dur ? ` · ${dur}` : ''}
                    {c.status ? ` · ${c.status}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NotesPanel({ kind, id }: { kind: Kind; id: string }) {
  const { pushToast } = useSales();
  const [notes, setNotes] = useState<NoteItem[] | null>(null);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setErr(false);
    listRecordNotes(kind, id, getImpersonation()?.zohoUserId)
      .then(setNotes)
      .catch(() => setErr(true));
  }, [kind, id]);
  useEffect(() => load(), [load]);

  const submit = async (): Promise<void> => {
    const body = content.trim();
    if (!body) {
      pushToast('Note is empty', 'Write something first.');
      return;
    }
    setSaving(true);
    try {
      await createRecordNote(kind, id, { content: body }, file, getImpersonation()?.zohoUserId);
      setContent('');
      setFile(null);
      setOpen(false);
      pushToast('Note saved', 'Logged to Zoho.');
      load();
    } catch (e) {
      pushToast('Note failed', e instanceof Error ? e.message : 'Could not save the note.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s(CARD)}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;margin-bottom:10px')}>
        <div style={s(`${CARD_LABEL};display:inline-flex;align-items:center;gap:6px`)}>
          <Icon name="notes" size={12} color="var(--accent)" />
          Notes
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} style={s(SMALL_BTN)}>
          {open ? 'Cancel' : '+ Log a note'}
        </button>
      </div>

      {open && (
        <div style={s('margin-bottom:12px')}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.currentTarget.value)}
            placeholder="Write a note…"
            className="ss-in"
            style={s(NOTE_AREA)}
          />
          <div style={s('margin-top:8px')}>
            <AttachZone id={`note-att-${kind}-${id}`} file={file} onFile={setFile} />
          </div>
          <button type="button" disabled={saving} onClick={() => void submit()} style={s(SAVE_BTN)}>
            {saving ? 'Saving…' : 'Save note'}
          </button>
        </div>
      )}

      {!notes && !err && <DcPanelSkeleton rows={2} />}
      {err && <div style={s(MUTED)}>Couldn’t load notes.</div>}
      {notes && notes.length === 0 && <div style={s(MUTED)}>No notes yet.</div>}
      {notes && notes.length > 0 && (
        <div style={s('display:flex;flex-direction:column')}>
          {notes.map((nt) => (
            <div key={nt.id} style={s(ROW)}>
              <div style={s('font-size:14px;line-height:1.5;color:var(--text2);white-space:pre-wrap')}>
                {nt.content || nt.title || '—'}
              </div>
              <div style={s('font-size:12px;color:var(--muted);margin-top:3px')}>
                {nt.owner || '—'}
                {nt.createdAt ? ` · ${fmtWhen(nt.createdAt)}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Call-history + Notes panels for a Lead/Deal modal. */
export function RecordActivityPanels({ kind, id }: { kind: Kind; id: string }) {
  return (
    <div style={s('display:flex;flex-direction:column;gap:14px')}>
      <CallsPanel kind={kind} id={id} />
      <NotesPanel kind={kind} id={id} />
    </div>
  );
}
