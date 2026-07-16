/**
 * Applications panel — 1:1 port of the widget's applications-panel.js template
 * (cs-panel / cs-header-row / cs-app-tabs / cs-app-table / cs-app-pagination / modal /
 * toast) over the DONE live-data layer: debounced server search, page state, optimistic
 * per-row onboarding toggles with revert-on-error, reload-after-save.
 */
import { useEffect, useMemo, useState, type MouseEvent } from 'react';

import { toggleOnboarding, type OnboardingField } from '@/api/cs';
import { ApplicationModal } from './ApplicationModal';
import {
  AppCell,
  CHECK_PROP,
  columnsFor,
  isOnboardingField,
  type AppColumn,
  type SubTab,
} from './ApplicationsTable';
import { Toast, type ToastState } from './Toast';
import type { Application } from './data';
import { loadApplications, useLoad } from './live';

/** Widget parity: search fires debounced (App ID / Carrier ID / name / phone, server-side). */
const SEARCH_DEBOUNCE_MS = 400;

const TABS: { id: SubTab; label: string }[] = [
  { id: 'apps', label: 'Apps in Process' },
  { id: 'clients', label: 'Clients' },
];

const REFRESH_PATH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';

/* ─── Copy-to-clipboard with the widget's floating cs-copy-toast ─────────── */

function showCopyToast(msg: string, ok: boolean, ev: MouseEvent | null) {
  const x = ev ? ev.clientX : window.innerWidth / 2;
  const y = ev ? ev.clientY : window.innerHeight / 2;
  const t = document.createElement('div');
  t.className = `cs-copy-toast${ok ? '' : ' cs-copy-toast-err'}`;
  t.textContent = msg;
  t.style.left = `${x}px`;
  t.style.top = `${y - 14}px`;
  document.body.appendChild(t);
  // trigger CSS transition
  requestAnimationFrame(() => t.classList.add('cs-copy-toast-show'));
  setTimeout(() => {
    t.classList.remove('cs-copy-toast-show');
    setTimeout(() => t.parentNode && t.parentNode.removeChild(t), 250);
  }, 900);
}

function fallbackCopy(text: string, ev: MouseEvent | null) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showCopyToast(`✓ Copied ${text}`, true, ev);
  } catch {
    showCopyToast('Copy failed', false, ev);
  }
}

function copyId(text: string, ev: MouseEvent) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showCopyToast(`✓ Copied ${text}`, true, ev),
        () => fallbackCopy(text, ev),
      );
    } else {
      fallbackCopy(text, ev);
    }
  } catch {
    fallbackCopy(text, ev);
  }
}

/* ─── Panel ──────────────────────────────────────────────────────────────── */

export function Applications() {
  const [subTab, setSubTab] = useState<SubTab>('apps');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [openApp, setOpenApp] = useState<Application | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pendingToggle, setPendingToggle] = useState<string | null>(null);
  // Optimistic per-row overrides layered over the loaded page (tick-boxes update in place).
  const [overrides, setOverrides] = useState<Record<string, Partial<Application>>>({});

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const pageData = useLoad(() => loadApplications(subTab, query, page), [subTab, query, page]);
  const loading = pageData.loading;

  const rows = useMemo(() => {
    const base = pageData.data?.rows ?? [];
    return base.map((a) => {
      const o = overrides[a.id];
      return o ? { ...a, ...o } : a;
    });
  }, [pageData.data, overrides]);

  const hasMore = pageData.data?.moreRecords === true;
  const columns = columnsFor(subTab);
  const openRow = openApp ? (rows.find((r) => r.id === openApp.id) ?? openApp) : null;

  function notify(kind: ToastState['kind'], message: string) {
    setToast({ id: Date.now(), kind, message });
  }

  // Widget parity: load failures surface as an error toast.
  useEffect(() => {
    if (pageData.error) setToast({ id: Date.now(), kind: 'error', message: `Load failed: ${pageData.error}` });
  }, [pageData.error]);

  async function onToggle(app: Application, field: OnboardingField, next: boolean) {
    const prop = CHECK_PROP[field];
    setPendingToggle(field);
    setOverrides((o) => ({ ...o, [app.id]: { ...o[app.id], [prop]: next ? 1 : 0 } }));
    try {
      const res = await toggleOnboarding(app.id, field, next);
      notify(res.warning ? 'info' : 'success', res.warning ?? `${field.replace(/_/g, ' ')}: ${next ? 'Yes' : 'No'}`);
    } catch (e) {
      setOverrides((o) => ({ ...o, [app.id]: { ...o[app.id], [prop]: next ? 0 : 1 } }));
      notify('error', `Failed to save: ${e instanceof Error ? e.message : e}`);
    } finally {
      setPendingToggle(null);
    }
  }

  function switchTab(id: SubTab) {
    if (loading || subTab === id) return;
    setSubTab(id);
    setPage(1);
  }

  function goToPage(n: number) {
    if (n < 1 || loading) return;
    setPage(n);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* Cell-level click: tick boxes toggle in place, ID cells copy, everything else opens the modal. */
  function onCellClick(col: AppColumn, app: Application, ev: MouseEvent<HTMLTableCellElement>) {
    if (col.key === 'check') {
      if (isOnboardingField(col.field)) {
        const on = app[CHECK_PROP[col.field]] === 1;
        void onToggle(app, col.field, !on);
      }
      return;
    }
    if (col.key === 'app_id' || (col.key === 'id' && subTab !== 'clients')) {
      if (app.appId) {
        copyId(app.appId, ev);
        return;
      }
    }
    if (col.key === 'id' && subTab === 'clients') {
      if (app.carrierId) {
        copyId(app.carrierId, ev);
        return;
      }
    }
    setOpenApp(app);
  }

  return (
    <div className="cs-panel cs-applications-panel">
      {/* ── Header: title left · search + refresh right ── */}
      <div className="cs-header-row">
        <div>
          <h2 className="cs-title">Applications</h2>
          <div className="cs-subtitle">
            {rows.length} on page · Page {page}
            {loading ? <span style={{ color: 'var(--cs-accent)', marginLeft: '0.5rem' }}>Loading…</span> : null}
          </div>
        </div>
        <div className="cs-app-header-tools">
          <div className="cs-app-search">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by App ID, Carrier ID, Name or Phone…"
            />
          </div>
          <button className="cs-refresh-btn" onClick={pageData.reload} disabled={loading}>
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

      {/* ── Sub-tabs (Apps in Process / Clients) ── */}
      <div className="cs-app-toolbar">
        <div className="cs-app-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`cs-app-tab${subTab === tab.id ? ' active' : ''}`}
              disabled={loading}
              onClick={() => switchTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Skeleton ── */}
      {loading ? (
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
            Try adjusting your search or switch tabs
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
                <tr
                  key={app.id}
                  className="cs-app-row"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setOpenApp(app);
                    }
                  }}
                >
                  {columns.map((col, i) => (
                    <td
                      key={i}
                      className={col.key === 'id' || col.key === 'app_id' ? 'cs-app-cell-copyable' : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCellClick(col, app, e);
                      }}
                    >
                      <AppCell col={col} app={app} subTab={subTab} pendingToggle={pendingToggle} />
                    </td>
                  ))}
                </tr>
              ))}
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

      {/* ── Record modal (view + per-field edit) ── */}
      {openRow ? (
        <ApplicationModal
          app={openRow}
          subTab={subTab}
          onClose={() => setOpenApp(null)}
          onSaved={(warning) => {
            setOpenApp(null);
            notify(warning ? 'info' : 'success', warning ?? 'Saved');
            pageData.reload();
          }}
        />
      ) : null}

      {/* ── Toast ── */}
      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
