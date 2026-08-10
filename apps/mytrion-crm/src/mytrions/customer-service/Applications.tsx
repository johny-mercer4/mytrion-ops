/**
 * Applications panel — 1:1 port of the widget's applications-panel.js template
 * (cs-panel / cs-header-row / cs-app-tabs / cs-app-table / cs-app-pagination / modal /
 * toast) over the DONE live-data layer: debounced server search, page state, optimistic
 * per-row onboarding toggles with revert-on-error, reload-after-save.
 */
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';

import { getCardTrackingBulk, toggleOnboarding, type OnboardingField } from '@/api/cs';
import {
  activeFilterCount,
  distinctValues,
  emptyFilters,
  filterApplications,
  sortApplications,
  SORT_OPTIONS,
  type AppFilters,
  type SortDir,
  type SortKey,
} from './applicationsFilters';
import { ApplicationModal } from './ApplicationModal';
import { CardTracking } from './CardTracking';
import { copyWithToast } from './copyToast';
import {
  AppRow,
  CHECK_PROP,
  columnsFor,
  copyableValue,
  isOnboardingField,
  type AppColumn,
  type SubTab,
} from './ApplicationsTable';
import { Toast, type ToastState } from './Toast';
import type { Application } from './data';
import { invalidateApplicationsCache, loadApplications, useLoad } from './live';

/** Widget parity: search fires debounced (App ID / Carrier ID / name / phone, server-side). */
const SEARCH_DEBOUNCE_MS = 400;

/** Card Tracking (QA 2026-08-07) has its own carrier search — it isn't a page of `Application`
 *  rows like the other two, so it stays out of `SubTab`/`columnsFor`/`loadApplications`. */
type PanelTab = SubTab | 'tracking';

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'apps', label: 'Apps in Process' },
  { id: 'clients', label: 'Clients' },
  { id: 'tracking', label: 'Card Tracking' },
];

const REFRESH_PATH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';

/* ─── Panel ──────────────────────────────────────────────────────────────── */

export function Applications() {
  const [subTab, setSubTab] = useState<SubTab>('apps');
  // Separate from `subTab`: switching to Card Tracking must not touch the Applications-table
  // query state, so flipping back to Apps/Clients shows exactly what was there before, unrefetched.
  const [activeTab, setActiveTab] = useState<PanelTab>('apps');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [openApp, setOpenApp] = useState<Application | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  /** `${app.id}|${field}` while a tick box saves. Row-scoped, so one toggle no longer marks that
   *  column busy on all 200 rows — and untouched rows keep a null busyField, letting AppRow bail. */
  const [pendingToggle, setPendingToggle] = useState<string | null>(null);
  // Optimistic per-row overrides layered over the loaded page (tick-boxes update in place).
  const [overrides, setOverrides] = useState<Record<string, Partial<Application>>>({});
  // Bulk-fetched FedEx tracking numbers, keyed by row id — see the effect below. Kept separate
  // from `overrides` (that one is specifically the tick-box optimistic-update mechanism).
  const [trackingById, setTrackingById] = useState<Record<string, string>>({});
  // Sort + filter (QA feedback 2026-08-10) — client-side over the loaded page; see
  // applicationsFilters.ts for why there's no server-side equivalent. Persists across apps/clients
  // tab switches, same as `search` already does.
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<AppFilters>(emptyFilters);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const pageData = useLoad(
    (fresh) => loadApplications(subTab, query, page, fresh),
    [subTab, query, page],
  );
  const loading = pageData.loading || pageData.refreshing;

  // Clients-tab only — Tracking # is Deal-level data an "apps in process" row has no use for.
  // One bulk call for the whole page rather than one lookup per row (see getCardTrackingBulk /
  // the backend's fetchFedexTrackingBulk for why a per-row call doesn't scale to a 2000-row page).
  useEffect(() => {
    if (subTab !== 'clients') return;
    const clientRows = pageData.data?.rows ?? [];
    const carrierIds = [...new Set(clientRows.map((r) => r.carrierId).filter(Boolean))];
    if (carrierIds.length === 0) return;
    let cancelled = false;
    getCardTrackingBulk(carrierIds)
      .then((byCarrier) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        // Every row that HAD a carrierId resolves to a string now, even '' — a carrier with no
        // matching Deal must render '—', not spin forever waiting for a match that'll never come.
        for (const r of clientRows) next[r.id] = byCarrier[r.carrierId] ?? '';
        setTrackingById(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [subTab, pageData.data]);

  const merged = useMemo(() => {
    const base = pageData.data?.rows ?? [];
    return base.map((a) => {
      const o = overrides[a.id];
      const tracking = trackingById[a.id];
      return {
        ...a,
        ...o,
        ...(tracking !== undefined ? { trackingNumber: tracking } : {}),
      };
    });
  }, [pageData.data, overrides, trackingById]);

  const rows = useMemo(
    () => sortApplications(filterApplications(merged, filters), sortKey, sortDir),
    [merged, filters, sortKey, sortDir],
  );

  // Filter dropdown option lists — distinct values actually present on the loaded page, not a
  // hardcoded picklist (those drift; see ApplicationModal's Stage options for how stale one gets).
  const stageOptions = useMemo(() => distinctValues(merged, (a) => a.stage), [merged]);
  const bizOptions = useMemo(() => distinctValues(merged, (a) => a.biz), [merged]);
  const agentOptions = useMemo(() => distinctValues(merged, (a) => a.agent), [merged]);
  const wexOptions = useMemo(() => distinctValues(merged, (a) => a.wex), [merged]);
  const filterCount = activeFilterCount(filters);

  const hasMore = pageData.data?.moreRecords === true;
  // Memoised: AppRow is memo'd on prop identity, and columnsFor returns a module-level constant
  // per tab, so this only ever changes when the tab does.
  const columns = useMemo(() => columnsFor(subTab), [subTab]);
  const openRow = openApp ? (rows.find((r) => r.id === openApp.id) ?? openApp) : null;

  const notify = useCallback((kind: ToastState['kind'], message: string) => {
    setToast({ id: Date.now(), kind, message });
  }, []);

  // Widget parity: load failures surface as an error toast.
  useEffect(() => {
    if (pageData.error) setToast({ id: Date.now(), kind: 'error', message: `Load failed: ${pageData.error}` });
  }, [pageData.error]);

  const onToggle = useCallback(
    async (app: Application, field: OnboardingField, next: boolean) => {
      const prop = CHECK_PROP[field];
      setPendingToggle(`${app.id}|${field}`);
      setOverrides((o) => ({ ...o, [app.id]: { ...o[app.id], [prop]: next ? 1 : 0 } }));
      try {
        const res = await toggleOnboarding(app.id, field, next);
        invalidateApplicationsCache();
        notify(res.warning ? 'info' : 'success', res.warning ?? `${field.replace(/_/g, ' ')}: ${next ? 'Yes' : 'No'}`);
      } catch (e) {
        setOverrides((o) => ({ ...o, [app.id]: { ...o[app.id], [prop]: next ? 0 : 1 } }));
        notify('error', `Failed to save: ${e instanceof Error ? e.message : e}`);
      } finally {
        setPendingToggle(null);
      }
    },
    [notify],
  );

  function switchTab(id: PanelTab) {
    if (activeTab === id) return;
    if (id === 'tracking') {
      setActiveTab(id);
      return;
    }
    if (loading) return;
    setActiveTab(id);
    setSubTab(id);
    setPage(1);
  }

  function goToPage(n: number) {
    if (n < 1 || loading) return;
    setPage(n);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* Cell-level click: tick boxes toggle in place, ID cells copy, everything else opens the modal.
     useCallback'd (like onOpen below) because every one of the ~5,600 cells receives it — a fresh
     identity each render would defeat AppRow's memo and re-render the whole table. */
  const onCellClick = useCallback(
    (col: AppColumn, app: Application, ev: MouseEvent<HTMLTableCellElement>) => {
      if (col.key === 'check') {
        if (isOnboardingField(col.field)) {
          const on = app[CHECK_PROP[col.field]] === 1;
          void onToggle(app, col.field, !on);
        }
        return;
      }
      const copyText = copyableValue(col, app, subTab);
      if (copyText) {
        copyWithToast(copyText, ev);
        return;
      }
      setOpenApp(app);
    },
    [subTab, onToggle],
  );

  const onOpenRow = useCallback((app: Application) => setOpenApp(app), []);

  return (
    <div className="cs-panel cs-applications-panel">
      {/* ── Header: title left · search + refresh right ── */}
      <div className="cs-header-row">
        <div>
          <h2 className="cs-title">Applications</h2>
          <div className="cs-subtitle">
            {activeTab === 'tracking' ? (
              'FedEx shipment tracking for additional card orders'
            ) : (
              <>
                {rows.length} on page · Page {page}
                {loading ? <span style={{ color: 'var(--cs-accent)', marginLeft: '0.5rem' }}>Loading…</span> : null}
              </>
            )}
          </div>
        </div>
        {activeTab === 'tracking' ? null : (
          <div className="cs-app-header-tools">
            <div className={`cs-app-search${search ? ' has-value' : ''}`}>
              <svg
                className="cs-app-search-icon"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by App ID, Carrier ID, Name or Phone…"
              />
              {search ? (
                <button
                  type="button"
                  className="cs-app-search-clear"
                  aria-label="Clear search"
                  title="Clear search"
                  onClick={() => setSearch('')}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              ) : null}
            </div>
            <div className="cs-app-sort">
              <label className="cs-app-sort-label" htmlFor="cs-app-sort-select">
                Sort
              </label>
              <select
                id="cs-app-sort-select"
                className="cs-form-input"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="cs-app-sort-dir"
                title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              >
                <svg
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  style={{ transform: sortDir === 'desc' ? 'rotate(180deg)' : undefined }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19V5m-6 6l6-6 6 6" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              className={`cs-btn cs-btn-ghost cs-app-filters-toggle${filtersOpen ? ' active' : ''}`}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M7 12h10M10 18h4" />
              </svg>
              Filters
              {filterCount > 0 ? <span className="cs-app-filters-badge">{filterCount}</span> : null}
            </button>
            <button className="cs-refresh-btn" onClick={pageData.refresh} disabled={loading}>
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
        )}
      </div>

      {/* ── Sub-tabs (Apps in Process / Clients / Card Tracking) ── */}
      <div className="cs-app-toolbar">
        <div className="cs-app-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`cs-app-tab${activeTab === tab.id ? ' active' : ''}`}
              disabled={tab.id !== 'tracking' && loading}
              onClick={() => switchTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Filter panel (collapsible) — company/date/stage/business type/agent + WEX status chips ── */}
      {activeTab !== 'tracking' && filtersOpen ? (
        <div className="cs-app-filter-panel">
          <div className="cs-app-filter-row">
            <div className="cs-app-filter-field">
              <label className="cs-app-filter-label">Company Name</label>
              <input
                type="text"
                className="cs-form-input"
                value={filters.company}
                placeholder="Contains…"
                onChange={(e) => setFilters((f) => ({ ...f, company: e.target.value }))}
              />
            </div>
            <div className="cs-app-filter-field">
              <label className="cs-app-filter-label">Date Filled From</label>
              <input
                type="date"
                className="cs-form-input"
                value={filters.dateFrom}
                onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
              />
            </div>
            <div className="cs-app-filter-field">
              <label className="cs-app-filter-label">Date Filled To</label>
              <input
                type="date"
                className="cs-form-input"
                value={filters.dateTo}
                onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
              />
            </div>
            <div className="cs-app-filter-field">
              <label className="cs-app-filter-label">Stage</label>
              <select
                className="cs-form-input"
                value={filters.stage}
                onChange={(e) => setFilters((f) => ({ ...f, stage: e.target.value }))}
              >
                <option value="">All</option>
                {stageOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="cs-app-filter-field">
              <label className="cs-app-filter-label">Business Type</label>
              <select
                className="cs-form-input"
                value={filters.biz}
                onChange={(e) => setFilters((f) => ({ ...f, biz: e.target.value }))}
              >
                <option value="">All</option>
                {bizOptions.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div className="cs-app-filter-field">
              <label className="cs-app-filter-label">Agent (Deal)</label>
              <select
                className="cs-form-input"
                value={filters.agent}
                onChange={(e) => setFilters((f) => ({ ...f, agent: e.target.value }))}
              >
                <option value="">All</option>
                {agentOptions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            {filterCount > 0 ? (
              <button
                type="button"
                className="cs-btn cs-btn-ghost cs-app-filter-clear"
                onClick={() => setFilters(emptyFilters())}
              >
                Clear filters
              </button>
            ) : null}
          </div>
          {wexOptions.length > 0 ? (
            <div className="cs-app-filter-wex-row">
              <span className="cs-app-filter-label">WEX Status</span>
              <div className="cs-app-filter-chips">
                {wexOptions.map((w) => {
                  const active = filters.wex.has(w);
                  return (
                    <button
                      key={w}
                      type="button"
                      className={`cs-chip is-neutral${active ? ' active' : ''}`}
                      aria-pressed={active}
                      onClick={() =>
                        setFilters((f) => {
                          const next = new Set(f.wex);
                          if (next.has(w)) next.delete(w);
                          else next.add(w);
                          return { ...f, wex: next };
                        })
                      }
                    >
                      {w}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === 'tracking' ? (
        <CardTracking />
      ) : loading ? (
        <div className="cs-table-wrap">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="cs-skeleton" style={{ height: 36, borderRadius: 4, marginBottom: 2 }} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        /* ── Empty state (outside scroll container so it stays centered) ── */
        <div className="cs-app-empty">
          <svg
            width="36"
            height="36"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
            No applications found
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Try adjusting your search, filters, or switch tabs
          </div>
        </div>
      ) : (
        /* ── Table ── */
        <div className="cs-table-wrap cs-app-table-wrap">
          <table className="cs-table cs-app-table">
            <thead>
              <tr>
                {columns.map((col, i) => (
                  <th key={i} style={col.thStyle}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((app) => (
                <AppRow
                  key={app.id}
                  app={app}
                  columns={columns}
                  subTab={subTab}
                  busyField={
                    pendingToggle?.startsWith(`${app.id}|`) ? pendingToggle.slice(app.id.length + 1) : null
                  }
                  onCellClick={onCellClick}
                  onOpen={onOpenRow}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {activeTab !== 'tracking' && (page > 1 || hasMore) ? (
        <div className="cs-app-pagination">
          <button className="cs-btn cs-btn-ghost" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>
            ← Prev
          </button>
          <span className="cs-page-indicator">
            Page <strong>{page}</strong>
            {!hasMore ? <span style={{ color: 'var(--text-muted)' }}> · last</span> : null}
          </span>
          <button className="cs-btn cs-btn-ghost" disabled={!hasMore || loading} onClick={() => goToPage(page + 1)}>
            Next →
          </button>
        </div>
      ) : null}

      {/* ── Record modal (view + per-field edit) ── */}
      {openRow ? (
        <ApplicationModal
          app={openRow}
          subTab={subTab}
          onClose={() => setOpenApp(null)}
          onSaved={(warning) => {
            setOpenApp(null);
            notify(warning ? 'info' : 'success', warning ?? 'Saved');
            invalidateApplicationsCache();
            pageData.refresh();
          }}
        />
      ) : null}

      {/* ── Toast ── */}
      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
