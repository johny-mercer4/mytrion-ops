import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TableSkeleton } from '@/components/mytrion/table-skeleton';
import {
  auditFacets,
  fetchAuditForExport,
  listAudit,
  type AuditAudience,
  type AuditEntry,
  type AuditFacets,
  type AuditFilter,
  type AuditStatus,
} from '../../api/audit';
import { SearchIcon } from '../../components/icons';
import { AuditDetailModal } from './AuditDetailModal';
import { exportRowsCsv, exportRowsXlsx, type ExportColumn } from './logsExport';
import { auditActorDisplay } from './auditActorDisplay';
import {
  ALL,
  DateField,
  ExportButton,
  FilterSelect,
  dayBoundary,
  relativeTime,
  useDebounced,
  type ExportFormat,
} from './logsShared';
import s from './admin.module.css';

const PAGE = 50;
const AUDIT_SKELETON = ['48%', '56%', '62%', '40%', '70%', '56px'] as const;

const AUDIENCE_FILTERS = ['All', 'internal', 'customer', 'partner'] as const;
const STATUS_FILTERS = ['All', 'ok', 'denied', 'error'] as const;

/**
 * Quick "what happened" chips.
 *
 * `actions` (EXACT names) rather than `prefix` wherever a prefix would lie. Logins is the reason
 * this distinction exists: the three sign-in events share no prefix, and the `auth.` prefix that
 * used to stand in for it swept up `auth.act_as` — 9,178 per-request impersonation rows in 30 days
 * against 116 real logins — while never matching a carrier mini-app login at all.
 */
interface ActionPreset {
  label: string;
  prefix?: string;
  actions?: string[];
  /** Copy for the empty state, so a chip with no rows explains itself. */
  hint?: string;
}
const ACTION_PRESETS: ActionPreset[] = [
  { label: 'Everything' },
  {
    label: 'Logins',
    actions: ['auth.login', 'auth.zoho.login', 'mini_app.auth.login'],
    hint: 'Worker sign-ins (Zoho OAuth) and carrier mini-app sign-ins.',
  },
  {
    label: 'Carrier logins',
    actions: ['mini_app.auth.login'],
    hint: 'Carriers signing in to the Telegram mini app (not the Horizon worker bot).',
  },
  {
    label: 'Mytrion access',
    actions: ['mytrion.access'],
    hint: 'Which internal user opened which Mytrion, and when.',
  },
  {
    label: 'Impersonation',
    actions: ['auth.act_as'],
    hint: 'Admins acting as another agent — one row per session, plus every refusal.',
  },
  { label: 'Chat / agents', prefix: 'agent.' },
  { label: 'Tools', prefix: 'tool.' },
  { label: 'Knowledge', prefix: 'knowledge.' },
  { label: 'Automations', prefix: 'automation.' },
  { label: 'Carrier users', prefix: 'admin.carrier_user' },
];

const EMPTY_FACETS: AuditFacets = {
  userNames: [],
  profiles: [],
  roles: [],
  callerRoles: [],
  actions: [],
  loginActions: [],
};

/** "Who" cell: display name first, falling back to the raw user id. */
function actorName(e: AuditEntry): string {
  return auditActorDisplay(e);
}

function authorityLine(e: AuditEntry): string {
  const parts = [e.profile, e.callerRole ?? e.role].filter(Boolean);
  return parts.join(' · ') || '—';
}

/** Action cell — the resource is what makes a `mytrion.access` or `tool.call` row legible. */
function actionLine(e: AuditEntry): string {
  const suffix = e.toolName ?? (e.resourceType === 'mytrion' ? e.resourceId : null);
  return suffix ? `${e.action} · ${suffix}` : e.action;
}

const EXPORT_COLUMNS: ReadonlyArray<ExportColumn<AuditEntry>> = [
  { header: 'When (local)', width: 22, value: (e) => new Date(e.createdAt).toLocaleString() },
  { header: 'When (ISO)', width: 26, value: (e) => e.createdAt },
  { header: 'Action', width: 30, value: (e) => e.action },
  { header: 'Status', width: 10, value: (e) => e.status },
  { header: 'User', width: 26, value: (e) => auditActorDisplay(e) },
  { header: 'User id', width: 26, value: (e) => e.userId ?? '' },
  { header: 'Profile', width: 20, value: (e) => e.profile ?? '' },
  { header: 'Zoho role', width: 24, value: (e) => e.callerRole ?? '' },
  { header: 'Internal role', width: 14, value: (e) => e.role ?? '' },
  { header: 'Audience', width: 12, value: (e) => e.audience ?? '' },
  { header: 'Company', width: 26, value: (e) => e.company ?? '' },
  { header: 'Impersonator', width: 24, value: (e) => e.impersonatorUserId ?? '' },
  { header: 'Acting agent', width: 18, value: (e) => e.actingAgent ?? '' },
  { header: 'Tool', width: 24, value: (e) => e.toolName ?? '' },
  { header: 'Resource type', width: 18, value: (e) => e.resourceType ?? '' },
  { header: 'Resource id', width: 26, value: (e) => e.resourceId ?? '' },
  { header: 'IP', width: 16, value: (e) => e.ip ?? '' },
  { header: 'Request id', width: 26, value: (e) => e.requestId ?? '' },
  { header: 'Detail', width: 60, value: (e) => (e.detail ? JSON.stringify(e.detail) : '') },
];

/** Admin Audit Log — every login, button, automation, and agent action; workers AND carriers. */
export function AuditLog({ source = 'human' }: { source?: 'human' | 'vitest' }) {
  const vitest = source === 'vitest';
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<AuditFacets>(EMPTY_FACETS);
  const [preset, setPreset] = useState<ActionPreset>(ACTION_PRESETS[0] as ActionPreset);
  const [audience, setAudience] = useState<(typeof AUDIENCE_FILTERS)[number]>('All');
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('All');
  const [userName, setUserName] = useState(ALL);
  const [profile, setProfile] = useState(ALL);
  const [role, setRole] = useState(ALL);
  const [callerRole, setCallerRole] = useState(ALL);
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [query, setQuery] = useState('');
  const search = useDebounced(query);
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

  /**
   * The filter, as the server sees it. Every narrowing control feeds this — including free text,
   * which used to filter only the rows already loaded and so silently disagreed with the "N of M"
   * counter and with any export taken while it was set.
   */
  const filter = useMemo<AuditFilter>(() => {
    const from = dayBoundary(fromDay, 'start');
    const to = dayBoundary(toDay, 'end');
    return {
      ...(preset.actions ? { actions: preset.actions } : {}),
      ...(preset.prefix ? { action: preset.prefix } : {}),
      ...(audience !== 'All' ? { audience: audience as AuditAudience } : {}),
      ...(status !== 'All' ? { status: status as AuditStatus } : {}),
      ...(userName ? { userName } : {}),
      ...(profile ? { profile } : {}),
      ...(role ? { role } : {}),
      ...(callerRole ? { callerRole } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      source,
    };
  }, [preset, audience, status, userName, profile, role, callerRole, search, fromDay, toDay, source]);

  // Facets are the whole tenant's value space, not the current page's — loaded once.
  useEffect(() => {
    let alive = true;
    void auditFacets(source)
      .then((f) => {
        if (alive) setFacets(f);
      })
      .catch(() => undefined); // a missing dropdown must not break the table
    return () => {
      alive = false;
    };
  }, [source]);

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
        const res = await listAudit({ ...filter, limit: PAGE, offset });
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
    [filter],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const onExport = useCallback(
    async (format: ExportFormat) => {
      // Re-queried server-side under the SAME filter, so the file is the whole matching set — not
      // the handful of pages that happen to be scrolled in.
      const rows = await fetchAuditForExport(filter);
      const filters = [
        preset.label !== 'Everything' ? preset.label : '',
        audience !== 'All' ? `Audience: ${audience}` : '',
        status !== 'All' ? `Status: ${status}` : '',
        userName ? `Agent: ${userName}` : '',
        profile ? `Profile: ${profile}` : '',
        role ? `Role: ${role}` : '',
        callerRole ? `Zoho role: ${callerRole}` : '',
        fromDay ? `From ${fromDay}` : '',
        toDay ? `To ${toDay}` : '',
        search.trim() ? `Search: "${search.trim()}"` : '',
      ].filter(Boolean);
      const meta = {
        title: vitest ? 'VITEST LOGS' : 'AUDIT LOG',
        subtitle: vitest
          ? 'Mytrion Horizon · API-test fixture trail'
          : 'Mytrion Horizon · Activity trail',
        filters,
        filenameStem: vitest ? 'Vitest_Logs' : 'Audit_Log',
        sheetName: vitest ? 'Vitest Logs' : 'Audit Log',
      };
      if (format === 'csv') await exportRowsCsv(rows, EXPORT_COLUMNS, meta);
      else await exportRowsXlsx(rows, EXPORT_COLUMNS, meta);
    },
    [filter, preset, audience, status, userName, profile, role, callerRole, fromDay, toDay, search, vitest],
  );

  const resetFilters = useCallback(() => {
    setPreset(ACTION_PRESETS[0] as ActionPreset);
    setAudience('All');
    setStatus('All');
    setUserName(ALL);
    setProfile(ALL);
    setRole(ALL);
    setCallerRole(ALL);
    setFromDay('');
    setToDay('');
    setQuery('');
  }, []);

  const narrowed =
    preset.label !== 'Everything' ||
    audience !== 'All' ||
    status !== 'All' ||
    Boolean(userName || profile || role || callerRole || fromDay || toDay || query.trim());

  // Stands in for the rows on a first load AND on a refilter — rows left over from the previous
  // filter read as matches for the chip that is now highlighted. Load more keeps its rows.
  const showSkeleton = loading && (entries.length === 0 || reloading);

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      <div className={s.head}>
        <div>
          <div className={s.eyebrow}>{vitest ? 'Test fixtures' : 'Activity trail'}</div>
          <h2 className={s.h2}>{vitest ? 'Vitest Logs' : 'Audit Log'}</h2>
          <p className={s.sub}>
            {vitest
              ? 'Rows written by the API test suite (short Zoho ids like zoho:42). They are not real operators and do not belong on the Audit Log.'
              : 'Every login, tool call, and admin action, newest first — who did it, with what authority, to what, and what came back. Test-suite noise lives on Vitest Logs.'}
          </p>
        </div>
      </div>

      <div className={s.chipRow}>
        {ACTION_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={`${s.filterChip} ${preset.label === p.label ? s.filterChipOn : ''}`}
            onClick={() => setPreset(p)}
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
      </div>

      <div className={s.filterGrid}>
        <FilterSelect
          label="Agent name"
          value={userName}
          options={facets.userNames}
          allLabel="All agents"
          onChange={setUserName}
        />
        <FilterSelect
          label="Profile"
          value={profile}
          options={facets.profiles}
          allLabel="All profiles"
          onChange={setProfile}
        />
        <FilterSelect
          label="Zoho role"
          value={callerRole}
          options={facets.callerRoles}
          allLabel="All Zoho roles"
          onChange={setCallerRole}
        />
        <FilterSelect
          label="Internal role"
          value={role}
          options={facets.roles}
          allLabel="All internal roles"
          onChange={setRole}
        />
        <DateField label="From" value={fromDay} onChange={setFromDay} />
        <DateField label="To" value={toDay} onChange={setToDay} />
      </div>

      <div className={s.logToolbar}>
        <label className={s.search}>
          <SearchIcon size={14} />
          <input
            className={s.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search user, company, action, resource…"
          />
        </label>
        <span className={s.chipMeta}>
          {entries.length.toLocaleString()} of {total.toLocaleString()} event
          {total === 1 ? '' : 's'}
        </span>
        {narrowed && (
          <button type="button" className={s.linkBtn} onClick={resetFilters}>
            Clear filters
          </button>
        )}
        <span className={s.logToolbarSpacer} />
        <ExportButton
          onExport={onExport}
          disabled={total === 0}
          rowHint={`${total.toLocaleString()} row${total === 1 ? '' : 's'} match the current filter`}
        />
      </div>

      {error && (
        <p className={s.errorNote} role="alert">
          {error}
        </p>
      )}

      <div className={s.table} data-table-scroller aria-busy={showSkeleton}>
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
          entries.map((e) => (
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
              <span className={s.mono}>{actionLine(e)}</span>
              <span className={s.right}>
                <StatusPill status={e.status} />
              </span>
            </button>
          ))}
        {!loading && entries.length === 0 && (
          <div className={s.none}>
            No audit events match the current filters.
            {preset.hint ? ` ${preset.hint}` : ''}
          </div>
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

function StatusPill({ status }: { status: AuditStatus }) {
  const tone = status === 'ok' ? s.pillGood : status === 'denied' ? s.pillWarn : s.pillBad;
  return (
    <span className={`${s.pill} ${tone}`}>
      <span className={s.dot} />
      {status}
    </span>
  );
}
