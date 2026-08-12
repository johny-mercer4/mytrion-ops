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
import { TableSkeleton } from '@/components/mytrion/table-skeleton';
import { DocIcon, PlusIcon, SearchIcon, XIcon } from '../../components/icons';
import { useModalFocus } from '../_shared/useModalFocus';
import { Pager, PAGE_SIZE } from './Pager';
import s from './admin.module.css';

const STATUS_LABEL: Record<DocStatus, string> = {
  ready: 'Ready',
  processing: 'Embedding',
  pending: 'Queued',
  failed: 'Failed',
};
const DOC_SKELETON = ['58%', '72px', '36%', '48%', '68px'] as const;
/** One chunk window per fetch — a 1MB doc is ~1250 chunks, far too many bodies to ship at once. */
const CHUNK_PAGE = 100;
/**
 * Search is client-side (listQuery on /knowledge/docs is limit/offset/department only — no `q`), so
 * while the box has text we fetch the widest window the route allows instead of the 10-row page, or
 * typing a title would only ever match the current window. 200 is the route's `limit` cap.
 */
const SEARCH_LIMIT = 200;

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
  const [page, setPage] = useState(1);

  // Non-empty search box ⇒ wide fetch. Derived as a boolean (not the raw query) so `load` refetches
  // once when search mode flips, not on every keystroke.
  const searching = query.trim().length > 0;

  // A page step and the keystroke that flips search mode can be in flight together; without this the
  // late paged response overwrites the wide search window with its 10 rows.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++loadSeq.current;
    setLoading(true);
    setError('');
    try {
      const [statsRes, docsRes] = await Promise.all([
        getStats(),
        // Page server-side. The backend caps `limit` at 200 while the Documents tile counts the
        // whole corpus, so a single fetch silently hides every doc past the newest window — and
        // the one it hides is exactly the old failed ingest an admin came here to find. Searching
        // widens the window back to the cap (offset 0) because the match is computed on the client.
        searching
          ? listDocs({ limit: SEARCH_LIMIT })
          : listDocs({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
      ]);
      if (loadSeq.current !== mine) return; // superseded; the newer load owns the list and `loading`
      setStats(statsRes);
      setDocs(docsRes.docs);
      // Re-point an open detail modal at the refreshed row, so a write that only changes a
      // timestamp (Mark verified) is visible in the dialog that triggered it.
      setOpen((prev) => (prev ? (docsRes.docs.find((d) => d.id === prev.id) ?? prev) : prev));
      // Deleting the last doc on the last page would otherwise leave the operator on a blank
      // window whose pager has just hidden itself. Step back (strictly, so this can't loop).
      if (!searching && docsRes.docs.length === 0 && statsRes.docs > 0 && page > 1) {
        setPage(Math.min(page - 1, Math.max(1, Math.ceil(statsRes.docs / PAGE_SIZE))));
      }
    } catch (e) {
      if (loadSeq.current === mine) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (loadSeq.current === mine) setLoading(false);
    }
  }, [page, searching]);

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
  /**
   * The tiles count the loaded window — there is no backend status count. Qualify the label with
   * what that window actually is, and drop the qualifier entirely once the window covers the whole
   * corpus (search mode over a corpus ≤ SEARCH_LIMIT), so the number is never undersold either way.
   */
  const countScope =
    stats && docs.length >= stats.docs ? '' : searching ? ` (first ${SEARCH_LIMIT})` : ' (this page)';

  /**
   * Both writes deliberately let the rejection escape to DocDetailModal: the panel's `error`
   * banner renders in normal flow behind the fixed, blurred `.modalBackdrop`, so a failed delete
   * (a non-admin hits the 403 writeGuard) used to produce no visible feedback at all. The panel
   * banner is now for the list/stats fetch only.
   */
  async function onDelete(doc: KnowledgeDoc) {
    if (!window.confirm(`Delete "${doc.title}" and its embedded chunks?`)) return;
    await deleteDoc(doc.id);
    setOpen(null);
    // Refetch instead of splicing the row out: with a server-side window the page has to be
    // re-filled from the backend anyway, and the totals come back consistent with it.
    await load();
  }

  async function onVerify(doc: KnowledgeDoc) {
    await verifyDoc(doc.id);
    // markVerified bumps updated_at as well as last_verified_at, so the refetch is what makes the
    // attestation visible — a success message alone leaves the stale Updated timestamp on screen.
    await load();
  }

  return (
    <div className={s.panel}>
      <div className={s.head}>
        <div>
          <div className={s.eyebrow}>Retrieval corpus</div>
          <h2 className={s.h2}>Knowledge Base</h2>
          <p className={s.sub}>
            Every document the agents can retrieve from, with its scope and embedded chunk count.
            Add sources in Train.
          </p>
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
        {/* Ready/Failed are counted from the loaded window, not the corpus — `countScope` says which,
            so a "Failed 0" is never read as a promise about the docs off screen. */}
        <div className={s.statTile}>
          <div className={`${s.statNum} ${s.good}`}>{ready.toLocaleString()}</div>
          <div className={s.statLabel}>Ready{countScope}</div>
        </div>
        <div className={s.statTile}>
          <div className={`${s.statNum} ${failed > 0 ? s.bad : ''}`}>{failed.toLocaleString()}</div>
          <div className={s.statLabel}>Failed{countScope}</div>
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

      <div className={s.table} data-table-scroller aria-busy={loading}>
        <div className={`${s.tHead} ${s.tDocs}`}>
          <span>Document</span>
          <span>Scope</span>
          <span className={s.right}>Chunks</span>
          <span className={s.right}>Updated</span>
          <span className={s.right}>Status</span>
        </div>
        {loading && (
          <>
            <span className={s.srOnly} role="status">
              Loading documents…
            </span>
            {/* Match the outgoing window's height: a page step reloads, and a fixed 6-row skeleton
                under a 10-row page would drag the pager up and back down under the cursor. */}
            <TableSkeleton
              widths={DOC_SKELETON}
              rowClassName={s.tRow}
              colsClassName={s.tDocs}
              rows={Math.min(docs.length || 6, PAGE_SIZE)}
            />
          </>
        )}
        {!loading &&
          filtered.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`${s.tRow} ${s.tRowClick} ${s.tDocs}`}
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
            {docs.length === 0
              ? 'No documents yet — add sources in Train.'
              : `No documents match "${query}"${
                  (stats?.docs ?? 0) > docs.length
                    ? ` — search covers the newest ${SEARCH_LIMIT} documents.`
                    : '.'
                }`}
          </div>
        )}
      </div>

      {/* Hidden while searching — that fetch is one wide offset-0 window, so a page number would be a
          lie about what the list contains. Not gated on `loading`: this pager is server-side, so
          every click sets loading, and a `!loading` gate would unmount the button under the cursor
          mid-page-step. Pager self-hides at one page, and the table's aria-busy carries in-flight. */}
      {!searching && (stats !== null || docs.length > 0) && (
        <Pager page={page} total={stats?.docs ?? docs.length} onChange={setPage} />
      )}

      {open && (
        <DocDetailModal
          doc={open}
          onClose={() => setOpen(null)}
          onDelete={() => onDelete(open)}
          onVerify={() => onVerify(open)}
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
  /** Rejects on a failed write — the modal, not the panel behind it, reports the outcome. */
  onDelete: () => Promise<void>;
  onVerify: () => Promise<void>;
}) {
  const [chunks, setChunks] = useState<DocChunk[] | null>(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<'verify' | 'delete' | null>(null);
  const [actionError, setActionError] = useState('');
  const [verified, setVerified] = useState(false);
  const panelRef = useModalFocus<HTMLDivElement>();
  // Close only when the press STARTED on the backdrop — a text-selection drag that ends
  // outside the panel must not dismiss the modal.
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    let alive = true;
    getDocChunks(doc.id, { limit: CHUNK_PAGE })
      .then((res) => alive && setChunks(res.chunks))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [doc.id]);

  // Escape only: useModalFocus owns the Tab trap, initial focus, focus restore and the background
  // scroll lock, and deliberately leaves Escape to the caller — the one place that knows a write
  // may be in flight.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function loadMoreChunks() {
    setLoadingMore(true);
    setError('');
    try {
      const res = await getDocChunks(doc.id, { limit: CHUNK_PAGE, offset: chunks?.length ?? 0 });
      setChunks((prev) => [...(prev ?? []), ...res.chunks]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }

  async function runAction(kind: 'verify' | 'delete') {
    if (busy) return;
    setBusy(kind);
    setActionError('');
    setVerified(false);
    try {
      await (kind === 'delete' ? onDelete() : onVerify());
      if (kind === 'verify') setVerified(true);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

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

        {actionError && (
          <p className={s.errorNote} role="alert">
            {actionError}
          </p>
        )}
        {verified && !actionError && (
          <p className={s.noticeNote} role="status">
            Freshness confirmed — retrieval will stop demoting this document as stale.
          </p>
        )}

        <div className={s.modalActions}>
          <button
            type="button"
            className={s.ghostBtn}
            disabled={busy !== null}
            onClick={() => void runAction('verify')}
          >
            {busy === 'verify' ? 'Marking…' : 'Mark verified'}
          </button>
          <button
            type="button"
            className={s.dangerBtn}
            disabled={busy !== null}
            onClick={() => void runAction('delete')}
          >
            {busy === 'delete' ? 'Deleting…' : 'Delete document'}
          </button>
        </div>

        <div className={s.chunkList}>
          {chunks === null && !error && (
            <div className={s.loadingBlock} role="status">
              <span className={s.loadingSpin} aria-hidden="true" />
              Loading chunks…
            </div>
          )}
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
          {/* Without this the list just stops at chunk 99 under a meta row reading "Chunks 412",
              which reads as a truncated embedding — the opposite of what the inspector is for. */}
          {chunks && chunks.length > 0 && chunks.length < (doc.chunkCount ?? 0) && (
            <div className={s.pager}>
              <span className={s.pagerMeta}>
                showing first {chunks.length} of {doc.chunkCount} chunks
              </span>
              <button
                type="button"
                className={s.ghostBtn}
                disabled={loadingMore}
                onClick={() => void loadMoreChunks()}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
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
