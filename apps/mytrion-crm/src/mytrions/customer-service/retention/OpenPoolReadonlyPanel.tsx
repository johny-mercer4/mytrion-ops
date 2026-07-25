/**
 * CS Open Pool — readonly watch on the Sales pool. CS never claims here (that's Sales'); this desk
 * exists to see what is going quiet and how long it has been sitting, and to read a case's timeline
 * including claim transfers.
 *
 * Structure follows the two in-house patterns the module already proves: the Sales Open Pool tab
 * (metrics strip + search + sortable rows + entry-reason legend) and the CITI Folder tab (glass
 * table in a `cs-table-wrap`), with a sticky detail drawer for the timeline.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Clock3,
  Droplets,
  Hash,
  Layers,
  RefreshCw,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';
import type { RetentionCaseEventRow, RetentionCaseRow } from '@/api/touchpointTypes';
import { csRetention } from '@/api/csRetention';
import { useLoad } from '../live';
import { subscribeCsRetentionLive } from './retentionLiveBus';
import { CaseBadge, deadlineLabel, statusLabel, statusTone } from './casesUi';

type SortKey = 'companyName' | 'carrierId' | 'daysInactive' | 'gallons90d' | 'assignmentCount';
type StatusFilter = 'all' | 'available' | 'pending';

const POOL_STATUSES = ['p1_open_pool', 'p1_pool_claim_pending'] as const;

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string; hint: string }> = [
  { id: 'all', label: 'All in pool', hint: 'Everything Sales can see' },
  { id: 'available', label: 'Unclaimed', hint: 'No claim raised yet' },
  { id: 'pending', label: 'Claim pending', hint: 'A Sales agent has asked' },
];

/** How a deal lands in the pool — the legend Sales agents work from. */
const ENTRY_REASONS = [
  { label: 'Reached', hint: '5 BD, no fuel' },
  { label: 'Out of Reach', hint: '5 attempts' },
  { label: 'Retention', hint: '10 BD expiry' },
] as const;

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: 'companyName', label: 'Company' },
  { key: 'carrierId', label: 'Carrier' },
  { key: 'daysInactive', label: 'Quiet', numeric: true },
  { key: 'gallons90d', label: 'Gallons 90d', numeric: true },
  { key: 'assignmentCount', label: 'Cycle', numeric: true },
];

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtGal(v: number | null | undefined): string {
  return v == null ? '—' : Math.round(v).toLocaleString('en-US');
}

function quietLabel(c: RetentionCaseRow): string {
  return c.daysInactive == null ? '—' : `${c.daysInactive}d`;
}

/** Quiet time is the signal on this desk, so it carries a tone rather than being plain text. */
function quietTone(days: number | null | undefined): 'ok' | 'warn' | 'danger' {
  if (days == null) return 'ok';
  if (days >= 10) return 'danger';
  if (days >= 5) return 'warn';
  return 'ok';
}

function PoolTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="cs-pool-skel" aria-busy="true" aria-label="Loading Open Pool">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="cs-pool-skel-row" style={{ animationDelay: `${i * 45}ms` }}>
          <div className="cs-skeleton cs-pool-skel-cell w-30" />
          <div className="cs-skeleton cs-pool-skel-cell w-16" />
          <div className="cs-skeleton cs-pool-skel-cell w-12" />
          <div className="cs-skeleton cs-pool-skel-cell w-16" />
          <div className="cs-skeleton cs-pool-skel-cell w-10" />
        </div>
      ))}
    </div>
  );
}

export function OpenPoolReadonlyPanel() {
  const feed = useLoad(
    () => csRetention.cases({ phase: 'sales', status: 'open_pool', limit: 200 }),
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'daysInactive',
    dir: 'desc',
  });

  // `feed.reload` is stable from useLoad, but referencing it keeps the effect honest.
  const reload = feed.reload;
  useEffect(() => subscribeCsRetentionLive(() => reload()), [reload]);

  const inPool = useMemo(
    () =>
      (feed.data?.cases ?? []).filter((c) =>
        (POOL_STATUSES as readonly string[]).includes(c.statusCode),
      ),
    [feed.data?.cases],
  );

  const rows = useMemo(() => {
    let out = inPool;
    if (statusFilter === 'available') {
      out = out.filter((c) => c.statusCode === 'p1_open_pool');
    } else if (statusFilter === 'pending') {
      out = out.filter((c) => c.statusCode === 'p1_pool_claim_pending');
    }
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((c) => `${c.carrierId} ${c.companyName ?? ''}`.toLowerCase().includes(q));
    }
    const dir = sort.dir === 'desc' ? -1 : 1;
    return out.slice().sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      // Nulls sort last regardless of direction — an unknown value is not "the smallest".
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [inPool, search, sort, statusFilter]);

  const stats = useMemo(() => {
    const gallons = inPool.reduce((sum, c) => sum + (c.gallons90d ?? 0), 0);
    const quiet = inPool.reduce((max, c) => Math.max(max, c.daysInactive ?? 0), 0);
    const pending = inPool.filter((c) => c.statusCode === 'p1_pool_claim_pending').length;
    return { gallons, quiet, pending };
  }, [inPool]);

  // Drop the selection when the selected row leaves the *pool*, not merely the filtered view —
  // filtering or searching must not silently close the drawer you are reading.
  useEffect(() => {
    if (selectedId && !inPool.some((c) => c.id === selectedId)) setSelectedId(null);
  }, [inPool, selectedId]);

  const selected = inPool.find((c) => c.id === selectedId) ?? null;
  const [events, setEvents] = useState<RetentionCaseEventRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId) {
      setEvents([]);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    void csRetention
      .caseGet(selectedId)
      .then((res) => {
        if (!cancelled) setEvents(res.events ?? []);
      })
      .catch((e) => {
        if (!cancelled) {
          setEvents([]);
          setDetailError(e instanceof Error ? e.message : 'Failed to load timeline');
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Refresh keeps the spinner on for a beat so a fast response still reads as an action.
  const [spin, setSpin] = useState(false);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(spinTimer.current), []);
  const refresh = useCallback(() => {
    setSpin(true);
    // refresh(), not reload(): only refresh() flips `refreshing` and passes fresh=true so a cached
    // endpoint actually re-fetches. The timer just holds the spinner long enough to be legible.
    feed.refresh();
    clearTimeout(spinTimer.current);
    spinTimer.current = setTimeout(() => setSpin(false), 800);
  }, [feed]);

  const toggleSort = (key: SortKey): void =>
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'companyName' || key === 'carrierId' ? 'asc' : 'desc' },
    );

  const searching = search.trim().length > 0;
  const busy = spin || feed.refreshing;

  return (
    <div className="cs-panel cs-ret-panel cs-pool-panel">
      <div className="cs-panel-header">
        <div>
          <div className="cs-pool-kicker">
            <Layers size={13} strokeWidth={2.3} aria-hidden />
            Sales Open Pool · readonly
          </div>
          <h2 className="cs-panel-title">Open Pool</h2>
          <p className="cs-panel-sub">
            Quiet deals waiting for a Sales agent to claim. CS cannot claim from here — your Phase 2
            desk is Retention Cases.
          </p>
        </div>
        <button
          type="button"
          className={`cs-btn cs-btn-ghost${busy ? ' is-spinning' : ''}`}
          onClick={refresh}
          disabled={busy}
        >
          <RefreshCw
            size={14}
            strokeWidth={2.3}
            aria-hidden
            className={busy ? 'cs-ret-spin' : undefined}
          />
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="cs-pool-metrics" aria-label="Pool snapshot">
        <div className="cs-pool-metric">
          <span>
            <Users size={12} strokeWidth={2.4} aria-hidden />
            In pool
          </span>
          <strong>{inPool.length}</strong>
          <em>{stats.pending > 0 ? `${stats.pending} claim pending` : 'None pending'}</em>
        </div>
        <div className="cs-pool-metric">
          <span>
            <Droplets size={12} strokeWidth={2.4} aria-hidden />
            Gallons
          </span>
          <strong>{stats.gallons > 0 ? fmtGal(stats.gallons) : '—'}</strong>
          <em>90d listed volume</em>
        </div>
        <div className={`cs-pool-metric is-${quietTone(stats.quiet)}`}>
          <span>
            <Clock3 size={12} strokeWidth={2.4} aria-hidden />
            Longest quiet
          </span>
          <strong>{stats.quiet > 0 ? `${stats.quiet}d` : '—'}</strong>
          <em>Oldest silence in pool</em>
        </div>
        <div className="cs-pool-metric">
          <span>
            <Layers size={12} strokeWidth={2.4} aria-hidden />
            Claim
          </span>
          <strong>Sales</strong>
          <em>Instant · max 2/day</em>
        </div>
      </div>

      <div className="cs-pool-toolbar">
        <div className="cs-pool-search">
          <Search size={15} strokeWidth={2.2} aria-hidden />
          <input
            className="cs-form-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search carrier or company…"
            aria-label="Search carrier or company"
          />
        </div>
        <div className="cs-pool-filters" role="group" aria-label="Filter by claim status">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`cs-chip${statusFilter === f.id ? ' active' : ''}`}
              onClick={() => setStatusFilter(f.id)}
              title={f.hint}
              aria-pressed={statusFilter === f.id}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="cs-pool-count">
          {rows.length}
          {rows.length !== inPool.length ? ` / ${inPool.length}` : ''} shown
        </span>
      </div>

      <div className="cs-pool-layout">
        <div className="cs-pool-main">
          {feed.loading && !feed.data ? (
            <PoolTableSkeleton />
          ) : feed.error ? (
            <div className="cs-pool-empty is-error" role="alert">
              <div className="cs-pool-empty-ico is-danger" aria-hidden>
                <AlertTriangle size={22} strokeWidth={2.1} />
              </div>
              <div className="cs-pool-empty-title">Could not load Open Pool</div>
              <p className="cs-pool-empty-body">{feed.error}</p>
              <button
                type="button"
                className="cs-btn cs-btn-ghost"
                style={{ marginTop: 14 }}
                onClick={refresh}
              >
                Try again
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div className="cs-pool-empty" role="status">
              <div className="cs-pool-empty-ico" aria-hidden>
                <Sparkles size={22} strokeWidth={2.1} />
              </div>
              <div className="cs-pool-empty-title">
                {searching ? 'No matches' : statusFilter !== 'all' ? 'Nothing in this state' : 'Pool is clear'}
              </div>
              <p className="cs-pool-empty-body">
                {searching
                  ? 'No carrier ID or company name in the pool matches that search.'
                  : statusFilter !== 'all'
                    ? 'Switch back to “All in pool” to see everything Sales can claim.'
                    : 'Deals enter when Reached, Out of Reach, or Retention timers expire. Your Retention Cases desk stays separate.'}
              </p>
              {searching || statusFilter !== 'all' ? (
                <button
                  type="button"
                  className="cs-btn cs-btn-ghost"
                  style={{ marginTop: 14 }}
                  onClick={() => {
                    setSearch('');
                    setStatusFilter('all');
                  }}
                >
                  Clear filters
                </button>
              ) : (
                <div className="cs-pool-empty-chips">
                  {ENTRY_REASONS.map((r) => (
                    <span key={r.label} className="cs-pool-empty-chip">
                      <strong>{r.label}</strong>
                      <span>{r.hint}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="cs-table-wrap cs-pool-table-wrap">
              <table className="cs-table cs-pool-table">
                <caption className="cs-sr-only">
                  Deals in the Sales Open Pool. Select a row to read its timeline.
                </caption>
                <thead>
                  <tr>
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className={col.numeric ? 'is-num' : undefined}
                        aria-sort={
                          sort.key === col.key
                            ? sort.dir === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : 'none'
                        }
                      >
                        <button
                          type="button"
                          className={`cs-pool-sort${sort.key === col.key ? ' active' : ''}`}
                          onClick={() => toggleSort(col.key)}
                        >
                          {col.label}
                          <span className="cs-pool-sort-arrow" aria-hidden>
                            {sort.key === col.key ? (sort.dir === 'desc' ? '▼' : '▲') : '↕'}
                          </span>
                        </button>
                      </th>
                    ))}
                    <th>Status</th>
                    <th>Window</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr
                      key={c.id}
                      className={`cs-pool-row${selectedId === c.id ? ' active' : ''}`}
                      onClick={() => setSelectedId(c.id)}
                      tabIndex={0}
                      aria-selected={selectedId === c.id}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedId(c.id);
                        }
                      }}
                    >
                      <td>
                        <span className="cs-pool-company">
                          <Building2 size={14} strokeWidth={2.2} aria-hidden />
                          {c.companyName || c.carrierId}
                        </span>
                      </td>
                      <td className="cs-pool-mono">{c.carrierId}</td>
                      <td className="is-num">
                        <span className={`cs-pool-quiet is-${quietTone(c.daysInactive)}`}>
                          {quietLabel(c)}
                        </span>
                      </td>
                      <td className="is-num cs-pool-mono">{fmtGal(c.gallons90d)}</td>
                      <td className="is-num cs-pool-mono">{c.assignmentCount}/3</td>
                      <td>
                        <CaseBadge tone={statusTone(c.statusCode)}>
                          {statusLabel(c.statusCode)}
                        </CaseBadge>
                      </td>
                      <td>
                        <span className="cs-pool-window">
                          <CalendarClock size={12} strokeWidth={2.3} aria-hidden />
                          {deadlineLabel(c)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="cs-pool-drawer" aria-label="Case timeline">
          {!selected ? (
            <div className="cs-pool-detail-empty">
              <Layers size={28} strokeWidth={1.8} aria-hidden />
              <strong>Select a deal</strong>
              <p>The timeline includes claim transfers when Sales agents take ownership.</p>
            </div>
          ) : (
            <div className="cs-pool-drawer-body">
              <div className="cs-pool-drawer-head">
                <h3>
                  <Building2 size={17} strokeWidth={2.2} aria-hidden />
                  {selected.companyName || selected.carrierId}
                </h3>
                <div className="cs-pool-drawer-badges">
                  <CaseBadge tone={statusTone(selected.statusCode)}>
                    {statusLabel(selected.statusCode)}
                  </CaseBadge>
                  {/* CaseBadge takes a single string child — JSX interpolation would make it an array. */}
                  <CaseBadge tone="info">{`Cycle ${selected.assignmentCount}/3`}</CaseBadge>
                </div>
                <dl className="cs-pool-drawer-meta">
                  <div>
                    <dt>
                      <Hash size={11} strokeWidth={2.4} aria-hidden />
                      Carrier
                    </dt>
                    <dd className="cs-pool-mono">{selected.carrierId}</dd>
                  </div>
                  <div>
                    <dt>
                      <Clock3 size={11} strokeWidth={2.4} aria-hidden />
                      Quiet
                    </dt>
                    <dd>{quietLabel(selected)}</dd>
                  </div>
                  <div>
                    <dt>
                      <Droplets size={11} strokeWidth={2.4} aria-hidden />
                      Gallons 90d
                    </dt>
                    <dd className="cs-pool-mono">{fmtGal(selected.gallons90d)}</dd>
                  </div>
                  <div>
                    <dt>
                      <CalendarClock size={11} strokeWidth={2.4} aria-hidden />
                      Window
                    </dt>
                    <dd>{deadlineLabel(selected)}</dd>
                  </div>
                </dl>
              </div>

              <div className="cs-pool-drawer-section">
                <div className="cs-ret-section-lbl">Timeline</div>
                {detailLoading ? (
                  <div className="cs-pool-skel" aria-busy="true">
                    {Array.from({ length: 3 }, (_, i) => (
                      <div key={i} className="cs-pool-skel-row">
                        <div className="cs-skeleton cs-pool-skel-cell w-30" />
                        <div className="cs-skeleton cs-pool-skel-cell w-70" />
                      </div>
                    ))}
                  </div>
                ) : detailError ? (
                  <p className="cs-error">{detailError}</p>
                ) : events.length === 0 ? (
                  <p className="cs-muted">No events yet.</p>
                ) : (
                  <ul className="cs-pool-timeline">
                    {events.map((ev) => (
                      <li key={ev.id}>
                        <div className="cs-pool-timeline-when">
                          {fmtWhen(ev.occurredAt)} · {ev.eventType}
                        </div>
                        <div className="cs-pool-timeline-note">
                          {ev.notes?.trim() || `${ev.fromStatus ?? '—'} → ${ev.toStatus ?? '—'}`}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
