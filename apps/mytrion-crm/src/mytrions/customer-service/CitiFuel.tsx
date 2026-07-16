/**
 * Citifuel Clients panel — 1:1 port of the widget's citi-fuel-panel.js template
 * (cs-panel / cs-citi-summary / cs-citi-toolbar / cs-table cs-citi-table-wrap / sortable
 * headers / cs-app-pagination / cs-toast) over the DONE live-data layer: debounced server
 * search, live status-filter tabs + per-status stats, single view+edit modal, inline delete.
 */
import { useEffect, useMemo, useState } from 'react';

import { CitiModal } from './CitiModal';
import { Toast, type ToastState } from './Toast';
import { fmtDate } from './live';
import { loadCiti, loadCitiStats, useLoad, type CitiRow } from './live';

const SEARCH_DEBOUNCE_MS = 400;

const REFRESH_PATH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';
const TRASH_PATH =
  'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16';

/** Widget CITI_BADGE_COLORS — picklist value → cs-badge-* class. */
const BADGE_CLASS: Record<string, string> = {
  'In process': 'cs-badge-warning',
  'Cards sent': 'cs-badge-info',
  Closed: 'cs-badge-success',
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

/** Widget summary-card accent per status label. */
const STAT_COLOR: Record<string, string> = {
  Total: 'var(--cs-accent)',
  'In process': 'var(--cs-warning)',
  'Cards sent': 'var(--cs-accent)',
  Closed: 'var(--cs-success)',
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
    return [...rows].sort((a, b) => {
      const av = String(a[sortField] ?? '').toLowerCase();
      const bv = String(b[sortField] ?? '').toLowerCase();
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
  function openClient(row: CitiRow) {
    setCreating(false);
    setModalClient(row);
    setModalOpen(true);
  }
  function openCreate() {
    setCreating(true);
    setModalClient(null);
    setModalOpen(true);
  }

  useEffect(() => {
    if (list.error) setToast({ id: Date.now(), kind: 'error', message: `Load failed: ${list.error}` });
  }, [list.error]);

  function cellValue(row: CitiRow, col: Col): string {
    const v = row[col.key];
    if (col.date) return fmtDate(v) || '—';
    return v ? String(v) : '—';
  }

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
                <tr key={row.id} tabIndex={0} onClick={() => openClient(row)} onKeyDown={(e) => e.key === 'Enter' && openClient(row)}>
                  {COLS.map((col) => (
                    <td key={col.key}>
                      {col.badge ? (
                        row[col.key] ? (
                          <span className={`cs-badge ${citiBadge(String(row[col.key]))}`}>{String(row[col.key])}</span>
                        ) : (
                          <span className="cs-badge cs-badge-muted">—</span>
                        )
                      ) : col.date ? (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{cellValue(row, col)}</span>
                      ) : col.key === 'name' ? (
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{row.name || '—'}</div>
                      ) : (
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{cellValue(row, col)}</span>
                      )}
                    </td>
                  ))}
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      className="cs-citi-action-btn cs-citi-delete-btn"
                      title="Delete record"
                      onClick={(e) => {
                        e.stopPropagation();
                        openClient(row);
                      }}
                    >
                      <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={TRASH_PATH} />
                      </svg>
                    </button>
                  </td>
                </tr>
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
