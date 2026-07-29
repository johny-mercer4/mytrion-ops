/**
 * Citifuel Clients panel — 1:1 port of the widget's citi-fuel-panel.js template
 * (cs-panel / cs-citi-summary / cs-citi-toolbar / cs-table cs-citi-table-wrap / sortable
 * headers / cs-app-pagination / cs-toast) over the DONE live-data layer: debounced server
 * search, live status-filter tabs + per-status stats, single view+edit modal, inline delete.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { CitiModal } from './CitiModal';
import { Toast, type ToastState } from './Toast';
import { fmtDate, localYmd, rangeDays } from './live';
import {
  loadCiti,
  loadCitiDecisionSplit,
  loadCitiStats,
  useLoad,
  type CitiDecisionSplit,
  type CitiRow,
} from './live';

const SEARCH_DEBOUNCE_MS = 400;

const REFRESH_PATH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';
const TRASH_PATH =
  'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16';
const CHART_PATH = 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z';

/** First of the current month, local — the report's default `from`. */
function monthStartYmd(): string {
  const d = new Date();
  return localYmd(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** One-click report windows. All end today except the two whole-month ones. */
const REPORT_PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  { label: 'This month', range: () => ({ from: monthStartYmd(), to: localYmd(new Date()) }) },
  {
    label: 'Last month',
    range: () => {
      const d = new Date();
      return {
        from: localYmd(new Date(d.getFullYear(), d.getMonth() - 1, 1)),
        to: localYmd(new Date(d.getFullYear(), d.getMonth(), 0)),
      };
    },
  },
  {
    label: '90 days',
    range: () => {
      const d = new Date();
      d.setDate(d.getDate() - 89);
      return { from: localYmd(d), to: localYmd(new Date()) };
    },
  },
  {
    label: 'Year to date',
    range: () => ({ from: `${new Date().getFullYear()}-01-01`, to: localYmd(new Date()) }),
  },
];

/** Widget CITI_BADGE_COLORS — picklist value → cs-badge-* class. */
const BADGE_CLASS: Record<string, string> = {
  'In process': 'cs-badge-warning',
  'Cards sent': 'cs-badge-info',
  Closed: 'cs-badge-muted',
  Active: 'cs-badge-success',
  'Using company card': 'cs-badge-purple',
  Refilled: 'cs-badge-orange',
  Outbound: 'cs-badge-orange',
  Incoming: 'cs-badge-info',
  'Agent Call': 'cs-badge-purple',
  'Request Citi to check': 'cs-badge-warning',
  Octane: 'cs-badge-success',
  Citifuel: 'cs-badge-info',
  None: 'cs-badge-muted',
  'Octane card': 'cs-badge-success',
  'Citi card': 'cs-badge-info',
  Debtor: 'cs-badge-danger',
  'Payment Issues': 'cs-badge-warning',
  Collection: 'cs-badge-orange',
  'Good Standing': 'cs-badge-success',
};
const citiBadge = (v: string): string => BADGE_CLASS[v] ?? 'cs-badge-muted';

type ColKey = 'name' | 'appId' | 'status' | 'request' | 'decision' | 'date' | 'phone' | 'email';
interface Col {
  key: ColKey;
  label: string;
  badge?: boolean;
  date?: boolean;
}
const COLS: Col[] = [
  { key: 'name', label: 'Client Name' },
  { key: 'appId', label: 'App ID' },
  { key: 'status', label: 'Status', badge: true },
  { key: 'request', label: 'Request', badge: true },
  { key: 'decision', label: 'Final Decision', badge: true },
  { key: 'date', label: 'Date', date: true },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
];

function cellValue(row: CitiRow, col: Col): string {
  const v = row[col.key];
  if (col.date) return fmtDate(v) || '—';
  return v ? String(v) : '—';
}

/**
 * One table row, memoised — same reasoning as Applications' AppRow. Search state lives in the
 * panel, so without this every keystroke re-rendered all ~450 cells AND rebuilt three inline style
 * objects per row for React to diff. The per-cell styles are plain classes now (see
 * citi-fuel-panel.css), so a row renders no throwaway objects at all.
 *
 * COLS is a module constant and `onOpen` is useCallback'd in the panel, so an untouched row bails.
 */
const CitiTableRow = memo(function CitiTableRow({
  row,
  onOpen,
}: {
  row: CitiRow;
  onOpen: (row: CitiRow) => void;
}) {
  return (
    <tr tabIndex={0} onClick={() => onOpen(row)} onKeyDown={(e) => e.key === 'Enter' && onOpen(row)}>
      {COLS.map((col) => (
        <td key={col.key}>
          {col.badge ? (
            row[col.key] ? (
              <span className={`cs-badge ${citiBadge(String(row[col.key]))}`}>{String(row[col.key])}</span>
            ) : (
              <span className="cs-badge cs-badge-muted">—</span>
            )
          ) : col.date ? (
            <span className="cs-citi-cell-date">{cellValue(row, col)}</span>
          ) : col.key === 'name' ? (
            /* Company above, contact beneath — QA feedback: a row was hard to identify from a
               contact name alone. Unlinked records still just show the contact. */
            <div className="cs-citi-cell-client">
              {row.company ? <div className="cs-citi-cell-company">{row.company}</div> : null}
              <div className={row.company ? 'cs-citi-cell-contact' : 'cs-citi-cell-name'}>
                {row.name || '—'}
              </div>
            </div>
          ) : (
            <span className="cs-citi-cell-text">{cellValue(row, col)}</span>
          )}
        </td>
      ))}
      <td onClick={(e) => e.stopPropagation()}>
        <button
          className="cs-citi-action-btn cs-citi-delete-btn"
          title="Delete record"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(row);
          }}
        >
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={TRASH_PATH} />
          </svg>
        </button>
      </td>
    </tr>
  );
});

/** Widget summary-card accent per status label. */
const STAT_COLOR: Record<string, string> = {
  Total: 'var(--cs-accent)',
  'In process': 'var(--cs-warning)',
  'Cards sent': 'var(--cs-accent)',
  Closed: 'var(--text-muted)',
  Active: 'var(--cs-success)',
  'Using company card': 'var(--cs-purple)',
  Refilled: 'var(--cs-orange)',
};

export function CitiFuel() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<ColKey | ''>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [modalClient, setModalClient] = useState<CitiRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  // Citi-vs-Octane report. On demand rather than on load — it is a question an agent asks, not a
  // number the page needs, and each run is its own COQL aggregate.
  const [reportOpen, setReportOpen] = useState(false);
  const [reportFrom, setReportFrom] = useState(() => monthStartYmd());
  const [reportTo, setReportTo] = useState(() => localYmd(new Date()));
  const [report, setReport] = useState<CitiDecisionSplit | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState('');

  const today = localYmd(new Date());
  const reportDays = rangeDays(reportFrom, reportTo);

  const runReport = async (): Promise<void> => {
    setReportBusy(true);
    setReportError('');
    try {
      setReport(await loadCitiDecisionSplit(reportFrom, reportTo));
    } catch (e) {
      setReport(null);
      setReportError(e instanceof Error ? e.message : 'Report failed');
    } finally {
      setReportBusy(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const list = useLoad(() => loadCiti(status || 'all', query, page), [status, query, page]);
  const stats = useLoad(loadCitiStats, []);
  const loading = list.loading;

  const byStatus = stats.data?.byStatus ?? {};
  const statusOptions = Object.keys(byStatus);

  const rows = list.data?.rows ?? [];
  const sortedRows = useMemo(() => {
    if (!sortField) return rows;
    const dir = sortDir === 'asc' ? 1 : -1;
    // The Client Name cell now leads with the company, so sort on what the eye reads first and fall
    // back to the contact for unlinked records — otherwise the column sorts by an invisible key.
    const keyOf = (r: CitiRow): string =>
      (sortField === 'name' ? r.company || r.name : String(r[sortField] ?? '')).toLowerCase();
    return [...rows].sort((a, b) => {
      const av = keyOf(a);
      const bv = keyOf(b);
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [rows, sortField, sortDir]);

  const hasMore = list.data?.moreRecords === true;

  const summaryStats = [
    { label: 'Total', value: stats.data ? stats.data.total : '…' },
    ...statusOptions.map((s) => ({ label: s, value: byStatus[s] ?? 0 })),
  ];

  function notify(kind: ToastState['kind'], message: string) {
    setToast({ id: Date.now(), kind, message });
  }
  function refreshAll() {
    list.reload();
    stats.reload();
  }
  function toggleSort(field: ColKey) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDir('asc');
    }
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
  // useCallback'd: every row receives it, and a fresh identity would defeat CitiTableRow's memo.
  const openClient = useCallback((row: CitiRow) => {
    setCreating(false);
    setModalClient(row);
    setModalOpen(true);
  }, []);
  function openCreate() {
    setCreating(true);
    setModalClient(null);
    setModalOpen(true);
  }

  useEffect(() => {
    if (list.error) setToast({ id: Date.now(), kind: 'error', message: `Load failed: ${list.error}` });
  }, [list.error]);

  return (
    <div className="cs-panel cs-citi-fuel-panel">
      {/* ── Header ── */}
      <div className="cs-header-row">
        <div>
          <h2 className="cs-title">Citifuel Clients</h2>
          <div className="cs-subtitle">
            {rows.length} record{rows.length !== 1 ? 's' : ''} loaded · Page {page}
            {loading ? <span style={{ color: 'var(--cs-accent)', marginLeft: '0.5rem' }}>Loading…</span> : null}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            className={`cs-refresh-btn${reportOpen ? ' cs-citi-report-btn-on' : ''}`}
            onClick={() => setReportOpen((o) => !o)}
            aria-expanded={reportOpen}
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={CHART_PATH} />
            </svg>
            Citi vs Octane
          </button>
          <button className="cs-refresh-btn cs-citi-add-btn" onClick={openCreate} disabled={loading}>
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            Add Client
          </button>
          <button className="cs-refresh-btn" onClick={refreshAll} disabled={loading}>
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" className={loading ? 'spin-icon' : undefined}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={REFRESH_PATH} />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ── Citi-vs-Octane report over a custom window (QA feedback 2026-07-28) ──
           Reuses the Analytics custom-range rail's classes (.cs-an-rc*) — same control, same
           module, so it should not look like a second design. */}
      {reportOpen ? (
        <div className="cs-an-rc cs-citi-report" role="group" aria-label="Citi vs Octane report">
          <div className="cs-an-rc-head">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={CHART_PATH} />
            </svg>
            Citi vs Octane
            {reportDays !== null && reportDays > 0 ? (
              <span className="cs-an-rc-count">
                {reportDays.toLocaleString()} {reportDays === 1 ? 'day' : 'days'}
              </span>
            ) : null}
          </div>

          <div className="cs-an-rc-fields">
            <label className="cs-an-rc-field">
              <span>From</span>
              <input
                type="date"
                value={reportFrom}
                max={reportTo || today}
                onChange={(e) => setReportFrom(e.target.value)}
              />
            </label>
            <span className="cs-an-rc-arrow" aria-hidden="true">
              →
            </span>
            <label className="cs-an-rc-field">
              <span>To</span>
              <input
                type="date"
                value={reportTo}
                min={reportFrom}
                max={today}
                onChange={(e) => setReportTo(e.target.value)}
              />
            </label>
          </div>

          <div className="cs-an-rc-presets">
            {REPORT_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="cs-an-rc-preset"
                onClick={() => {
                  const r = p.range();
                  setReportFrom(r.from);
                  setReportTo(r.to);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="cs-an-rc-foot">
            {reportError ? (
              <span className="cs-an-rc-err">{reportError}</span>
            ) : report ? (
              <span className="cs-an-rc-hint">
                {report.total.toLocaleString()} request{report.total === 1 ? '' : 's'} dated in this
                window{report.undecided > 0 ? ` · ${report.undecided.toLocaleString()} undecided` : ''}
              </span>
            ) : (
              <span className="cs-an-rc-hint">Counted on Date of Request. Both dates included.</span>
            )}
            <div className="cs-an-rc-actions">
              <button type="button" className="cs-an-rc-cancel" onClick={() => setReportOpen(false)}>
                Close
              </button>
              <button
                type="button"
                className="cs-an-rc-apply"
                onClick={() => void runReport()}
                disabled={reportBusy || !reportFrom || !reportTo || reportFrom > reportTo}
              >
                {reportBusy ? 'Running…' : 'Run report'}
              </button>
            </div>
          </div>

          {report ? (
            <div className="cs-citi-report-out">
              {[
                { label: 'Sent to Citi', value: report.citifuel, cls: 'is-citi' },
                { label: 'Stayed with Octane', value: report.octane, cls: 'is-octane' },
                { label: 'Undecided', value: report.undecided, cls: 'is-none' },
              ].map((t) => {
                const pct = report.total > 0 ? Math.round((t.value / report.total) * 100) : 0;
                return (
                  <div key={t.label} className={`cs-citi-report-tile ${t.cls}`}>
                    <div className="cs-citi-report-value">{t.value.toLocaleString()}</div>
                    <div className="cs-citi-report-label">{t.label}</div>
                    <div className="cs-citi-report-bar">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <div className="cs-citi-report-pct">{pct}% of {report.total.toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Summary stats ── */}
      <div className="cs-citi-summary">
        {summaryStats.map((s) => (
          <div className="cs-citi-stat-card" key={s.label}>
            <div className="cs-citi-stat-value" style={{ color: STAT_COLOR[s.label] ?? 'var(--cs-accent)' }}>
              {s.value}
            </div>
            <div className="cs-citi-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Toolbar ── */}
      <div className="cs-citi-toolbar">
        <div className="cs-citi-search-bar">
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, phone, app ID…" />
        </div>
        {statusOptions.length ? (
          <div className="cs-app-tabs">
            <button className={`cs-app-tab${status === '' ? ' active' : ''}`} onClick={() => switchStatus('')} disabled={loading}>
              All
            </button>
            {statusOptions.map((opt) => (
              <button
                key={opt}
                className={`cs-app-tab${status === opt ? ' active' : ''}`}
                onClick={() => switchStatus(opt)}
                disabled={loading}
              >
                {opt}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── Table / skeleton ── */}
      {loading && rows.length === 0 ? (
        <div className="cs-skeleton" style={{ height: 220, borderRadius: 4 }} />
      ) : (
        <div className="cs-table-wrap cs-citi-table-wrap">
          <table className="cs-table">
            <thead>
              <tr>
                {COLS.map((col) => (
                  <th key={col.key} className="cs-citi-th-sortable" onClick={() => toggleSort(col.key)}>
                    {col.label}
                    {sortField === col.key ? (
                      <span className="cs-sort-indicator">{sortDir === 'asc' ? '↑' : '↓'}</span>
                    ) : null}
                  </th>
                ))}
                <th style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <CitiTableRow key={row.id} row={row} onOpen={openClient} />
              ))}
              {!loading && sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length + 1} className="cs-empty">
                    No records found
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {page > 1 || hasMore ? (
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

      {/* ── View / Edit / Create modal ── */}
      {modalOpen ? (
        <CitiModal
          client={creating ? null : modalClient}
          notify={notify}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            notify('success', creating ? 'Client created' : 'Client updated');
            refreshAll();
          }}
          onDeleted={() => {
            setModalOpen(false);
            refreshAll();
          }}
        />
      ) : null}

      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
