/**
 * Maintenance cases panel — a searchable list over `maintenance_cases` (Postgres, not Zoho),
 * rendered as Card, List, or Kanban (CS feedback 2026-08-07 asked for the latter two — the original
 * card grid alone made a big page hard to scan). All three views render the same page of rows;
 * `view` only changes the layout. Chrome is deliberately the module's existing vocabulary (cs-panel
 * / cs-header-row / cs-app-tabs / cs-app-pagination / cs-an-rc-field), so this reads as another CS
 * tab and not a second design.
 *
 * One shape note driven by the data: 2,701 of 2,714 migrated cases are `Completed` and only 13 are
 * live. So the default view is unfiltered-newest-first (a Completed-heavy list IS the archive an
 * agent searches), and the status tabs are how they jump to the active few.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { MaintenanceCard } from './MaintenanceCard';
import { MaintenanceKanbanView } from './MaintenanceKanbanView';
import { MaintenanceListView } from './MaintenanceListView';
import { MaintenanceModal } from './MaintenanceModal';
import { SearchableSelect } from './SearchableSelect';
import { Toast, type ToastState } from './Toast';
import {
  loadMaintenance,
  loadMaintenanceMeta,
  localYmd,
  maintenanceTitle,
  useLoad,
  type MaintenanceQuery,
  type MaintenanceRecord,
} from './live';

const SEARCH_DEBOUNCE_MS = 400;

/**
 * The Case Type FILTER only offers these three (2026-08-18 request) — the combo types
 * ("PMs / Mechanical", "PMs and CARB", ...) and "DOT Inspection" still exist as real data and are
 * still assignable on a case (`meta.data.caseTypeOptions` is untouched, shared with the create/edit
 * form's picklist); they're just not offered as an explicit filter chip. "All types" still shows
 * everything, filtered types included.
 */
const CASE_TYPE_FILTER_OPTIONS = ['Mechanical', 'PMs', 'Tire Replacement'];

const REFRESH_PATH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';
const FILTER_PATH = 'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z';

type SortId = NonNullable<MaintenanceQuery['sort']>;

const SORTS: { id: SortId; label: string }[] = [
  { id: 'date', label: 'Case date' },
  { id: 'created', label: 'Recently added' },
  { id: 'amount', label: 'Amount' },
  { id: 'company', label: 'Company' },
  { id: 'carrier', label: 'Carrier ID' },
];

/** CS feedback 2026-08-07: "the list view we had before was much easier to scan than this card
 *  grid" + "ideally Kanban too". All three read the same page of rows — just different layouts. */
type ViewMode = 'card' | 'list' | 'kanban';
const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'card', label: 'Card' },
  { id: 'list', label: 'List' },
  { id: 'kanban', label: 'Kanban' },
];

export function Maintenance() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [caseType, setCaseType] = useState('');
  const [owner, setOwner] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState<SortId>('date');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<ViewMode>('card');

  const [modalOpen, setModalOpen] = useState(false);
  const [modalRow, setModalRow] = useState<MaintenanceRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const today = localYmd(new Date());

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const list = useLoad(
    () =>
      loadMaintenance({
        ...(query.trim() ? { search: query.trim() } : {}),
        ...(status ? { status: [status] } : {}),
        ...(caseType ? { caseType: [caseType] } : {}),
        ...(paymentStatus ? { paymentStatus: [paymentStatus] } : {}),
        ...(owner ? { owner } : {}),
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
        sort,
        dir,
        page,
        perPage: 24,
      }),
    [query, status, caseType, paymentStatus, owner, dateFrom, dateTo, sort, dir, page],
  );
  const meta = useLoad(loadMaintenanceMeta, []);

  const rows = list.data?.rows ?? [];
  const facets = list.data?.facets;
  const loading = list.loading;
  const total = list.data?.total ?? 0;
  const hasMore = list.data?.hasMore === true;

  // Tabs are driven by the facets (which ignore the selected status), so each tab keeps showing its
  // own count while another tab is active. Canonical order first — Object.keys order is data order.
  const statusTabs = useMemo(() => {
    const counts = facets?.byStatus ?? {};
    const canonical = meta.data?.statusOptions ?? [];
    const seen = new Set(canonical);
    const extra = Object.keys(counts).filter((k) => !seen.has(k) && k !== '—');
    return [...canonical, ...extra].filter((s) => (counts[s] ?? 0) > 0 || status === s);
  }, [facets, meta.data, status]);

  const activeFilterCount =
    (caseType ? 1 : 0) + (owner ? 1 : 0) + (paymentStatus ? 1 : 0) + (dateFrom || dateTo ? 1 : 0);

  // Memoised so SearchableSelect's option list keeps a stable identity across the panel's re-renders
  // (it re-renders on every search keystroke).
  const ownerOptions = useMemo(
    () =>
      (meta.data?.owners ?? []).map((o) => ({
        value: o.ownerZohoUserId,
        label: o.ownerName,
        hint: String(o.count),
      })),
    [meta.data],
  );

  function notify(kind: ToastState['kind'], message: string) {
    setToast({ id: Date.now(), kind, message });
  }
  function refreshAll() {
    list.reload();
    meta.reload();
  }
  function switchStatus(s: string) {
    if (loading) return;
    setStatus(s);
    setPage(1);
  }
  function goToPage(n: number) {
    if (n < 1 || loading) return;
    setPage(n);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function clearFilters() {
    setCaseType('');
    setOwner('');
    setPaymentStatus('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }
  // useCallback'd: every card receives it, and a fresh identity each render would defeat their memo.
  const openCase = useCallback((row: MaintenanceRecord) => {
    setCreating(false);
    setModalRow(row);
    setModalOpen(true);
  }, []);
  function openCreate() {
    setCreating(true);
    setModalRow(null);
    setModalOpen(true);
  }

  useEffect(() => {
    if (list.error) notify('error', `Load failed: ${list.error}`);
  }, [list.error]);

  return (
    <div className="cs-panel cs-mt-panel">
      {/* ── Header ── */}
      <div className="cs-header-row">
        <div>
          <h2 className="cs-title">Maintenance</h2>
          <div className="cs-subtitle">
            {total.toLocaleString()} case{total === 1 ? '' : 's'}
            {rows.length ? ` · showing ${rows.length}` : ''} · Page {page}
            {loading ? <span style={{ color: 'var(--cs-accent)', marginLeft: '0.5rem' }}>Loading…</span> : null}
          </div>
        </div>
        {/* The class is a HOOK ONLY — every desktop declaration stays in the inline style beside it,
            so adding it cannot move a desktop pixel. `cs-mt-actions` carries rules exclusively inside
            `(width < 640px)`, where this cluster is 460px of nowrap content in a 351px row and the
            "Kanban" button loses its last 20px. */}
        <div className="cs-mt-actions" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div className="cs-mt-view-toggle" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`cs-mt-view-btn${view === v.id ? ' active' : ''}`}
                onClick={() => setView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button
            className={`cs-refresh-btn${filtersOpen ? ' cs-mt-filter-btn-on' : ''}`}
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={FILTER_PATH} />
            </svg>
            Filters
            {activeFilterCount > 0 ? <span className="cs-mt-filter-count">{activeFilterCount}</span> : null}
          </button>
          <button className="cs-refresh-btn cs-mt-add-btn" onClick={openCreate}>
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            New Case
          </button>
          <button className="cs-refresh-btn" onClick={refreshAll} disabled={loading}>
            <svg
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              className={loading ? 'spin-icon' : undefined}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={REFRESH_PATH} />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ── Search + status tabs ── */}
      <div className="cs-mt-toolbar">
        <div className="cs-citi-search-bar cs-mt-search">
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search carrier ID, company, unit #, work order, driver, phone…"
          />
          {search ? (
            <button
              type="button"
              className="cs-mt-search-clear"
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              ×
            </button>
          ) : null}
        </div>
        {statusTabs.length ? (
          <div className="cs-app-tabs">
            <button
              className={`cs-app-tab${status === '' ? ' active' : ''}`}
              onClick={() => switchStatus('')}
              disabled={loading}
            >
              All{facets ? ` (${facets.total.toLocaleString()})` : ''}
            </button>
            {statusTabs.map((s) => (
              <button
                key={s}
                className={`cs-app-tab${status === s ? ' active' : ''}`}
                onClick={() => switchStatus(s)}
                disabled={loading}
              >
                {s}
                {facets?.byStatus[s] !== undefined ? ` (${facets.byStatus[s]?.toLocaleString()})` : ''}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── Filter rail ── */}
      {filtersOpen ? (
        <div className="cs-mt-filters" role="group" aria-label="Maintenance filters">
          <label className="cs-mt-filter">
            <span>Case type</span>
            <select
              value={caseType}
              onChange={(e) => {
                setCaseType(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All types</option>
              {(meta.data?.caseTypeOptions ?? [])
                .filter((o) => CASE_TYPE_FILTER_OPTIONS.includes(o))
                .map((o) => (
                  <option key={o} value={o}>
                    {o}
                    {facets?.byCaseType[o] !== undefined ? ` (${facets.byCaseType[o]})` : ''}
                  </option>
                ))}
            </select>
          </label>

          <label className="cs-mt-filter">
            <span>Payment</span>
            <select
              value={paymentStatus}
              onChange={(e) => {
                setPaymentStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Any status</option>
              {(meta.data?.paymentStatusOptions ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                  {facets?.byPaymentStatus[o] !== undefined ? ` (${facets.byPaymentStatus[o]})` : ''}
                </option>
              ))}
            </select>
          </label>

          {/* Searchable rather than a native <select>: 16 owners is too many to scan, and a native
              select cannot be typed past its first letter. Filtering is client-side — the roster
              already arrived with /meta. */}
          <div className="cs-mt-filter cs-mt-filter-owner">
            <span>Owner</span>
            <SearchableSelect
              value={owner}
              options={ownerOptions}
              placeholder="Search owner…"
              allLabel="Anyone"
              onChange={(v) => {
                setOwner(v);
                setPage(1);
              }}
            />
          </div>

          <label className="cs-an-rc-field cs-mt-filter-date">
            <span>From</span>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || today}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="cs-an-rc-field cs-mt-filter-date">
            <span>To</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
            />
          </label>

          <label className="cs-mt-filter">
            <span>Sort by</span>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as SortId);
                setPage(1);
              }}
            >
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="cs-mt-dir-btn"
            onClick={() => {
              setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
              setPage(1);
            }}
            title={dir === 'desc' ? 'Descending — click for ascending' : 'Ascending — click for descending'}
          >
            {dir === 'desc' ? '↓ Desc' : '↑ Asc'}
          </button>

          {activeFilterCount > 0 ? (
            <button type="button" className="cs-mt-clear-btn" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      {/* ── Cards ── */}
      {loading && rows.length === 0 ? (
        <div className="cs-mt-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="cs-skeleton" style={{ height: 218, borderRadius: 14 }} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="cs-mt-empty">
          <div className="cs-mt-empty-title">No maintenance cases found</div>
          <div className="cs-mt-empty-hint">
            {query || activeFilterCount > 0 || status
              ? 'Try a different search or clear the filters.'
              : 'Create the first case with New Case.'}
          </div>
        </div>
      ) : view === 'list' ? (
        <MaintenanceListView rows={rows} onOpen={openCase} />
      ) : view === 'kanban' ? (
        <MaintenanceKanbanView rows={rows} statusOptions={meta.data?.statusOptions ?? []} onOpen={openCase} />
      ) : (
        <div className="cs-mt-grid">
          {rows.map((row) => (
            <MaintenanceCard key={row.id} row={row} onOpen={openCase} />
          ))}
        </div>
      )}

      {/* ── Pagination ── */}
      {page > 1 || hasMore ? (
        <div className="cs-app-pagination">
          <button
            className="cs-btn cs-btn-ghost"
            disabled={page <= 1 || loading}
            onClick={() => goToPage(page - 1)}
          >
            ← Prev
          </button>
          <span className="cs-page-indicator">
            Page <strong>{page}</strong>
            {!hasMore ? <span style={{ color: 'var(--text-muted)' }}> · last</span> : null}
          </span>
          <button
            className="cs-btn cs-btn-ghost"
            disabled={!hasMore || loading}
            onClick={() => goToPage(page + 1)}
          >
            Next →
          </button>
        </div>
      ) : null}

      {/* ── View / Edit / Create ── */}
      {modalOpen ? (
        <MaintenanceModal
          record={creating ? null : modalRow}
          statusOptions={meta.data?.statusOptions ?? []}
          caseTypeOptions={meta.data?.caseTypeOptions ?? []}
          paymentMethodOptions={meta.data?.paymentMethodOptions ?? []}
          paymentStatusOptions={meta.data?.paymentStatusOptions ?? []}
          onClose={() => setModalOpen(false)}
          onSaved={(saved) => {
            setModalOpen(false);
            // Name the CASE, not one of its fields. The old message reported the total amount, which
            // is neither what the agent changed nor a confirmation of anything — and rendered
            // "Case updated · —" on the cases that carry no amount.
            const label = maintenanceTitle(saved);
            notify('success', creating ? `Case created for ${label}` : `Case updated for ${label}`);
            refreshAll();
          }}
          onDeleted={() => {
            setModalOpen(false);
            notify('success', 'Case deleted');
            refreshAll();
          }}
        />
      ) : null}

      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
