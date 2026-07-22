import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { embedDocument } from '../../api/knowledge';
import { CheckIcon, XIcon } from '../../components/icons';
import s from './admin.module.css';

/**
 * Client-side rules: text formats only, 20/batch. The size cap matches the WIRED endpoint —
 * /knowledge/embed sends content as JSON and the backend caps it at 1,000,000 chars (zod)
 * under a 2MB body limit, so a ≤1MB UTF-8 file always fits. (The widget's 10MB limit
 * belonged to the multipart /knowledge/upload path, which Train does not use.)
 */
const ACCEPT_EXT = ['.md', '.markdown', '.txt', '.text', '.json'];
const MAX_FILE_BYTES = 1_000_000;
const MAX_BATCH = 20;

/** Canonical department presets (free string on the API; blank = Global). */
const DEPARTMENT_PRESETS = [
  'sales',
  'marketing',
  'billing',
  'collection',
  'verification',
  'customer-service',
  'finance',
  'retention',
  'management',
  'c-level',
];

type FileStatus = 'queued' | 'embedding' | 'ready' | 'skipped' | 'failed';

interface QueuedFile {
  id: string;
  file: File;
  status: FileStatus;
  chunkCount: number | null;
  error: string;
}

function mimeForFilename(name: string): string {
  return name.toLowerCase().endsWith('.json') ? 'application/json' : 'text/markdown';
}

function normalizeDept(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

let seq = 0;
const nextId = () => `f_${(seq += 1)}`;

/** Admin Train — upload sources (or paste text), tag a department scope, and embed. */
export function Train({ onTrained }: { onTrained?: () => void }) {
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [department, setDepartment] = useState('');
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [summary, setSummary] = useState<{ ready: number; skipped: number; failed: number } | null>(null);
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Paste-text ingestion (the embed API takes arbitrary {title, content}).
  const [textTitle, setTextTitle] = useState('');
  const [textBody, setTextBody] = useState('');
  const [textBusy, setTextBusy] = useState(false);

  function addFiles(list: FileList | File[]) {
    setNotice('');
    const incoming = [...list];
    const next: QueuedFile[] = [];
    for (const file of incoming) {
      const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
      if (!ACCEPT_EXT.includes(ext)) {
        setNotice(`Skipped ${file.name} — only ${ACCEPT_EXT.join(' ')} are supported.`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setNotice(`Skipped ${file.name} — larger than 1MB (the embed API's content limit).`);
        continue;
      }
      next.push({ id: nextId(), file, status: 'queued', chunkCount: null, error: '' });
    }
    setFiles((prev) => {
      const merged = [...prev, ...next];
      if (merged.length > MAX_BATCH) {
        setNotice(`Batch capped at ${MAX_BATCH} files.`);
        return merged.slice(0, MAX_BATCH);
      }
      return merged;
    });
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (!running && e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  }

  const patch = (id: string, p: Partial<QueuedFile>) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...p } : f)));

  async function train() {
    if (running || files.length === 0) return;
    setRunning(true);
    setSummary(null);
    const dept = normalizeDept(department);
    const tally = { ready: 0, skipped: 0, failed: 0 };
    for (const item of files) {
      if (item.status === 'ready' || item.status === 'skipped') continue;
      patch(item.id, { status: 'embedding', error: '' });
      try {
        const content = await item.file.text();
        const res = await embedDocument({
          title: item.file.name,
          content,
          ...(dept ? { department: dept } : {}),
          mimeType: mimeForFilename(item.file.name),
        });
        const status: FileStatus = res.status === 'skipped' ? 'skipped' : 'ready';
        tally[status === 'skipped' ? 'skipped' : 'ready'] += 1;
        patch(item.id, { status, chunkCount: res.chunkCount });
      } catch (e) {
        tally.failed += 1;
        patch(item.id, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
      }
    }
    setRunning(false);
    setSummary(tally);
    if (tally.ready > 0) onTrained?.();
  }

  async function ingestText() {
    const title = textTitle.trim();
    const content = textBody.trim();
    if (!title || !content || textBusy) return;
    setTextBusy(true);
    setNotice('');
    try {
      const dept = normalizeDept(department);
      const res = await embedDocument({ title, content, ...(dept ? { department: dept } : {}) });
      setNotice(
        res.status === 'skipped'
          ? `"${title}" is already embedded (identical content).`
          : `Embedded "${title}" — ${res.chunkCount} chunks.`,
      );
      setTextTitle('');
      setTextBody('');
      onTrained?.();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setTextBusy(false);
    }
  }

  const queued = files.filter((f) => f.status === 'queued' || f.status === 'failed').length;

  return (
    <div className={s.panel}>
      <div className={s.head}>
        <div>
          <h2 className={s.h2}>Train Agents</h2>

        </div>
      </div>

      <div className={s.grid2}>
        {/* Upload queue */}
        <div className={`${s.card} ${s.cardPad}`}>
          <div
            className={`${s.dropzone} ${dragOver ? s.dropzoneOn : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={(e) => {
              // The hidden input's programmatic click bubbles back here — don't re-trigger.
              if (running || e.target === inputRef.current) return;
              inputRef.current?.click();
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (running) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
          >
            <div className={s.dropTitle}>Drop files here or click to browse</div>
            <div className={s.dropHint}>
              {ACCEPT_EXT.join(' · ')} — up to 1MB each, {MAX_BATCH} per batch
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT_EXT.join(',')}
              onChange={onPick}
              style={{ display: 'none' }}
            />
          </div>

          {files.map((f) => (
            <div key={f.id} className={s.checkRow}>
              <span className={s.checkMain}>
                <div className={s.checkName}>{f.file.name}</div>
                <div className={s.checkMeta}>
                  {(f.file.size / 1024).toFixed(1)} KB
                  {f.chunkCount != null ? ` · ${f.chunkCount} chunks` : ''}
                  {f.error ? ` · ${f.error}` : ''}
                </div>
              </span>
              <FilePill status={f.status} />
              {!running && (
                <button
                  type="button"
                  className={s.iconBtn}
                  aria-label={`Remove ${f.file.name}`}
                  onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
                >
                  <XIcon size={10} />
                </button>
              )}
            </div>
          ))}
          {files.length === 0 && <div className={s.none}>No files queued yet.</div>}
        </div>

        {/* Scope + run */}
        <div className={`${s.card} ${s.cardPad}`} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3_5)' }}>
          <span className={s.cardTitle}>Department / scope</span>
          <div className={s.field}>
            <span className={s.fieldLabel}>Scope tag (blank = Global)</span>
            <input
              className={s.input}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. sales"
              list="dept-presets"
            />
            <datalist id="dept-presets">
              {DEPARTMENT_PRESETS.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>
          <div className={s.chipRow}>
            {DEPARTMENT_PRESETS.map((d) => (
              <button
                key={d}
                type="button"
                className={`${s.filterChip} ${normalizeDept(department) === d ? s.filterChipOn : ''}`}
                onClick={() => setDepartment(d)}
              >
                {d}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`${s.primaryBtn} ${s.tall}`}
            disabled={running || files.length === 0 || queued === 0}
            onClick={() => void train()}
          >
            {running ? 'Embedding…' : `Train agent (${queued})`}
          </button>
          {summary && (
            <div className={s.runStats}>
              <span>
                Embedded <strong>{summary.ready}</strong>
              </span>
              <span>
                Skipped <strong>{summary.skipped}</strong>
              </span>
              <span>
                Failed <strong>{summary.failed}</strong>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Paste text */}
      <div className={`${s.card} ${s.cardPad}`} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <span className={s.cardTitle}>Paste text</span>
        <div className={s.field}>
          <span className={s.fieldLabel}>Title</span>
          <input
            className={s.input}
            value={textTitle}
            onChange={(e) => setTextTitle(e.target.value)}
            placeholder="e.g. Money code approval policy"
          />
        </div>
        <div className={s.field}>
          <span className={s.fieldLabel}>Content (uses the same scope tag)</span>
          <textarea
            className={s.textarea}
            value={textBody}
            onChange={(e) => setTextBody(e.target.value)}
            rows={6}
            placeholder="Paste policy / procedure text to embed…"
          />
        </div>
        <button
          type="button"
          className={s.primaryBtn}
          style={{ alignSelf: 'flex-start' }}
          disabled={textBusy || !textTitle.trim() || !textBody.trim()}
          onClick={() => void ingestText()}
        >
          {textBusy ? 'Embedding…' : 'Embed text'}
        </button>
      </div>

      {notice && <p className={s.noticeNote}>{notice}</p>}
    </div>
  );
}

function FilePill({ status }: { status: FileStatus }) {
  if (status === 'embedding') {
    return (
      <span className={`${s.pill} ${s.pillInfo}`}>
        <span className={s.spinner} />
        Embedding
      </span>
    );
  }
  if (status === 'ready') {
    return (
      <span className={`${s.pill} ${s.pillGood}`}>
        <CheckIcon size={10} />
        Ready
      </span>
    );
  }
  if (status === 'skipped') return <span className={`${s.pill} ${s.pillNeutral}`}>Skipped</span>;
  if (status === 'failed') return <span className={`${s.pill} ${s.pillBad}`}>Failed</span>;
  return <span className={`${s.pill} ${s.pillNeutral}`}>Queued</span>;
}
