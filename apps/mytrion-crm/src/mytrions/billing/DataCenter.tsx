/**
 * Data Center — 1:1 re-skin of the zoho-octane billing-mytrion datacenter-panel.js template
 * (bm-panel / bm-summary-* / bm-toolbar / dc-filter-tabs + dc-stage-* multiselect / bm-table /
 * bm-modal-* / dc-detail-* / bm-toast), scoped under `.bm-root`.
 *
 * Data is LIVE and READ-ONLY (fully Zoho-free): deals load via
 * billingTouchpoint('billing.datacenter.deals') from the DWH and map onto the `Deal` view-model in
 * ./data.ts. The deal-billing edit (a Zoho CRM write) was removed — billing fields are now managed
 * in Zoho CRM directly, so Data Center never writes to Zoho.
 *
 * Detail modal lazy-loads avg-days (billing.datacenter.avgDays) and invoices/prepay
 * (billing.invoices.search) — both DWH-sourced; Debtor Status + Recent Transactions render as
 * graceful, honest placeholders (no per-carrier billing touchpoint wired for those yet).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { billingTouchpoint } from '@/api/billing';
import type { BillingDealsResult, BillingInvoicesResult } from '@/api/touchpointTypes';
import { useLoad } from '../_shared/useLoad';
import { type Deal, type PayType, type StageSem, type Verify, payMeta, stageMeta } from './data';

/* ── icon path constants (verbatim from the widget template) ── */
const P_REFRESH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';
const P_SEARCH = 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z';
const P_CLOSE = 'M6 18L18 6M6 6l12 12';
const P_WARN = 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';
const P_FILTER = 'M3 4h18M6 12h12M10 20h4';
const P_CHEVRON = 'M19 9l-7 7-7-7';

const FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'Line of Credit', label: 'Line of Credit' },
  { id: 'Prepay', label: 'Prepay' },
  { id: 'Deposit', label: 'Deposit' },
  { id: 'none', label: 'No Type' },
];

const STAGE_OPTIONS = [
  'Application Sent',
  'Application Filled',
  'CS Validation',
  'EFS Processing',
  'Vendor Validation',
  'Cards Sent',
  'Cards Activated',
  'Billing Form Sent',
  'Billing Form Filled',
  'Card Funded',
  'Card Swiped',
  'Closed Lost',
];


/** Design sem → the bm-badge modifier class (stage chip). */
const SEM_BADGE: Record<StageSem, string> = {
  muted: 'bm-badge-muted',
  warning: 'bm-badge-warning',
  accent: 'bm-badge-info',
  purple: 'bm-badge-purple',
  success: 'bm-badge-success',
  danger: 'bm-badge-danger',
};
const stageBadge = (stage: string): string => SEM_BADGE[stageMeta(stage).sem];

/** Design sem → the stage progress-bar fill colour. */
const SEM_COLOR: Record<StageSem, string> = {
  muted: 'var(--mutedc)',
  warning: 'var(--warning-text)',
  accent: 'var(--billing-accent)',
  purple: 'var(--purple-text)',
  success: 'var(--success-text)',
  danger: 'var(--danger-text)',
};

/** Payment-type badge — the widget's dedicated dc-badge-* palette (loc=green, prepay=amber, deposit=purple). */
const PAY_BADGE: Record<PayType, string> = {
  'Line of Credit': 'dc-badge-loc',
  Prepay: 'dc-badge-prepay',
  Deposit: 'dc-badge-deposit',
  '': 'bm-badge-muted',
};

const MONO = "'JetBrains Mono', monospace";

/* ── raw → view-model mapping ── */
const str = (v: unknown): string => (v == null ? '' : String(v));

const toNum = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Payment_Type_Billing → PayType union (live data may carry 'LOC' for Line of Credit). */
function toPayType(raw: unknown): PayType {
  const p = str(raw).trim().toLowerCase();
  if (p === 'line of credit' || p === 'loc') return 'Line of Credit';
  if (p === 'prepay') return 'Prepay';
  if (p === 'deposit') return 'Deposit';
  return '';
}

/** Billing_Verification → Verify union (accepts the picklist values, plus a boolean/Yes-No fallback). */
function toVerify(raw: unknown): Verify {
  if (raw === true) return 'Verified';
  if (raw === false) return 'Failed';
  const v = str(raw).trim().toLowerCase();
  if (v === 'verified' || v === 'yes' || v === 'true') return 'Verified';
  if (v === 'pending') return 'Pending';
  if (v === 'failed' || v === 'no' || v === 'false') return 'Failed';
  return '';
}

function toDeal(r: Record<string, unknown>): Deal {
  return {
    id: str(r.id),
    name: str(r.Deal_Name),
    carrierId: r.Carrier_ID != null ? String(r.Carrier_ID) : '',
    stage: str(r.Stage),
    appDate: str(r.Application_Date),
    payType: toPayType(r.Payment_Type_Billing),
    cycle: str(r.Billing_Cycle),
    verify: toVerify(r.Billing_Verification),
    avgDays: toNum(r.Avg_Payment_Days),
  };
}

/** deals/data array, or a bare array — handle all shapes. */
function mapDeals(result: BillingDealsResult): Deal[] {
  // result is typed as the object shape but the feed may return a bare array at runtime.
  const asArray = result as unknown;
  const rows: Array<Record<string, unknown>> = Array.isArray(asArray)
    ? (asArray as Array<Record<string, unknown>>)
    : (result.deals ?? result.data ?? []);
  return rows.map(toDeal);
}

export function DataCenter() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [stageOpen, setStageOpen] = useState(false);
  const [openDeal, setOpenDeal] = useState<Deal | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const load = useLoad<BillingDealsResult>(
    () => billingTouchpoint('billing.datacenter.deals', refreshTick > 0 ? { fresh: '1' } : {}),
    [refreshTick],
  );

  // Sync fetched rows into local state (kept mutable so a save can patch a row in place — widget parity).
  useEffect(() => {
    if (load.data) setDeals(mapDeals(load.data));
  }, [load.data]);

  const loading = load.loading;

  const statCounts = useMemo(() => {
    let loc = 0;
    let prepay = 0;
    let deposit = 0;
    for (const d of deals) {
      if (d.payType === 'Line of Credit') loc++;
      else if (d.payType === 'Prepay') prepay++;
      else if (d.payType === 'Deposit') deposit++;
    }
    return { loc, prepay, deposit };
  }, [deals]);

  const filtered = useMemo(() => {
    let list = deals;
    if (activeFilter === 'none') list = list.filter((d) => !d.payType);
    else if (activeFilter !== 'all') list = list.filter((d) => d.payType === activeFilter);
    if (selectedStages.length) {
      const set = new Set(selectedStages);
      list = list.filter((d) => set.has(d.stage));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((d) =>
        `${d.name} ${d.carrierId} ${d.stage} ${d.payType}`.toLowerCase().includes(q),
      );
    }
    return list;
  }, [deals, activeFilter, selectedStages, search]);

  const stageLabel =
    selectedStages.length === 0
      ? 'All Stages'
      : selectedStages.length === 1
        ? selectedStages[0]
        : `${selectedStages.length} Stages`;

  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!stageOpen) return;
    const onDown = (e: MouseEvent) => {
      if (stageRef.current && !stageRef.current.contains(e.target as Node)) setStageOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [stageOpen]);

  function toggleStage(stage: string) {
    setSelectedStages((prev) =>
      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage],
    );
  }

  function reload() {
    setSearch('');
    setActiveFilter('all');
    setSelectedStages([]);
    setRefreshTick((t) => t + 1);
  }

  return (
    <div className="bm-panel dc-panel">
      {/* ── Panel Header ── */}
      <div className="bm-header-row">
        <div>
          <h2 className="bm-title">Data Center</h2>
          <div className="bm-subtitle">
            {deals.length > 0 ? `${deals.length} deals loaded` : 'Carrier billing records'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button className="bm-refresh-btn" onClick={reload} disabled={loading} title="Refresh">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" className={loading ? 'spin-icon' : undefined}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_REFRESH} />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div className="bm-summary-banner">
        <StatItem color="var(--billing-accent)" value={deals.length} label="Total Deals" sub="in book" />
        <StatItem color="var(--billing-accent)" value={statCounts.loc} label="Line of Credit" sub={pctOfBook(statCounts.loc, deals.length)} />
        <StatItem color="var(--warning-text)" value={statCounts.prepay} label="Prepay" sub={pctOfBook(statCounts.prepay, deals.length)} />
        <StatItem color="var(--purple-text)" value={statCounts.deposit} label="Deposit" sub={pctOfBook(statCounts.deposit, deals.length)} />
      </div>

      {/* ── Toolbar ── */}
      <div className="bm-toolbar">
        <div className="bm-search-bar" style={{ flex: 1, minWidth: '140px' }}>
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_SEARCH} />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="text"
            placeholder="Search by deal name, carrier ID, stage…"
            autoComplete="off"
          />
          {search ? (
            <button
              onClick={() => setSearch('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}
              aria-label="Clear search"
            >
              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_CLOSE} />
              </svg>
            </button>
          ) : null}
        </div>

        <div className="dc-filter-tabs" style={{ flexShrink: 0 }}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`dc-filter-tab${activeFilter === f.id ? ' active' : ''}`}
              onClick={() => setActiveFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <span className="dc-toolbar-divider" style={{ flexShrink: 0 }} />

        <div className="dc-stage-filter" ref={stageRef} style={{ flexShrink: 0, position: 'relative' }}>
          <button
            className={`dc-stage-trigger${selectedStages.length > 0 ? ' active' : ''}${stageOpen ? ' open' : ''}`}
            onClick={() => setStageOpen((o) => !o)}
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_FILTER} />
            </svg>
            <span className="dc-stage-trigger-label">{stageLabel}</span>
            {selectedStages.length ? <span className="dc-stage-count">{selectedStages.length}</span> : null}
            <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="dc-stage-chevron" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={P_CHEVRON} />
            </svg>
          </button>
          {stageOpen ? (
            <div className="dc-stage-menu">
              <div className="dc-stage-menu-head">
                <span>Filter by Stage</span>
                {selectedStages.length ? (
                  <button className="dc-stage-clear" onClick={() => setSelectedStages([])}>
                    Clear
                  </button>
                ) : null}
              </div>
              {STAGE_OPTIONS.map((s) => (
                <label key={s} className={`dc-stage-option${selectedStages.includes(s) ? ' checked' : ''}`}>
                  <input type="checkbox" value={s} checked={selectedStages.includes(s)} onChange={() => toggleStage(s)} />
                  <span>{s}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Initial Loader ── */}
      {loading && deals.length === 0 ? (
        <div className="bm-initial-loader">
          <div className="bm-loader-ring" />
          <div className="bm-loader-text">Loading deals</div>
          <div className="bm-loader-sub">Fetching from data warehouse...</div>
        </div>
      ) : null}

      {/* ── Error ── */}
      {load.error ? (
        <div className="bm-section">
          <div className="tx-save-msg error">
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_WARN} />
            </svg>
            Failed to load deals. {load.error}
          </div>
        </div>
      ) : null}

      {/* ── Deals Table ── */}
      {!loading || deals.length > 0 ? (
        <div className="bm-section" style={{ flex: 1, minHeight: 0 }}>
          <div className="bm-table-wrap" style={{ flex: 1, minHeight: 0 }}>
            <table className="bm-table" id="dc-deals-table">
              <thead>
                <tr>
                  <th>Deal Name</th>
                  <th>Carrier ID</th>
                  <th style={{ minWidth: '155px' }}>Stage</th>
                  <th>Application Date</th>
                  <th style={{ minWidth: '140px' }}>Payment Type</th>
                  <th style={{ textAlign: 'right' }}>Avg Pay</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="bm-empty">
                        <svg width="36" height="36" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.5"
                            d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        <div className="bm-empty-label">No deals found</div>
                        <div className="bm-empty-sub">Try adjusting your search or filters.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((deal) => (
                    <tr key={deal.id} className="dc-deal-row" onClick={() => setOpenDeal(deal)}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{deal.name || '—'}</div>
                      </td>
                      <td style={{ fontFamily: MONO, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {deal.carrierId || '—'}
                      </td>
                      <td>
                        <span className={`bm-badge ${stageBadge(deal.stage)}`}>{deal.stage || '—'}</span>
                        <div className="dc-stage-bar">
                          <div
                            style={{
                              width: `${stageMeta(deal.stage).pct}%`,
                              background: SEM_COLOR[stageMeta(deal.stage).sem],
                            }}
                          />
                        </div>
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{deal.appDate || '—'}</td>
                      <td>
                        <span className={`bm-badge ${PAY_BADGE[deal.payType]}`}>{payMeta(deal.payType).label}</span>
                      </td>
                      <td
                        style={{
                          textAlign: 'right',
                          fontFamily: MONO,
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: deal.avgDays != null ? avgDaysColor(deal.avgDays) : 'var(--text-muted)',
                        }}
                      >
                        {deal.avgDays != null ? `${deal.avgDays}d` : '—'}
                      </td>
                      <td style={{ color: 'var(--text-muted)', width: 40 }}>
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ opacity: 0.5 }}>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                        </svg>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* ── Deal Detail modal (read-only) ── */}
      {openDeal ? <DealDetailModal deal={openDeal} onClose={() => setOpenDeal(null)} /> : null}
    </div>
  );
}

/* ═══════════ Stat card ═══════════ */
/** "X% of book" sub-line for a type count against the total (empty if no deals). */
function pctOfBook(count: number, total: number): string {
  return total > 0 ? `${Math.round((count / total) * 100)}% of book` : '—';
}

function StatItem({ color, value, label, sub }: { color: string; value: number; label: string; sub?: string }) {
  return (
    <div className="bm-summary-item" style={{ '--stat-color': color } as CSSProperties}>
      <div className="bm-summary-label">{label}</div>
      <div className="bm-summary-amount">{value}</div>
      {sub ? <div className="bm-summary-sub">{sub}</div> : null}
    </div>
  );
}

/* ═══════════ Deal Detail modal ═══════════ */

function avgDaysColor(d: number): string {
  if (d < 7) return 'var(--success-text)';
  if (d <= 15) return 'var(--warning-text)';
  return 'var(--danger-text)';
}

function bmCurrency(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Read the first present, non-empty value across candidate keys (defensive against unknown item shapes). */
function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = o[k];
    if (v != null && v !== '') return v;
  }
  return undefined;
}

function parseAvgDays(res: Record<string, unknown> | null): number | null {
  if (!res) return null;
  const sample = toNum(res.sampleSize);
  if (sample != null && sample <= 0) return null;
  return toNum(res.avgDays);
}

function DealDetailModal({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const isPrepay = deal.payType === 'Prepay';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const avg = useLoad<Record<string, unknown>>(
    () =>
      deal.carrierId
        ? billingTouchpoint('billing.datacenter.avgDays', { carrierId: deal.carrierId })
        : Promise.resolve<Record<string, unknown>>({}),
    [deal.carrierId],
  );
  const inv = useLoad<BillingInvoicesResult>(
    () =>
      deal.carrierId
        ? billingTouchpoint('billing.invoices.search', { carrierId: deal.carrierId })
        : Promise.resolve<BillingInvoicesResult>({}),
    [deal.carrierId],
  );

  const avgDays = avg.loading ? null : (parseAvgDays(avg.data) ?? deal.avgDays);
  const invoices = inv.data?.invoices ?? [];

  return (
    <div className="bm-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bm-modal-box dc-detail-modal">
        <div className="bm-modal-header">
          <div style={{ minWidth: 0 }}>
            <h3 className="bm-modal-title">{deal.name || '—'}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
              <span className={`bm-badge ${PAY_BADGE[deal.payType]}`}>{payMeta(deal.payType).label}</span>
              <span className={`bm-badge ${stageBadge(deal.stage)}`}>{deal.stage || '—'}</span>
            </div>
          </div>
          <button className="bm-modal-close" onClick={onClose}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_CLOSE} />
            </svg>
          </button>
        </div>

        <div className="bm-modal-body">
          {/* §1 Deal Info */}
          <div className="tx-detail-section">
            <div className="tx-detail-section-title">Deal Info</div>
            <DetailRow label="Carrier ID" value={<span style={{ fontFamily: MONO }}>{deal.carrierId || '—'}</span>} />
            <DetailRow label="Application Date" value={deal.appDate || '—'} />
            <DetailRow
              label="Avg Days to Pay"
              value={
                avg.loading ? (
                  <span className="dc-skeleton dc-skeleton-narrow" style={{ display: 'inline-block', width: 46, height: 12, verticalAlign: 'middle' }} />
                ) : avgDays != null ? (
                  <span style={{ fontFamily: MONO, color: avgDaysColor(avgDays) }}>
                    {avgDays} {avgDays === 1 ? 'day' : 'days'}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>—</span>
                )
              }
            />
            <DetailRow label="Billing Cycle" value={deal.cycle || '—'} />
            <DetailRow label="Billing Verification" value={deal.verify || '—'} />
          </div>

          {/* §2 Debtor Status — no per-carrier billing touchpoint wired here yet (graceful placeholder). */}
          <div className="tx-detail-section">
            <div className="tx-detail-section-title">Debtor Status</div>
            <div className="bm-empty" style={{ padding: '1rem 0' }}>
              <div className="bm-empty-label">Debtor status not loaded in this view</div>
              <div className="bm-empty-sub">Open the Debtors panel for outstanding balances.</div>
            </div>
          </div>

          {/* §3 Invoices / Prepay Balance */}
          <div className="tx-detail-section">
            <div className="tx-detail-section-title">{isPrepay ? 'Prepay Balance' : 'Invoices'}</div>
            {inv.loading ? (
              <div className="dc-detail-skeleton-block">
                <div className="dc-skeleton dc-skeleton-wide" />
                <div className="dc-skeleton dc-skeleton-narrow" />
                <div className="dc-skeleton dc-skeleton-wide" />
              </div>
            ) : inv.error ? (
              <div className="tx-save-msg error" style={{ marginTop: '0.5rem' }}>
                <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_WARN} />
                </svg>
                Could not load invoice data. {inv.error}
              </div>
            ) : isPrepay ? (
              <div className="dc-prepay-summary">
                <div className="dc-prepay-badge">PREPAY ACCOUNT</div>
                <div className="bm-field-row">
                  <span className="bm-field-label">Summary</span>
                  <span className="bm-field-value">{str(pick(inv.data?.prepay ?? {}, ['summary', 'balance'])) || 'Active prepay account'}</span>
                </div>
              </div>
            ) : invoices.length === 0 ? (
              <div className="bm-empty" style={{ padding: '1.25rem 0' }}>
                <div className="bm-empty-label">No invoices found</div>
              </div>
            ) : (
              <div className="dc-invoice-list">
                {invoices.map((raw, i) => (
                  <InvoiceCard key={str(pick(raw, ['invoiceNumber', 'invoice_number', 'number', 'name'])) || i} inv={raw} />
                ))}
              </div>
            )}
          </div>

          {/* §4 Recent Transactions — not wired to a per-carrier billing touchpoint (graceful placeholder). */}
          <div className="tx-detail-section">
            <div className="tx-detail-section-title">Recent Transactions</div>
            <div className="bm-empty" style={{ padding: '1rem 0' }}>
              <div className="bm-empty-label">Transactions not loaded in this view</div>
              <div className="bm-empty-sub">Open the Transactions panel for this carrier's payments.</div>
            </div>
          </div>
        </div>

        <div className="bm-modal-footer">
          <button className="bm-btn bm-btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** One invoice card — field names read defensively (see report: verify against real payloads). */
function InvoiceCard({ inv }: { inv: Record<string, unknown> }) {
  const number = str(pick(inv, ['invoiceNumber', 'invoice_number', 'number', 'name'])) || '—';
  const period = str(pick(inv, ['period', 'date_range', 'dateRange']));
  const status = str(pick(inv, ['status', 'Status'])) || 'Pending';
  const total = toNum(pick(inv, ['totalAmount', 'total', 'amount', 'grand_total']));
  const paid = toNum(pick(inv, ['totalPaid', 'paid', 'amount_paid']));
  const remaining = toNum(pick(inv, ['remainingAmount', 'remaining', 'balance', 'due']));
  return (
    <div className="dc-detail-invoice-card">
      <div className="tx-invoice-top-row">
        <div>
          <span className="tx-invoice-num">#{number}</span>
          {period ? <span className="tx-invoice-period"> {period}</span> : null}
        </div>
        <span className={`bm-badge ${status.toLowerCase() === 'paid' ? 'bm-badge-success' : 'bm-badge-warning'}`}>{status}</span>
      </div>
      <div className="tx-invoice-amounts">
        <div className="tx-inv-amount-item">
          <span className="tx-inv-label">Total</span>
          <span className="tx-inv-val">{total != null ? bmCurrency(total) : '—'}</span>
        </div>
        <div className="tx-inv-amount-item">
          <span className="tx-inv-label">Paid</span>
          <span className="tx-inv-val" style={{ color: 'var(--success-text)' }}>{paid != null ? bmCurrency(paid) : '—'}</span>
        </div>
        {remaining != null && remaining > 0 ? (
          <div className="tx-inv-amount-item">
            <span className="tx-inv-label">Remaining</span>
            <span className="tx-inv-val" style={{ color: 'var(--danger-text)' }}>{bmCurrency(remaining)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bm-field-row">
      <span className="bm-field-label">{label}</span>
      <span className="bm-field-value">{value}</span>
    </div>
  );
}
