/**
 * Data Center — 1:1 re-skin onto the zoho-octane widget's datacenter-panel template
 * (cs-dc-* / cs-summary-* / cs-table / cs-modal-* classes). Data stays on the live
 * loadDeals() adapter (sessionStorage cache + delta sync) and edits keep going through
 * POST /cs/data-center/deals/:id via updateDealBilling (allowlisted billing fields,
 * audited); save success/failure surfaces through the widget-parity Toast.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { updateDealBilling } from '@/api/cs';
import type { CsDataCenterDeal } from '@/api/touchpointTypes';
import { Toast, type ToastState } from './Toast';
import { stageMeta } from './data';
import { invalidateDealsCache, loadDeals, useLoad } from './live';
import { useScrollLock } from './useScrollLock';

const PAY_OPTIONS = ['Prepay', 'Deposit', 'LOC'];
const CYCLE_OPTIONS = ['1 Billing Cycle', '2 Billing Cycle', 'Thursday - Wednesday'];
const VERIFICATION_OPTIONS = ['Yes', 'No'];

const FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'Line of Credit', label: 'Line of Credit' },
  { id: 'Prepay', label: 'Prepay' },
  { id: 'Deposit', label: 'Deposit' },
  { id: 'none', label: 'No Type' },
];

const MAX_ROWS = 300;

const MONO = "'JetBrains Mono', monospace";

const s = (v: unknown): string => (v == null ? '' : String(v));

/** Normalized payment-type key — live data may carry 'LOC' where the widget used 'Line of Credit'. */
const payKey = (v: unknown): string => {
  const p = s(v).trim().toLowerCase();
  return p === 'loc' ? 'line of credit' : p;
};

const STAGE_BADGE: Record<'good' | 'bad' | 'info' | 'neutral' | 'warn', string> = {
  good: 'cs-badge-success',
  bad: 'cs-badge-danger',
  warn: 'cs-badge-warning',
  info: 'cs-badge-info',
  neutral: 'cs-badge-muted',
};

const stageBadge = (stage: string): string => STAGE_BADGE[stageMeta(stage).tone];

function paymentTypeBadge(type: unknown): string {
  const map: Record<string, string> = {
    'line of credit': 'cs-dc-badge-loc',
    prepay: 'cs-dc-badge-prepay',
    deposit: 'cs-dc-badge-deposit',
  };
  return map[payKey(type)] ?? 'cs-badge-muted';
}

function csCurrency(amount: number | string, symbol = '$'): string {
  return `${symbol}${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const RefreshIcon = ({ spinning }: { spinning: boolean }) => (
  <svg
    width="13"
    height="13"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    className={spinning ? 'spin-icon' : undefined}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15"
    />
  </svg>
);

export function DataCenter() {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [openDeal, setOpenDeal] = useState<CsDataCenterDeal | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const deals = useLoad(() => loadDeals(refreshTick > 0), [refreshTick]);
  const rows = deals.data ?? [];

  const statCounts = useMemo(() => {
    let loc = 0;
    let prepay = 0;
    let deposit = 0;
    for (const d of deals.data ?? []) {
      const pt = payKey(d.Payment_Type_Billing);
      if (pt === 'line of credit') loc++;
      else if (pt === 'prepay') prepay++;
      else if (pt === 'deposit') deposit++;
    }
    return { loc, prepay, deposit };
  }, [deals.data]);

  const filtered = useMemo(() => {
    let list = deals.data ?? [];
    if (activeFilter === 'none') {
      list = list.filter((d) => !s(d.Payment_Type_Billing));
    } else if (activeFilter !== 'all') {
      const key = activeFilter.toLowerCase();
      list = list.filter((d) => payKey(d.Payment_Type_Billing) === key);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (d) =>
          s(d.Deal_Name).toLowerCase().includes(q) ||
          s(d.Carrier_ID).toLowerCase().includes(q) ||
          s(d.Stage).toLowerCase().includes(q) ||
          s(d.Payment_Type_Billing).toLowerCase().includes(q),
      );
    }
    return list;
  }, [deals.data, activeFilter, search]);

  const visible = filtered.slice(0, MAX_ROWS);

  function notify(kind: ToastState['kind'], message: string) {
    setToast({ id: Date.now(), kind, message });
  }

  function refresh() {
    invalidateDealsCache();
    setRefreshTick((t) => t + 1);
    deals.reload();
  }

  return (
    <div className="cs-panel cs-dc-panel">
      {/* ── Panel Header ── */}
      <div className="cs-header-row">
        <div>
          <h2 className="cs-title">Data Center</h2>
          <div className="cs-subtitle">
            {rows.length > 0 ? `${rows.length} deals loaded` : 'Carrier billing records'}
          </div>
        </div>
        <button className="cs-refresh-btn" onClick={refresh} disabled={deals.loading}>
          <RefreshIcon spinning={deals.loading} />
          Refresh
        </button>
      </div>

      {/* ── Summary stats ── */}
      <div className="cs-summary-banner">
        <div className="cs-summary-item">
          <div className="cs-summary-icon" style={{ background: 'var(--cs-accent-soft)', color: 'var(--cs-accent)' }}>
            <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <div>
            <div className="cs-summary-amount">{rows.length}</div>
            <div className="cs-summary-label">Total Deals</div>
          </div>
        </div>
        <div className="cs-summary-item">
          <div className="cs-summary-icon" style={{ background: 'rgba(22,163,74,0.10)', color: 'var(--cs-success)' }}>
            <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <div className="cs-summary-amount">{statCounts.loc}</div>
            <div className="cs-summary-label">Line of Credit</div>
          </div>
        </div>
        <div className="cs-summary-item">
          <div className="cs-summary-icon" style={{ background: 'rgba(245,158,11,0.10)', color: '#F59E0B' }}>
            <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <div className="cs-summary-amount">{statCounts.prepay}</div>
            <div className="cs-summary-label">Prepay</div>
          </div>
        </div>
        <div className="cs-summary-item">
          <div className="cs-summary-icon" style={{ background: 'rgba(139,92,246,0.10)', color: '#8B5CF6' }}>
            <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
          </div>
          <div>
            <div className="cs-summary-amount">{statCounts.deposit}</div>
            <div className="cs-summary-label">Deposit</div>
          </div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div className="cs-citi-search-bar" style={{ flex: 1, minWidth: '140px' }}>
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
            type="text"
            placeholder="Search deal name, carrier ID, stage…"
            autoComplete="off"
          />
          {search ? (
            <button
              onClick={() => setSearch('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}
              aria-label="Clear search"
            >
              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : null}
        </div>
        <div className="cs-dc-filter-tabs">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`cs-dc-filter-tab${activeFilter === f.id ? ' active' : ''}`}
              onClick={() => setActiveFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Initial Loader ── */}
      {deals.loading && rows.length === 0 ? (
        <div
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 0', gap: '0.75rem' }}
        >
          <div className="cs-dc-loader-ring" />
          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>Loading deals</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Fetching from Zoho CRM…</div>
        </div>
      ) : null}

      {/* ── Error ── */}
      {deals.error ? (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.625rem 0.875rem',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 'var(--radius-sm)',
            color: '#DC2626',
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Failed to load deals. {deals.error}
        </div>
      ) : null}

      {/* ── Deals Table ── */}
      {!deals.loading || rows.length > 0 ? (
        <div className="cs-table-wrap cs-dc-table-wrap">
          <table className="cs-table">
            <thead>
              <tr>
                <th>Deal Name</th>
                <th>Carrier ID</th>
                <th>Stage</th>
                <th>Payment Type</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && !deals.loading ? (
                <tr>
                  <td colSpan={6}>
                    <div className="cs-empty">No deals found</div>
                  </td>
                </tr>
              ) : null}
              {visible.map((deal) => (
                <tr
                  key={s(deal.id)}
                  className="cs-dc-deal-row"
                  tabIndex={0}
                  aria-label={s(deal.Deal_Name)}
                  onClick={() => setOpenDeal(deal)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setOpenDeal(deal);
                    }
                  }}
                >
                  <td>
                    <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                      {s(deal.Deal_Name) || '—'}
                    </div>
                  </td>
                  <td style={{ fontFamily: MONO, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {deal.Carrier_ID != null ? String(deal.Carrier_ID) : '—'}
                  </td>
                  <td>
                    <span className={`cs-badge ${stageBadge(s(deal.Stage))}`}>{s(deal.Stage) || '—'}</span>
                  </td>
                  <td>
                    <span className={`cs-badge ${paymentTypeBadge(deal.Payment_Type_Billing)}`}>
                      {s(deal.Payment_Type_Billing) || '—'}
                    </span>
                  </td>
                  <td style={{ fontFamily: MONO, fontSize: '0.8125rem' }}>
                    {deal.Amount ? csCurrency(deal.Amount, 'R ') : '—'}
                  </td>
                  <td>
                    <button
                      className="cs-btn cs-btn-ghost"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.625rem' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDeal(deal);
                      }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {deals.loading && rows.length > 0
                ? [1, 2, 3].map((i) => (
                    <tr key={`sk${i}`}>
                      <td colSpan={6}>
                        <div className="cs-skeleton" style={{ height: '32px', borderRadius: '2px' }} />
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {filtered.length > MAX_ROWS ? (
        <div style={{ marginTop: '0.5rem', textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Showing first {MAX_ROWS} — refine the search to narrow down.
        </div>
      ) : null}

      {/* ── Edit Modal ── */}
      {openDeal ? (
        <DealBillingModal
          deal={openDeal}
          onClose={() => setOpenDeal(null)}
          onSaved={() => {
            setOpenDeal(null);
            notify('success', 'Deal billing fields updated');
            invalidateDealsCache();
            deals.reload();
          }}
          onError={(m) => notify('error', m)}
        />
      ) : null}

      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

function DealBillingModal({
  deal,
  onClose,
  onSaved,
  onError,
}: {
  deal: CsDataCenterDeal;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  useScrollLock();
  const [pay, setPay] = useState(s(deal.Payment_Type_Billing));
  const [cycle, setCycle] = useState(s(deal.Billing_Cycle));
  const [verification, setVerification] = useState(s(deal.Billing_Verification));
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    const changes: Record<string, string | null> = {};
    if (pay !== s(deal.Payment_Type_Billing)) changes.Payment_Type_Billing = pay || null;
    if (cycle !== s(deal.Billing_Cycle)) changes.Billing_Cycle = cycle || null;
    if (verification !== s(deal.Billing_Verification)) changes.Billing_Verification = verification || null;
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await updateDealBilling(s(deal.id), changes);
      onSaved();
    } catch (e) {
      setSaving(false);
      onError(`Save failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  const select = (id: string, value: string, onChange: (v: string) => void, options: string[]) => (
    <select
      className="cs-dc-edit-select"
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">— None —</option>
      {options.concat(options.includes(value) || !value ? [] : [value]).map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );

  return (
    <div
      className="cs-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cs-modal-box" ref={boxRef} tabIndex={-1} style={{ maxWidth: '520px' }}>
        <div className="cs-modal-header">
          <h3 className="cs-modal-title">Edit Deal</h3>
          <button className="cs-modal-close" onClick={onClose}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="cs-modal-body">
          {/* Read-only info */}
          <div className="cs-field-row">
            <span className="cs-field-label">Deal Name</span>
            <span className="cs-field-value">{s(deal.Deal_Name) || '—'}</span>
          </div>
          <div className="cs-field-row">
            <span className="cs-field-label">Stage</span>
            <span className={`cs-badge ${stageBadge(s(deal.Stage))}`}>{s(deal.Stage) || '—'}</span>
          </div>
          <div className="cs-field-row">
            <span className="cs-field-label">Carrier ID</span>
            <span className="cs-field-value" style={{ fontFamily: MONO }}>
              {s(deal.Carrier_ID) || '—'}
            </span>
          </div>
          <div className="cs-field-row">
            <span className="cs-field-label">Deal ID</span>
            <span className="cs-field-value" style={{ fontFamily: MONO, fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
              {s(deal.id)}
            </span>
          </div>

          {/* Editable fields */}
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-dark)' }}>
            <div
              style={{
                fontSize: '0.625rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                marginBottom: '0.75rem',
              }}
            >
              Editable Fields
            </div>

            <div className="cs-dc-edit-field">
              <label className="cs-dc-edit-label" htmlFor={`dc-edit-payment-${s(deal.id)}`}>
                Payment Type / Billing
              </label>
              {select(`dc-edit-payment-${s(deal.id)}`, pay, setPay, PAY_OPTIONS)}
            </div>
            <div className="cs-dc-edit-field">
              <label className="cs-dc-edit-label" htmlFor={`dc-edit-cycle-${s(deal.id)}`}>
                Billing Cycle
              </label>
              {select(`dc-edit-cycle-${s(deal.id)}`, cycle, setCycle, CYCLE_OPTIONS)}
            </div>
            <div className="cs-dc-edit-field">
              <label className="cs-dc-edit-label" htmlFor={`dc-edit-verify-${s(deal.id)}`}>
                Billing Verification
              </label>
              {select(`dc-edit-verify-${s(deal.id)}`, verification, setVerification, VERIFICATION_OPTIONS)}
            </div>
          </div>
        </div>
        <div className="cs-modal-footer">
          <button className="cs-btn cs-btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="cs-btn cs-btn-primary" onClick={save} disabled={saving}>
            {saving ? (
              <svg
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                style={{ animation: 'spin 0.8s linear infinite' }}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15"
                />
              </svg>
            ) : null}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
