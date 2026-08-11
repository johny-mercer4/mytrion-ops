import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TableSkeleton } from '@/components/mytrion/table-skeleton';
import {
  listAudit,
  type AuditAudience,
  type AuditEntry,
  type AuditStatus,
} from '../../api/audit';
import { SearchIcon, XIcon } from '../../components/icons';
import { useModalFocus } from '../_shared/useModalFocus';
import s from './admin.module.css';

const PAGE = 50;
const AUDIT_SKELETON = ['48%', '56%', '62%', '40%', '70%', '56px'] as const;

const AUDIENCE_FILTERS = ['All', 'internal', 'customer', 'partner'] as const;
const STATUS_FILTERS = ['All', 'ok', 'denied', 'error'] as const;
/** Quick action-prefix chips — the common "what happened" questions. */
const ACTION_PRESETS: Array<{ label: string; prefix: string }> = [
  { label: 'Everything', prefix: '' },
  { label: 'Logins', prefix: 'auth.' },
  { label: 'Chat / agents', prefix: 'agent.' },
  { label: 'Tools', prefix: 'tool.' },
  { label: 'Knowledge', prefix: 'knowledge.' },
  { label: 'Automations', prefix: 'automation.' },
  { label: 'Carrier users', prefix: 'admin.carrier_user' },
];

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleString();
}

/** "Who" cell: display name first, falling back to the raw user id. */
function actorName(e: AuditEntry): string {
  return e.userName ?? e.userId ?? 'system';
}

function authorityLine(e: AuditEntry): string {
  const parts = [e.profile, e.callerRole ?? e.role].filter(Boolean);
  return parts.join(' · ') || '—';
}

/** Admin Audit Log — every login, button, automation, and agent action; workers AND carriers. */
export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [audience, setAudience] = useState<(typeof AUDIENCE_FILTERS)[number]>('All');
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('All');
  const [actionPrefix, setActionPrefix] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  /** Short page back = no rows past the cursor. `entries.length < total` alone can never fall false
   *  once dedup has dropped a shifted row, which would leave a Load more button that does nothing. */
  const [endReached, setEndReached] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const loadSeq = useRef(0);
  /**
   * Pages fetched for the current filter. The next offset MUST come from here, not `entries.length`:
   * the id-dedup below drops the rows that shifted into this page, so `entries` grows by less than
   * PAGE and an `entries.length` offset would re-request a window the client already holds — forever,
   * once PAGE or more rows are written to the feed while the tab is open.
   */
  const pages = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      const seq = (loadSeq.current += 1);
      setLoading(true);
      // A filter change refires this at offset 0 while the previous filter's rows are still held:
      // `entries` only swaps when the response lands, so flag the reload and let the table hide them.
      if (offset === 0) {
        setReloading(true);
        pages.current = 0; // a failed refilter must not leave the previous filter's cursor behind
      }
      setError('');
      try {
        const res = await listAudit({
          ...(actionPrefix ? { action: actionPrefix } : {}),
          ...(audience !== 'All' ? { audience: audience as AuditAudience } : {}),
          ...(status !== 'All' ? { status: status as AuditStatus } : {}),
          limit: PAGE,
          offset,
        });
        if (seq !== loadSeq.current) return; // a newer filter change superseded this load
        // Advance the cursor by a whole page whenever the server had rows at this offset, even when
        // dedup discards all of them — that discard means the window slid, so the unseen rows are one
        // page further down. An empty response is the end of the feed: leave the cursor put.
        if (offset === 0) pages.current = 1;
        else if (res.entries.length > 0) pages.current += 1;
        setEndReached(res.entries.length < PAGE);
        setEntries((prev) => {
          if (offset === 0) return res.entries;
          /**
           * Offset paging over an append-only feed: every row written since page 1 shifts the
           * `created_at DESC` window down, so the tail of what we already hold comes back as the head
           * of this page. Dropping the repeats keeps `key={e.id}` unique and the same event out of the
           * list twice. It cannot recover the newest rows that moved above the offset — that needs
           * keyset paging on the server.
           */
          const seen = new Set(prev.map((e) => e.id));
          return [...prev, ...res.entries.filter((e) => !seen.has(e.id))];
        });
        setTotal(res.total);
      } catch (e) {
        if (seq === loadSeq.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (seq === loadSeq.current) {
          setLoading(false);
          setReloading(false);
        }
      }
    },
    [actionPrefix, audience, status],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  // Free-text filter applies client-side over the loaded page(s).
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      [e.userName, e.userId, e.company, e.action, e.profile, e.callerRole, e.resourceId]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [entries, query]);

  // Stands in for the rows on a first load AND on a refilter — rows left over from the previous
  // filter read as matches for the chip that is now highlighted. Load more keeps its rows.
  const showSkeleton = loading && (entries.length === 0 || reloading);

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      <div className={s.head}>
        <div>
          <div className={s.eyebrow}>Activity trail</div>
          <h2 className={s.h2}>Audit Log</h2>
          <p className={s.sub}>
            Every tool call and admin action, newest first — who did it, to what, and what came back.
          </p>
        </div>
      </div>

      <div className={s.chipRow}>
        {ACTION_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={`${s.filterChip} ${actionPrefix === p.prefix ? s.filterChipOn : ''}`}
            onClick={() => setActionPrefix(p.prefix)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className={s.chipRow}>
        {AUDIENCE_FILTERS.map((a) => (
          <button
            key={a}
            type="button"
            className={`${s.filterChip} ${audience === a ? s.filterChipOn : ''}`}
            onClick={() => setAudience(a)}
          >
            {a === 'All' ? 'All audiences' : a}
          </button>
        ))}
        <span style={{ width: 'var(--space-3)' }} />
        {STATUS_FILTERS.map((st) => (
          <button
            key={st}
            type="button"
            className={`${s.filterChip} ${status === st ? s.filterChipOn : ''}`}
            onClick={() => setStatus(st)}
          >
            {st === 'All' ? 'All statuses' : st}
          </button>
        ))}
        <span className={s.chipMeta}>
          {visible.length} of {total} event{total === 1 ? '' : 's'}
        </span>
      </div>

      <label className={s.search}>
        <SearchIcon size={14} />
        <input
          className={s.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter loaded events by user, company, action…"
        />
      </label>

      {error && (
        <p className={s.errorNote} role="alert">
          {error}
        </p>
      )}

      <div className={s.table} aria-busy={showSkeleton}>
        <div className={`${s.tHead} ${s.tAudit}`}>
          <span>When</span>
          <span>User</span>
          <span>Profile · Role</span>
          <span>Company</span>
          <span>Action</span>
          <span className={s.right}>Status</span>
        </div>
        {showSkeleton && (
          <>
            <span className={s.srOnly} role="status">
              Loading audit events…
            </span>
            <TableSkeleton widths={AUDIT_SKELETON} rowClassName={s.tRow} colsClassName={s.tAudit} />
          </>
        )}
        {!showSkeleton &&
          visible.map((e) => (
          <button
            key={e.id}
            type="button"
            className={`${s.tRow} ${s.tRowClick} ${s.tAudit}`}
            onClick={() => setOpen(e)}
          >
            <span className={s.deptText} title={new Date(e.createdAt).toLocaleString()}>
              {relativeTime(e.createdAt)}
            </span>
            <span className={s.docCell}>
              <span className={s.docTitle}>
                {actorName(e)}
                {e.impersonatorUserId && (
                  <span className={s.deptText}> (as-agent by {e.impersonatorUserId})</span>
                )}
              </span>
            </span>
            <span className={s.deptText}>{authorityLine(e)}</span>
            <span className={s.mono}>{e.company ?? (e.audience === 'customer' ? '?' : '—')}</span>
            <span className={s.mono}>
              {e.action}
              {e.toolName ? ` · ${e.toolName}` : ''}
            </span>
            <span className={s.right}>
              <StatusPill status={e.status} />
            </span>
          </button>
        ))}
        {!loading && visible.length === 0 && (
          <div className={s.none}>No audit events match the current filters.</div>
        )}
      </div>

      {/* Hidden while the skeleton stands in: on a refilter the gate below still reads the previous
          filter's counts, so leaving it mounted put a second "Loading…" spinner under the skeleton
          table for the same offset-0 request. Its spinner is now only ever a Load-more spinner. */}
      {!showSkeleton && !endReached && entries.length < total && (
        <button
          type="button"
          className={s.ghostBtn}
          style={{ alignSelf: 'center' }}
          disabled={loading}
          onClick={() => void load(pages.current * PAGE)}
        >
          {loading ? (
            <>
              <span className={s.loadingSpin} aria-hidden="true" />
              Loading…
            </>
          ) : (
            `Load more (${entries.length} of ${total})`
          )}
        </button>
      )}

      {open && <AuditDetailModal entry={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AuditDetailModal({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  // Initial focus, the Tab cycle and focus restore come from the shared hook: the panel declares
  // aria-modal="true", so Tab must not walk into the filter chips still focusable behind the backdrop.
  const panelRef = useModalFocus<HTMLDivElement>();
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
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
        aria-label={`Audit event ${entry.action}`}
        tabIndex={-1}
      >
        <div className={s.modalHead}>
          <span className={s.cardTitle}>{entry.action}</span>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close">
            <XIcon size={12} />
          </button>
        </div>

        <div className={s.metaGrid}>
          <Meta label="When" value={new Date(entry.createdAt).toLocaleString()} />
          <Meta label="Status" value={entry.status} />
          <Meta label="User" value={actorName(entry)} />
          <Meta label="User id" value={entry.userId ?? '—'} />
          <Meta label="Profile" value={entry.profile ?? '—'} />
          <Meta label="Role" value={entry.callerRole ?? entry.role ?? '—'} />
          <Meta label="Audience" value={entry.audience ?? '—'} />
          <Meta label="Company" value={entry.company ?? '—'} />
          <Meta label="Acting agent" value={entry.actingAgent ?? '—'} />
          <Meta label="Impersonator" value={entry.impersonatorUserId ?? '—'} />
          <Meta label="Resource" value={entry.resourceId ? `${entry.resourceType ?? ''} ${entry.resourceId}`.trim() : '—'} />
          <Meta label="IP" value={entry.ip ?? '—'} />
        </div>

        {entry.detail && (
          <div className={s.chunkCard}>
            <div className={s.chunkMeta}>
              <span className={s.mono}>detail</span>
            </div>
            <pre className={s.chunkText}>{JSON.stringify(entry.detail, null, 2)}</pre>
          </div>
        )}
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

function StatusPill({ status }: { status: AuditStatus }) {
  const tone = status === 'ok' ? s.pillGood : status === 'denied' ? s.pillWarn : s.pillBad;
  return (
    <span className={`${s.pill} ${tone}`}>
      <span className={s.dot} />
      {status}
    </span>
  );
}
