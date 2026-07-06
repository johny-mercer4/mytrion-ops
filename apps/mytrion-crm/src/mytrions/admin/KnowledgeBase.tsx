import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteDoc,
  getDocChunks,
  getStats,
  listDocs,
  verifyDoc,
  type DocChunk,
  type DocStatus,
  type KnowledgeDoc,
  type KnowledgeStats,
} from '../../api/knowledge';
import { DocIcon, PlusIcon, SearchIcon, XIcon } from '../../components/icons';
import s from './admin.module.css';

const STATUS_LABEL: Record<DocStatus, string> = {
  ready: 'Ready',
  processing: 'Embedding',
  pending: 'Queued',
  failed: 'Failed',
};
const COLS = { gridTemplateColumns: '2.6fr 1fr 0.7fr 0.9fr 1fr' } as const;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

/** Admin Knowledge Base — live view of every ingested document (all departments). */
export function KnowledgeBase({ onAddSource }: { onAddSource?: () => void }) {
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<KnowledgeDoc | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statsRes, docsRes] = await Promise.all([getStats(), listDocs({ limit: 200 })]);
      setStats(statsRes);
      setDocs(docsRes.docs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.departmentAccess ?? 'global').toLowerCase().includes(q) ||
        d.status.includes(q),
    );
  }, [docs, query]);

  const ready = docs.filter((d) => d.status === 'ready').length;
  const failed = docs.filter((d) => d.status === 'failed').length;

  async function onDelete(doc: KnowledgeDoc) {
    if (!window.confirm(`Delete "${doc.title}" and its embedded chunks?`)) return;
    try {
      await deleteDoc(doc.id);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      setStats((prev) =>
        prev ? { docs: prev.docs - 1, chunks: prev.chunks - (doc.chunkCount ?? 0) } : prev,
      );
      setOpen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onVerify(doc: KnowledgeDoc) {
    try {
      await verifyDoc(doc.id);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className={s.panel}>
      <div className={s.head}>
        <div>
          <h2 className={s.h2}>Knowledge Base</h2>
          <p className={s.sub}>Source documents grounding every Mytrion's answers.</p>
        </div>
        <button type="button" className={s.primaryBtn} onClick={onAddSource}>
          <PlusIcon size={14} />
          Add source
        </button>
      </div>

      <div className={s.statGrid}>
        <div className={s.statTile}>
          <div className={s.statNum}>{(stats?.docs ?? docs.length).toLocaleString()}</div>
          <div className={s.statLabel}>Documents</div>
        </div>
        <div className={s.statTile}>
          <div className={s.statNum}>{(stats?.chunks ?? 0).toLocaleString()}</div>
          <div className={s.statLabel}>Embedded chunks</div>
        </div>
        <div className={s.statTile}>
          <div className={`${s.statNum} ${s.good}`}>{ready.toLocaleString()}</div>
          <div className={s.statLabel}>Ready</div>
        </div>
        <div className={s.statTile}>
          <div className={`${s.statNum} ${failed > 0 ? s.bad : ''}`}>{failed.toLocaleString()}</div>
          <div className={s.statLabel}>Failed</div>
        </div>
      </div>

      <label className={s.search}>
        <SearchIcon size={14} />
        <input
          className={s.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents…"
        />
      </label>

      {error && (
        <p className={s.errorNote} role="alert">
          {error}
        </p>
      )}

      <div className={s.table}>
        <div className={s.tHead} style={COLS}>
          <span>Document</span>
          <span>Scope</span>
          <span className={s.right}>Chunks</span>
          <span className={s.right}>Updated</span>
          <span className={s.right}>Status</span>
        </div>
        {loading && <div className={s.none}>Loading documents…</div>}
        {!loading &&
          filtered.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`${s.tRow} ${s.tRowClick}`}
              style={COLS}
              onClick={() => setOpen(d)}
            >
              <span className={s.docCell}>
                <DocIcon size={16} />
                <span className={s.docTitle}>{d.title}</span>
              </span>
              <span className={s.deptText}>{d.departmentAccess ?? 'Global'}</span>
              <span className={`${s.right} ${s.mono}`}>{d.chunkCount ?? '—'}</span>
              <span className={`${s.right} ${s.deptText}`}>{relativeTime(d.updatedAt)}</span>
              <span className={s.right}>
                <StatusPill status={d.status} />
              </span>
            </button>
          ))}
        {!loading && filtered.length === 0 && (
          <div className={s.none}>
            {docs.length === 0 ? 'No documents yet — add sources in Train.' : `No documents match "${query}".`}
          </div>
        )}
      </div>

      {open && (
        <DocDetailModal
          doc={open}
          onClose={() => setOpen(null)}
          onDelete={() => void onDelete(open)}
          onVerify={() => void onVerify(open)}
        />
      )}
    </div>
  );
}

/** Doc detail — metadata + the embedded chunks ("JSON contents" inspector). */
function DocDetailModal({
  doc,
  onClose,
  onDelete,
  onVerify,
}: {
  doc: KnowledgeDoc;
  onClose: () => void;
  onDelete: () => void;
  onVerify: () => void;
}) {
  const [chunks, setChunks] = useState<DocChunk[] | null>(null);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  // Close only when the press STARTED on the backdrop — a text-selection drag that ends
  // outside the panel must not dismiss the modal.
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    let alive = true;
    getDocChunks(doc.id, { limit: 100 })
      .then((res) => alive && setChunks(res.chunks))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [doc.id]);

  // Focus management + Escape (same pattern as the chat ConversationList overlay).
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div
      className={s.modalBackdrop}
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={s.modal}
        role="dialog"
        aria-modal="true"
        aria-label={doc.title}
        tabIndex={-1}
      >
        <div className={s.modalHead}>
          <span className={s.cardTitle}>{doc.title}</span>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close">
            <XIcon size={12} />
          </button>
        </div>

        <div className={s.metaGrid}>
          <Meta label="Status" value={STATUS_LABEL[doc.status]} />
          <Meta label="Scope" value={doc.departmentAccess ?? 'Global'} />
          <Meta label="Chunks" value={String(doc.chunkCount ?? '—')} />
          <Meta label="Type" value={doc.mimeType ?? '—'} />
          <Meta label="Source" value={doc.source ?? '—'} />
          <Meta label="Updated" value={new Date(doc.updatedAt).toLocaleString()} />
        </div>
        {doc.error && <p className={s.errorNote}>{doc.error}</p>}

        <div className={s.modalActions}>
          <button type="button" className={s.ghostBtn} onClick={onVerify}>
            Mark verified
          </button>
          <button type="button" className={s.dangerBtn} onClick={onDelete}>
            Delete document
          </button>
        </div>

        <div className={s.chunkList}>
          {chunks === null && !error && <div className={s.none}>Loading chunks…</div>}
          {error && <div className={s.errorNote}>{error}</div>}
          {chunks?.map((c) => (
            <div key={c.id} className={s.chunkCard}>
              <div className={s.chunkMeta}>
                <span className={s.mono}>chunk {c.chunkIndex}</span>
                <span>{c.tokenCount ?? '—'} tokens</span>
                <span className={`${s.pill} ${c.hasEmbedding ? s.pillGood : s.pillWarn}`}>
                  {c.hasEmbedding ? 'Vector stored' : 'No vector'}
                </span>
              </div>
              <pre className={s.chunkText}>{c.content}</pre>
            </div>
          ))}
          {chunks?.length === 0 && <div className={s.none}>No chunks stored for this document.</div>}
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <span className={s.metaValue}>{value}</span>
    </div>
  );
}

function StatusPill({ status }: { status: DocStatus }) {
  const tone =
    status === 'ready' ? s.pillGood : status === 'failed' ? s.pillBad : s.pillWarn;
  return (
    <span className={`${s.pill} ${tone}`}>
      {status === 'processing' || status === 'pending' ? (
        <span className={s.spinner} />
      ) : (
        <span className={s.dot} />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}
