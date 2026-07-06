import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listAudit,
  type AuditAudience,
  type AuditEntry,
  type AuditStatus,
} from '../../api/audit';
import { SearchIcon, XIcon } from '../../components/icons';
import s from './admin.module.css';

const PAGE = 50;
const COLS = { gridTemplateColumns: '0.9fr 1.4fr 1.1fr 0.9fr 1.4fr 0.7fr' } as const;

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
  const [error, setError] = useState('');
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const loadSeq = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      const seq = (loadSeq.current += 1);
      setLoading(true);
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
        setEntries((prev) => (offset === 0 ? res.entries : [...prev, ...res.entries]));
        setTotal(res.total);
      } catch (e) {
        if (seq === loadSeq.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (seq === loadSeq.current) setLoading(false);
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

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      <div className={s.head}>
        <div>
          <h2 className={s.h2}>Audit Log</h2>
          <p className={s.sub}>
            Who did what, when — logins, buttons, automations, and agent actions for workers and
            carrier companies alike.
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

      <div className={s.table}>
        <div className={s.tHead} style={COLS}>
          <span>When</span>
          <span>User</span>
          <span>Profile · Role</span>
          <span>Company</span>
          <span>Action</span>
          <span className={s.right}>Status</span>
        </div>
        {visible.map((e) => (
          <button
            key={e.id}
            type="button"
            className={`${s.tRow} ${s.tRowClick}`}
            style={COLS}
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
        {loading && entries.length === 0 && <div className={s.none}>Loading audit events…</div>}
        {!loading && visible.length === 0 && (
          <div className={s.none}>No audit events match the current filters.</div>
        )}
      </div>

      {entries.length < total && (
        <button
          type="button"
          className={s.ghostBtn}
          style={{ alignSelf: 'center' }}
          disabled={loading}
          onClick={() => void load(entries.length)}
        >
          {loading ? 'Loading…' : `Load more (${entries.length} of ${total})`}
        </button>
      )}

      {open && <AuditDetailModal entry={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AuditDetailModal({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);

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
