/**
 * Returns & Chargebacks panel — 1:1 port of the widget returns-panel.js template (bm-returns-panel /
 * rt-toolbar segmented filters + search / clickable db-kpi-grid queue cards / db-list-header +
 * expandable rt-row detail / db-pagination) over the LIVE billing.returns.* touchpoints.
 *
 * The list is fetched through the shared `useLoad` hook (a bounded page loop, mirroring the widget's
 * 25×200 paging), then filtered/paginated entirely client-side — the widget's computed()/watch()
 * logic. The manual-match WRITE is wired through ReturnMatchModal; a successful match patches the
 * row in place (status pill flips from Unmatched to the CMP outcome) with no refetch.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { fetchReturns } from '@/api/billing';
import { useLoad } from '../_shared/useLoad';
import { readBool } from './transactionModel';
import { ReturnMatchModal } from './ReturnMatchModal';
import {
  type ReturnRow,
  cmpCategory,
  fmtCurrency,
  formatDay,
  mapReturn,
  rowStatus,
  typeBadgeClass,
  typeLabel,
} from './returnsModel';

const ITEMS_PER_PAGE = 50;
const PAGE_SIZE = 200;
const MAX_PAGES = 25;
const TOAST_MS = 3500;

// Icon paths (verbatim from the widget template).
const SEARCH_PATH = 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z';
const CLOSE_PATH = 'M6 18L18 6M6 6l12 12';
const REFRESH_PATH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';
const ERROR_PATH = 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';
const CHEVRON_ROW = 'M9 5l7 7-7 7';
const CHEVRON_LEFT = 'M15 19l-7-7 7-7';
const CHEVRON_RIGHT = 'M9 5l7 7-7 7';
const LINK_PATH =
  'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1';

type ToastKind = 'success' | 'error';
type CmpFilter = 'all' | 'action' | 'unmatched' | 'pending' | 'reversed' | 'none';

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All Types' },
  { value: 'ACH', label: 'ACH' },
  { value: 'Wire', label: 'Wire' },
  { value: 'Card-Chargeback', label: 'Chargeback' },
];

const CMP_FILTERS: { value: CmpFilter; label: string; hint: string }[] = [
  { value: 'all', label: 'All', hint: 'Everything in the module' },
  { value: 'action', label: 'Needs Action', hint: 'Unmatched returns + CMP reversals that need a human' },
  { value: 'unmatched', label: 'Unmatched', hint: 'Original transaction not found yet — match it manually' },
  { value: 'pending', label: 'Pending', hint: 'CMP reversal queued — the hourly auto-retry is resolving it' },
  { value: 'reversed', label: 'Reversed', hint: 'Money already pulled back out of CMP' },
  { value: 'none', label: 'No Action', hint: 'Matched, but the payment never reached CMP — nothing to reverse' },
];

/** Bounded page loop over billing.returns.list (mirrors the widget's 25×200 paging). */
async function fetchAllReturns(): Promise<ReturnRow[]> {
  const all: ReturnRow[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore && page <= MAX_PAGES) {
    const data = await fetchReturns(page, PAGE_SIZE);
    const recs = data.returns ?? data.records ?? [];
    for (const r of recs) all.push(mapReturn(r));
    hasMore = readBool(data.hasMore) || readBool(data.has_more);
    page += 1;
  }
  return all;
}

export function Returns() {
  const load = useLoad(fetchAllReturns, []);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [cmpFilter, setCmpFilter] = useState<CmpFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [matchRet, setMatchRet] = useState<ReturnRow | null>(null);
  const [patches, setPatches] = useState<Record<string, Partial<ReturnRow>>>({});
  const [toast, setToast] = useState<{ id: number; kind: ToastKind; message: string } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // A fresh page-1 payload (initial load or reload) drops any in-memory row patches.
  useEffect(() => {
    setPatches({});
  }, [load.data]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  function notify(kind: ToastKind, message: string): void {
    setToast({ id: Date.now(), kind, message });
  }

  const returns = useMemo<ReturnRow[]>(() => {
    const base = load.data ?? [];
    return base.map((r) => {
      const p = patches[r.recordId];
      return p ? { ...r, ...p } : r;
    });
  }, [load.data, patches]);

  // Type + search narrowing, before the CMP-outcome split.
  const baseFiltered = useMemo<ReturnRow[]>(() => {
    let result = returns;
    if (filterType !== 'all') result = result.filter((r) => r.returnType === filterType);
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (r) =>
          r.referenceNumber.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q) ||
          r.returnReason.toLowerCase().includes(q),
      );
    }
    return result;
  }, [returns, filterType, searchQuery]);

  const filteredReturns = useMemo<ReturnRow[]>(() => {
    if (cmpFilter === 'all') return baseFiltered;
    // "Unmatched" is a subset of Needs Action — its own filter so the manual-match queue is one click.
    if (cmpFilter === 'unmatched') return baseFiltered.filter((r) => !r.matched);
    return baseFiltered.filter((r) => cmpCategory(r) === cmpFilter);
  }, [baseFiltered, cmpFilter]);

  // Counts for the segmented filter — scoped to type+search so the numbers add up to the view.
  const cmpCounts = useMemo(() => {
    const c: Record<CmpFilter, number> = { all: baseFiltered.length, action: 0, unmatched: 0, pending: 0, reversed: 0, none: 0 };
    for (const r of baseFiltered) {
      c[cmpCategory(r)] += 1;
      if (!r.matched) c.unmatched += 1;
    }
    return c;
  }, [baseFiltered]);

  const kpi = useMemo(() => {
    const list = baseFiltered;
    const reversedList = list.filter((r) => cmpCategory(r) === 'reversed');
    return {
      totalCount: list.length,
      totalAmount: list.reduce((s, r) => s + r.amount, 0),
      unmatched: list.filter((r) => !r.matched).length,
      reconcile: list.filter((r) => r.matched && cmpCategory(r) === 'action').length,
      action: list.filter((r) => cmpCategory(r) === 'action').length,
      pending: list.filter((r) => cmpCategory(r) === 'pending').length,
      reversed: reversedList.length,
      reversedAmount: reversedList.reduce((s, r) => s + r.amount, 0),
    };
  }, [baseFiltered]);

  const totalPages = Math.max(1, Math.ceil(filteredReturns.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(pageNum, totalPages);
  const paginated = filteredReturns.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Reset to page 1 whenever a filter/search changes (the widget's watchers).
  useEffect(() => {
    setPageNum(1);
  }, [filterType, cmpFilter, searchQuery]);

  function scrollTop(): void {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }
  function prevPage(): void {
    if (currentPage > 1) {
      setPageNum(currentPage - 1);
      scrollTop();
    }
  }
  function nextPage(): void {
    if (currentPage < totalPages) {
      setPageNum(currentPage + 1);
      scrollTop();
    }
  }

  function toggleExpand(id: string): void {
    setExpandedId((cur) => (cur === id ? null : id));
  }

  function applyMatch(returnRecordId: string, patch: Partial<ReturnRow>): void {
    setPatches((prev) => ({ ...prev, [returnRecordId]: { ...prev[returnRecordId], ...patch } }));
  }

  const initialLoading = load.loading && returns.length === 0;

  return (
    <div className="bm-panel bm-returns-panel">
      {/* ── Header ── */}
      <div className="bm-header-row">
        <div>
          <h2 className="bm-title">Returns &amp; Chargebacks</h2>
          <div className="bm-subtitle">
            ACH/Wire returns and card chargebacks — matched returns auto-reverse the original transaction; unmatched
            ones can be matched manually
          </div>
        </div>
      </div>

      {/* ── Toolbar: type + CMP-outcome segmented filters, search, refresh ── */}
      <div className="rt-toolbar">
        <div className="rt-seg">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t.value}
              className={filterType === t.value ? 'rt-seg-active' : undefined}
              onClick={() => setFilterType(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="rt-seg">
          {CMP_FILTERS.map((f) => (
            <button
              key={f.value}
              className={cmpFilter === f.value ? 'rt-seg-active' : undefined}
              title={f.hint}
              onClick={() => setCmpFilter(f.value)}
            >
              {f.label}
              <span className="rt-seg-count">{cmpCounts[f.value]}</span>
            </button>
          ))}
        </div>

        <div className="db-search-wrap">
          <svg className="db-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={SEARCH_PATH} />
          </svg>
          <input
            type="text"
            className="db-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search returns..."
          />
          {searchQuery ? (
            <button className="db-search-clear" onClick={() => setSearchQuery('')}>
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={CLOSE_PATH} />
              </svg>
            </button>
          ) : null}
        </div>

        <button className="bm-refresh-btn" onClick={load.refresh} disabled={load.loading || load.refreshing}>
          <svg className={load.loading || load.refreshing ? 'spin-icon' : undefined} width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={REFRESH_PATH} />
          </svg>
          Refresh
        </button>
      </div>

      {/* ── KPI queue cards — click to filter the list ── */}
      <div className="db-kpi-grid">
        <div
          className={`db-kpi-card rt-kpi${cmpFilter === 'all' ? ' rt-kpi-active' : ''}`}
          onClick={() => setCmpFilter('all')}
        >
          <div className="db-kpi-title">
            Total Returned <span className="db-kpi-badge">{kpi.totalCount} returns</span>
          </div>
          <div className="db-kpi-value text-danger">{fmtCurrency(kpi.totalAmount)}</div>
          <div className="rt-kpi-sub">everything in the module</div>
        </div>

        <div
          className={`db-kpi-card db-danger-card rt-kpi${cmpFilter === 'action' ? ' rt-kpi-active' : ''}`}
          onClick={() => setCmpFilter('action')}
        >
          <div className="db-kpi-title">Needs Action</div>
          <div className="db-kpi-value text-danger">{kpi.action}</div>
          <div className="rt-kpi-sub">
            {kpi.unmatched} unmatched · {kpi.reconcile} reconcile CMP
          </div>
        </div>

        <div
          className={`db-kpi-card rt-kpi${cmpFilter === 'pending' ? ' rt-kpi-active' : ''}`}
          onClick={() => setCmpFilter('pending')}
        >
          <div className="db-kpi-title">CMP Pending</div>
          <div className="db-kpi-value text-warning">{kpi.pending}</div>
          <div className="rt-kpi-sub">auto-retry resolves these hourly</div>
        </div>

        <div
          className={`db-kpi-card rt-kpi${cmpFilter === 'reversed' ? ' rt-kpi-active' : ''}`}
          onClick={() => setCmpFilter('reversed')}
        >
          <div className="db-kpi-title">Recovered</div>
          <div className="db-kpi-value" style={{ color: 'var(--success-text)' }}>
            {fmtCurrency(kpi.reversedAmount)}
          </div>
          <div className="rt-kpi-sub">{kpi.reversed} reversed in CMP automatically</div>
        </div>
      </div>

      {/* ── Loading / Error / Data ── */}
      {initialLoading ? (
        <div className="bm-initial-loader">
          <div className="bm-loader-ring" />
          <div>
            <div className="bm-loader-text">Loading Returns</div>
            <div className="bm-loader-sub">Fetching returns &amp; chargebacks...</div>
          </div>
        </div>
      ) : load.error ? (
        <div className="db-error-state">
          <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={ERROR_PATH} />
          </svg>
          <div className="db-error-msg">{load.error}</div>
          <button className="bm-refresh-btn" onClick={load.refresh} style={{ width: 'fit-content', marginTop: '0.5rem' }}>
            Try Again
          </button>
        </div>
      ) : (
        <div className="db-content-area" ref={contentRef}>
          {/* List Header */}
          <div className="db-list-header">
            <div className="db-col-cycle">Date</div>
            <div className="db-col-status">Type</div>
            <div className="db-col-company">Customer / Reference</div>
            <div className="db-col-company">Reason</div>
            <div className="db-col-status">Status</div>
            <div className="db-col-owed">Amount</div>
            <div className="rt-col-action">Action</div>
          </div>

          {paginated.length > 0 ? (
            <>
              {paginated.map((ret) => {
                const status = rowStatus(ret);
                const expanded = expandedId === ret.recordId;
                return (
                  <div className="db-row-item" key={ret.recordId}>
                    <div
                      className={`db-row-main rt-row${ret.matched ? '' : ' rt-row--unmatched'}`}
                      onClick={() => toggleExpand(ret.recordId)}
                    >
                      <div className="db-col-cycle" style={{ display: 'flex', alignItems: 'center' }}>
                        <svg
                          className={`rt-chevron${expanded ? ' rt-chevron-open' : ''}`}
                          width="11"
                          height="11"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={CHEVRON_ROW} />
                        </svg>
                        <span>{formatDay(ret.returnDate)}</span>
                      </div>
                      <div className="db-col-status">
                        <span className={`db-status-badge ${typeBadgeClass(ret.returnType)}`}>
                          {typeLabel(ret.returnType)}
                        </span>
                      </div>
                      <div className="db-col-company" style={{ minWidth: 0 }}>
                        <div className="db-company-name rt-ellipsis" title={ret.customerName}>
                          {ret.customerName || '—'}
                        </div>
                        <div
                          className="rt-ellipsis"
                          style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}
                        >
                          {ret.referenceNumber || '—'}
                          {ret.last4 ? ` · ••${ret.last4}` : ''}
                        </div>
                      </div>
                      <div className="db-col-company">
                        <span className="rt-reason" title={ret.returnReason}>
                          {ret.returnReason || '—'}
                        </span>
                      </div>
                      <div className="db-col-status">
                        {status.quiet ? (
                          <span className="db-cmp-quiet" title={ret.matchNote}>
                            {status.label}
                          </span>
                        ) : (
                          <span className={`rt-pill ${status.cls ?? ''}`} title={ret.matchNote}>
                            {status.label}
                          </span>
                        )}
                      </div>
                      <div className="db-col-owed db-money-bold text-danger">-{fmtCurrency(ret.amount)}</div>
                      {/* Actions live in their own column — buttons, not pills */}
                      <div className="rt-col-action" onClick={(e) => e.stopPropagation()}>
                        {!ret.matched ? (
                          <button
                            className="rt-match-btn"
                            onClick={() => setMatchRet(ret)}
                            title="Find and link the original transaction"
                          >
                            <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={LINK_PATH} />
                            </svg>
                            Match
                          </button>
                        ) : (
                          <span className="rt-action-none">—</span>
                        )}
                      </div>
                    </div>

                    {/* Expanded detail — the full story, no hovering required */}
                    {expanded ? (
                      <div className="rt-detail">
                        <div>
                          <div className="rt-detail-note-label">Processing note</div>
                          <div className="rt-detail-note">{ret.matchNote || 'Not processed yet.'}</div>
                        </div>
                        <div className="rt-detail-meta">
                          <span>
                            Reference <b>{ret.referenceNumber || '—'}</b>
                          </span>
                          {ret.last4 ? (
                            <span>
                              Card/Acct <b>••{ret.last4}</b>
                            </span>
                          ) : null}
                          <span>
                            Type <b>{ret.returnType || '—'}</b>
                          </span>
                          <span>
                            Return date <b>{formatDay(ret.returnDate)}</b>
                          </span>
                          <span>
                            Matched <b>{ret.matched ? 'yes' : 'no'}</b>
                          </span>
                          {ret.matched && (ret.originalTransactionName || ret.originalTransactionId) ? (
                            <span>
                              Original tx{' '}
                              <b style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                                #{ret.originalTransactionName || ret.originalTransactionId}
                              </b>
                            </span>
                          ) : null}
                        </div>
                        {/* Manual match — completes what auto-matching couldn't (unmatched only) */}
                        {!ret.matched ? (
                          <div style={{ marginTop: '0.6rem' }}>
                            <button
                              className="rt-match-btn rt-match-btn--lg"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMatchRet(ret);
                              }}
                            >
                              <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={LINK_PATH} />
                              </svg>
                              Match to transaction…
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {/* ── Pagination Controls ── */}
              {filteredReturns.length > ITEMS_PER_PAGE ? (
                <div className="db-pagination">
                  <div className="db-page-info">
                    Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} -{' '}
                    {Math.min(currentPage * ITEMS_PER_PAGE, filteredReturns.length)} of {filteredReturns.length} returns
                  </div>
                  <div className="db-page-actions">
                    <button className="db-page-btn" onClick={prevPage} disabled={currentPage === 1}>
                      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={CHEVRON_LEFT} />
                      </svg>
                      Prev
                    </button>
                    <span className="db-page-current">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button className="db-page-btn" onClick={nextPage} disabled={currentPage === totalPages}>
                      Next
                      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={CHEVRON_RIGHT} />
                      </svg>
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="db-empty-state">No returns match your search.</div>
          )}
        </div>
      )}

      {/* ── Manual match modal ── */}
      {matchRet ? (
        <ReturnMatchModal
          key={matchRet.recordId}
          ret={matchRet}
          onClose={() => setMatchRet(null)}
          onMatched={applyMatch}
          onToast={notify}
        />
      ) : null}

      {/* ── Toast ── */}
      {toast ? (
        <div className={`bm-toast bm-toast--${toast.kind}`}>
          <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d={toast.kind === 'success' ? 'M5 13l4 4L19 7' : 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'}
            />
          </svg>
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
