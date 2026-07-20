/**
 * Debtors panel — 1:1 port of the zoho widget's debtors-panel.js template (bm-debtors-panel /
 * db-kpi-grid / db-list-header + db-row-item rows / db-pagination / bm-modal-* detail) over the
 * live DWH roll-up. Read-only: loads `billing.debtors.list` once via useLoad, then filters,
 * paginates (50/page) and drills into the row→invoice modal entirely client-side — mirroring the
 * widget's computed()/watch() logic. No writes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { billingTouchpoint } from '@/api/billing';
import { useLoad } from '../_shared/useLoad';
import { type Debtor, dateFull, fmtCurrency, fmtCycle, type Invoice } from './data';

const ITEMS_PER_PAGE = 50;
const HARD_DEBT_DAYS = 15;

// Icon paths (verbatim from the widget template).
const SEARCH_PATH = 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z';
const CLOSE_PATH = 'M6 18L18 6M6 6l12 12';
const REFRESH_PATH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';
const ERROR_PATH = 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';
const CHEVRON_LEFT = 'M15 19l-7-7 7-7';
const CHEVRON_RIGHT = 'M9 5l7 7-7 7';

// ---- raw → view-model mapping (defensive; the DWH envelope shape varies) ----

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function toStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** The servercrm reply can arrive as {debtors:[…]}, {data:[…]}, {data:{debtors:[…]}} (raw
 *  envelope, un-unwrapped) or a bare array — normalize every shape to a row list. */
function extractRows(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res.filter(isRecord);
  if (!isRecord(res)) return [];
  if (Array.isArray(res.debtors)) return res.debtors.filter(isRecord);
  const data = res.data;
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data) && Array.isArray(data.debtors)) return data.debtors.filter(isRecord);
  return [];
}

function mapInvoice(raw: unknown): Invoice {
  const r = isRecord(raw) ? raw : {};
  return {
    num: toStr(r.invoice_id),
    created: toStr(r.create_date),
    age: toNum(r.debt_days),
    total: toNum(r.total_amount),
    remaining: toNum(r.remaining_amount),
  };
}

function mapDebtor(raw: Record<string, unknown>): Debtor {
  const invoices = (Array.isArray(raw.invoices) ? raw.invoices : []).map(mapInvoice);
  // Widget: badge class keys off has_partial, label off worst_status — collapse both into the
  // one view-model field (they track the same signal in the DWH roll-up).
  const isPartial = Boolean(raw.has_partial) || toStr(raw.worst_status) === 'partially_paid';
  const age = toNum(raw.max_debt_days);
  return {
    carrierId: toStr(raw.carrier_id),
    company: toStr(raw.company_name) || toStr(raw.deal_name) || '—',
    cycle: toStr(raw.billing_cycle),
    worstStatus: isPartial ? 'partially_paid' : 'pending',
    age,
    isHard: raw.is_hard_debtor !== undefined ? Boolean(raw.is_hard_debtor) : age >= HARD_DEBT_DAYS,
    invoiceCount: raw.invoice_count !== undefined ? toNum(raw.invoice_count) : invoices.length,
    totalOwed: toNum(raw.total_owed),
    totalRemaining: toNum(raw.total_remaining),
    invoices,
  };
}

export function Debtors() {
  const page = useLoad(() => billingTouchpoint('billing.debtors.list', {}), []);

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterAge, setFilterAge] = useState('all');
  const [selected, setSelected] = useState<Debtor | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const contentRef = useRef<HTMLDivElement>(null);

  const debtors = useMemo(() => extractRows(page.data).map(mapDebtor), [page.data]);

  const filtered = useMemo(() => {
    let rows = debtors;
    if (filterStatus === 'pending') rows = rows.filter((d) => d.worstStatus !== 'partially_paid');
    else if (filterStatus === 'partial') rows = rows.filter((d) => d.worstStatus === 'partially_paid');
    if (filterAge === 'hard') rows = rows.filter((d) => d.isHard);
    else if (filterAge === 'recent') rows = rows.filter((d) => !d.isHard);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((d) => String(d.carrierId).toLowerCase().includes(q) || d.company.toLowerCase().includes(q));
    return rows;
  }, [debtors, filterStatus, filterAge, search]);

  // Widget parity: KPIs reflect the CURRENT filtered view, not the full book.
  const kpi = useMemo(
    () => ({
      totalDebtors: filtered.length,
      totalDebt: filtered.reduce((s, d) => s + d.totalRemaining, 0),
      hardDebtors: filtered.filter((d) => d.isHard).length,
    }),
    [filtered],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(pageNum, totalPages);
  const paginated = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Reset to page 1 whenever a filter/search changes (the widget's watchers).
  useEffect(() => {
    setPageNum(1);
  }, [filterStatus, filterAge, search]);

  function scrollTop() {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }
  function prevPage() {
    if (currentPage > 1) {
      setPageNum(currentPage - 1);
      scrollTop();
    }
  }
  function nextPage() {
    if (currentPage < totalPages) {
      setPageNum(currentPage + 1);
      scrollTop();
    }
  }

  return (
    <div className="bm-panel bm-debtors-panel">
      {/* ── Header & Search ── */}
      <div className="bm-header-row">
        <div>
          <h2 className="bm-title">Debtors Dashboard</h2>
          <div className="bm-subtitle">Company-wide accounts with pending or partial payments</div>
        </div>

        <div className="db-controls">
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="db-filter-select">
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="partial">Partial</option>
          </select>

          <select value={filterAge} onChange={(e) => setFilterAge(e.target.value)} className="db-filter-select">
            <option value="all">All Ages</option>
            <option value="hard">Hard Debt (≥15d)</option>
            <option value="recent">Recent (&lt;15d)</option>
          </select>

          <button className="bm-refresh-btn" onClick={page.reload} disabled={page.loading}>
            <svg
              className={page.loading ? 'spin-icon' : undefined}
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={REFRESH_PATH} />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ── Full-width contextual search (design parity) ── */}
      <div className="db-search-row">
        <div className="db-search-wrap">
          <svg className="db-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={SEARCH_PATH} />
          </svg>
          <input
            type="text"
            className="db-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Carrier ID or Company..."
          />
          {search ? (
            <button className="db-search-clear" onClick={() => setSearch('')}>
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={CLOSE_PATH} />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {/* ── KPI Banner ── */}
      <div className="db-kpi-grid">
        <div className="db-kpi-card">
          <div className="db-kpi-title">Total Debt</div>
          <div className="db-kpi-value text-danger">{fmtCurrency(kpi.totalDebt)}</div>
        </div>
        <div className="db-kpi-card">
          <div className="db-kpi-title">Total Debtors</div>
          <div className="db-kpi-value">{kpi.totalDebtors}</div>
        </div>
        <div className="db-kpi-card db-danger-card">
          <div className="db-kpi-title">
            Hard Debtors
            <span className="db-kpi-badge">≥15 days</span>
          </div>
          <div className="db-kpi-value text-warning">{kpi.hardDebtors}</div>
        </div>
      </div>

      {/* ── Loading / Error / Data ── */}
      {page.loading && debtors.length === 0 ? (
        <div className="bm-initial-loader">
          <div className="bm-loader-ring" />
          <div>
            <div className="bm-loader-text">Loading Debtors</div>
            <div className="bm-loader-sub">Fetching company-wide financial records...</div>
          </div>
        </div>
      ) : page.error ? (
        <div className="db-error-state">
          <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={ERROR_PATH} />
          </svg>
          <div className="db-error-msg">{page.error}</div>
          <button className="bm-refresh-btn" onClick={page.reload} style={{ width: 'fit-content', marginTop: '0.5rem' }}>
            Try Again
          </button>
        </div>
      ) : (
        <div className="db-content-area" ref={contentRef}>
          {/* List Header */}
          <div className="db-list-header">
            <div className="db-col-carrier">Carrier</div>
            <div className="db-col-company">Company</div>
            <div className="db-col-cycle">Cycle</div>
            <div className="db-col-status">Status</div>
            <div className="db-col-age">Oldest Debt</div>
            <div className="db-col-count">Inv</div>
            <div className="db-col-owed">Total Owed</div>
            <div className="db-col-remain">Remaining</div>
          </div>

          {paginated.length > 0 ? (
            <>
              {paginated.map((debtor) => (
                <div className="db-row-item" key={debtor.carrierId}>
                  <div className="db-row-main" onClick={() => setSelected(debtor)}>
                    <div className="db-col-carrier db-carrier-id">{debtor.carrierId}</div>
                    <div className="db-col-company">
                      <div className="db-company-name">{debtor.company}</div>
                    </div>
                    <div className="db-col-cycle">
                      {debtor.cycle ? (
                        <span className="db-cycle-badge">{fmtCycle(debtor.cycle)}</span>
                      ) : (
                        <span className="db-cycle-none">—</span>
                      )}
                    </div>
                    <div className="db-col-status">
                      <span
                        className={`db-status-badge ${debtor.worstStatus === 'partially_paid' ? 'db-status-partial' : 'db-status-pending'}`}
                      >
                        {debtor.worstStatus === 'partially_paid' ? 'Partial' : 'Pending'}
                      </span>
                    </div>
                    <div className="db-col-age">
                      <div className="db-age-cell">
                        <span className={`db-age-text${debtor.isHard ? ' text-danger' : ''}`}>{debtor.age}d</span>
                        <div className="db-age-bar">
                          <div
                            style={{
                              width: `${Math.min(Math.round((debtor.age / 31) * 100), 100)}%`,
                              background: debtor.isHard ? 'var(--danger-text)' : 'var(--warning-text)',
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="db-col-count db-count-text">{debtor.invoiceCount}</div>
                    <div className="db-col-owed db-money-muted">{fmtCurrency(debtor.totalOwed)}</div>
                    <div className="db-col-remain db-money-bold">{fmtCurrency(debtor.totalRemaining)}</div>
                  </div>
                </div>
              ))}

              {/* ── Pagination Controls ── */}
              {filtered.length > ITEMS_PER_PAGE ? (
                <div className="db-pagination">
                  <div className="db-page-info">
                    Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} - {Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)} of{' '}
                    {filtered.length} debtors
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
            <div className="db-empty-state">No debtors match your search.</div>
          )}
        </div>
      )}

      {/* ── Modal ── */}
      {selected ? <DebtorModal debtor={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function DebtorModal({ debtor, onClose }: { debtor: Debtor; onClose: () => void }) {
  return (
    <div className="bm-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bm-modal-box" style={{ maxWidth: 600 }}>
        <div className="bm-modal-header">
          <h3 className="bm-modal-title">
            {debtor.company}
            <span
              style={{
                fontSize: '0.6875rem',
                color: 'var(--text-muted)',
                marginLeft: '0.5rem',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              #{debtor.carrierId}
            </span>
          </h3>
          <button className="bm-modal-close" onClick={onClose}>
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={CLOSE_PATH} />
            </svg>
          </button>
        </div>

        <div className="bm-modal-body" style={{ padding: '1rem 1.25rem' }}>
          <div
            style={{
              display: 'flex',
              gap: '1rem',
              marginBottom: '1.25rem',
              paddingBottom: '1rem',
              borderBottom: '1px solid var(--border-dark)',
            }}
          >
            <div>
              <div className="bm-field-label">Total Remaining</div>
              <div className="bm-field-value text-danger" style={{ fontSize: '1.125rem', fontWeight: 700 }}>
                {fmtCurrency(debtor.totalRemaining)}
              </div>
            </div>
            <div>
              <div className="bm-field-label">Oldest Debt</div>
              <div className="bm-field-value">{debtor.age} days</div>
            </div>
            <div>
              <div className="bm-field-label">Status</div>
              <div className="bm-field-value" style={{ marginTop: '0.2rem' }}>
                <span
                  className={`db-status-badge ${debtor.worstStatus === 'partially_paid' ? 'db-status-partial' : 'db-status-pending'}`}
                >
                  {debtor.worstStatus === 'partially_paid' ? 'Partial' : 'Pending'}
                </span>
              </div>
            </div>
          </div>

          <div className="bm-field-label" style={{ marginBottom: '0.5rem' }}>
            Invoices ({debtor.invoices.length})
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {debtor.invoices.map((inv) => (
              <div
                key={inv.num}
                className={`db-invoice-card${inv.age >= HARD_DEBT_DAYS ? ' db-overdue' : ''}`}
              >
                <div className="db-inv-col-info">
                  <span className="db-inv-label">Invoice #{inv.num}</span>
                  <span className="db-inv-val" style={{ color: 'var(--text-muted)', fontSize: '0.6875rem' }}>
                    Created: {inv.created ? dateFull(inv.created) : '—'}
                  </span>
                </div>

                <div className="db-inv-col-age">
                  <span className="db-inv-label">Age</span>
                  <span className={`db-inv-val${inv.age >= HARD_DEBT_DAYS ? ' text-danger' : ''}`}>{inv.age} days</span>
                </div>

                <div className="db-inv-col-amt">
                  <span className="db-inv-label">Total Amount</span>
                  <span className="db-inv-val">{fmtCurrency(inv.total)}</span>
                </div>

                <div className="db-inv-col-amt">
                  <span className="db-inv-label">Remaining</span>
                  <span className={`db-inv-val text-bold${inv.age >= HARD_DEBT_DAYS ? ' text-danger' : ''}`}>
                    {fmtCurrency(inv.remaining)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
