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
import { DataTable, type DataColumn } from '@/ds';
import { OpenPoolCaseSheet } from './OpenPoolCaseSheet';

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

/**
 * One definition, two renderings — see ds/DataTable.
 *
 * The mobile roles are the answer to "what does an agent need to triage this row on a phone?":
 * WHO it is (company, primary), WHICH carrier and HOW LONG it has been quiet (secondary), and WHERE
 * it stands (status, the one value). Gallons, cycle count and the claim window are real data but
 * they are what you check AFTER deciding a row is worth opening, so they live in the detail sheet
 * rather than competing for a 375px row.
 *
 * Module scope, not inline: DataTable memoises its rows on `columns` identity, and an array rebuilt
 * every render would silently undo that.
 */
/** Exported for OpenPoolReadonlyPanel.test.tsx, which asserts card/table data parity. */
export const COLUMNS: Array<DataColumn<RetentionCaseRow> & { sortKey?: SortKey }> = [
  {
    id: 'companyName',
    sortKey: 'companyName',
    header: 'Company',
    sortable: true,
    rowHeader: true,
    mobile: 'primary',
    cell: (c) => (
      <span className="cs-pool-company">
        <Building2 size={14} strokeWidth={2.2} aria-hidden />
        {c.companyName || c.carrierId}
      </span>
    ),
  },
  {
    id: 'carrierId',
    sortKey: 'carrierId',
    header: 'Carrier',
    sortable: true,
    mobile: 'secondary',
    cell: (c) => <span className="cs-pool-mono">{c.carrierId}</span>,
  },
  {
    id: 'daysInactive',
    sortKey: 'daysInactive',
    header: 'Quiet',
    sortable: true,
    numeric: true,
    mobile: 'secondary',
    cell: (c) => (
      <span className={`cs-pool-quiet is-${quietTone(c.daysInactive)}`}>{quietLabel(c)}</span>
    ),
  },
  {
    id: 'gallons90d',
    sortKey: 'gallons90d',
    header: 'Gallons 90d',
    sortable: true,
    numeric: true,
    priority: 2,
    cell: (c) => <span className="cs-pool-mono">{fmtGal(c.gallons90d)}</span>,
  },
  {
    id: 'assignmentCount',
    sortKey: 'assignmentCount',
    header: 'Cycle',
    sortable: true,
    numeric: true,
    priority: 2,
    cell: (c) => <span className="cs-pool-mono">{c.assignmentCount}/3</span>,
  },
  {
    id: 'status',
    header: 'Status',
    mobile: 'value',
    cell: (c) => <CaseBadge tone={statusTone(c.statusCode)}>{statusLabel(c.statusCode)}</CaseBadge>,
  },
  {
    id: 'window',
    header: 'Window',
    priority: 3,
    cell: (c) => (
      <span className="cs-pool-window">
        <CalendarClock size={12} strokeWidth={2.3} aria-hidden />
        {deadlineLabel(c)}
      </span>
    ),
  },
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
            <DataTable
              caption="Deals in the Sales Open Pool. Select a row to read its timeline."
              rows={rows}
              rowKey={(c) => c.id}
              columns={COLUMNS}
              scrollerClassName="cs-table-wrap cs-pool-table-wrap"
              className="cs-table cs-pool-table"
              density="compact"
              selected={(c) => c.id === selectedId}
              /* Desktop: the row selects, and the timeline drawer beside it does the rest.
                 Phone: there is no "beside", and Gallons / Cycle / Window fall off the card — so
                 tapping opens the record instead. DataTable resolves that per mode; see its
                 `detail` prop. */
              onRowActivate={(c) => setSelectedId(c.id)}
              detail={{
                title: (c) => c.companyName || c.carrierId,
                subtitle: (c) => c.carrierId,
                render: (c) => <OpenPoolCaseSheet row={c} />,
              }}
              sort={{
                by: sort.key,
                direction: sort.dir === 'asc' ? 'ascending' : 'descending',
                onSort: (columnId) => toggleSort(columnId as SortKey),
              }}
            />
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
