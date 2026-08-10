import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Search, Users } from 'lucide-react';
import { formatCachedAt } from '../../_shared/swrCache';
import type { VerificationClientRow } from '../../../api/verificationClients';
import { VerificationClientCard } from '../VerificationClientCard';
import { VerificationClientModal } from '../VerificationClientModal';
import {
  distinctValues,
  EMPTY_VERIFICATION_FILTERS,
  useFilteredVerificationClients,
  useVerificationRoster,
  type VerificationFilters,
} from '../verificationData';

/**
 * Verification → Existing clients. Every carrier company-wide, from `octane.dim_company`.
 *
 * PAGINATION. The roster is fetched once (cached — see `verificationData.ts`) so search and every
 * filter chip are instant, no round trip. What "proper pagination… fast" buys here is on the RENDER
 * side: glass cards with backdrop-filter are expensive per node, so only one page's worth is ever
 * mounted at a time, with real Prev/Next + page-number controls — not an ever-growing "show more" list
 * that eventually holds thousands of blurred cards at once.
 */

const PAGE_SIZE = 24;

const TERMS: { id: VerificationFilters['paymentTerms']; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'LOC', label: 'LOC' },
  { id: 'Prepay', label: 'Prepay' },
  { id: 'none', label: 'Not set' },
];
const DEBTOR: { id: VerificationFilters['debtor']; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'debtors', label: 'Debtors' },
  { id: 'clear', label: 'No flag' },
];

export function VerificationClients() {
  const roster = useVerificationRoster();
  const [filters, setFilters] = useState<VerificationFilters>(EMPTY_VERIFICATION_FILTERS);
  const [page, setPage] = useState(1);
  const [openClient, setOpenClient] = useState<VerificationClientRow | null>(null);

  const rows = roster.data ?? [];
  const filtered = useFilteredVerificationClients(rows, filters);

  const companyTypes = useMemo(() => distinctValues(rows, 'companyType'), [rows]);
  const cycleTags = useMemo(() => distinctValues(rows, 'billingCycleTag'), [rows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const visible = filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  // Any filter/search change re-opens on page 1 — staying on page 6 of a now-9-row result shows nothing.
  const set = <K extends keyof VerificationFilters>(key: K, value: VerificationFilters[K]): void => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  // Debtor count describes the FILTERED set, matching what's on screen.
  const debtorCount = useMemo(() => filtered.filter((c) => c.isDebtor).length, [filtered]);

  const firstLoad = roster.loading && !roster.data;
  const cachedCaption = formatCachedAt(roster.cachedAt);

  useEffect(() => {
    // A refresh can shrink the filtered set below the current page (a carrier dropped off the roster).
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div className="vf-clients">
      <div className="vf-toolbar">
        <label className="vf-search">
          <Search size={15} />
          <input
            value={filters.q}
            onChange={(e) => set('q', e.target.value)}
            placeholder="Company or carrier id…"
          />
        </label>
        <div className="vf-summary">
          <strong>{filtered.length.toLocaleString()}</strong> client{filtered.length === 1 ? '' : 's'} ·{' '}
          <strong>{debtorCount.toLocaleString()}</strong> debtor{debtorCount === 1 ? '' : 's'}
        </div>
        <div className="vf-refresh">
          {roster.revalidating ? (
            <span className="vf-cached">Refreshing…</span>
          ) : cachedCaption ? (
            <span className="vf-cached">Updated {cachedCaption}</span>
          ) : null}
          <button type="button" className="vf-btn" onClick={roster.reload} disabled={roster.revalidating}>
            <RefreshCw size={14} className={roster.revalidating ? 'vf-spin' : undefined} />
            Refresh
          </button>
        </div>
      </div>

      <div className="vf-filters">
        <div className="vf-filter-group">
          <span className="vf-filter-label">Payment</span>
          {TERMS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="vf-chip"
              aria-pressed={filters.paymentTerms === t.id}
              onClick={() => set('paymentTerms', t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="vf-filter-group">
          <span className="vf-filter-label">Debtor</span>
          {DEBTOR.map((d) => (
            <button
              key={d.id}
              type="button"
              className="vf-chip"
              aria-pressed={filters.debtor === d.id}
              onClick={() => set('debtor', d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
        {companyTypes.length > 0 ? (
          <div className="vf-filter-group">
            <span className="vf-filter-label">Type</span>
            {companyTypes.map((t) => (
              <button
                key={t}
                type="button"
                className="vf-chip"
                aria-pressed={filters.companyType === t}
                onClick={() => set('companyType', filters.companyType === t ? null : t)}
              >
                {t.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        ) : null}
        {cycleTags.length > 0 ? (
          <div className="vf-filter-group">
            <span className="vf-filter-label">Cycle</span>
            {cycleTags.map((t) => (
              <button
                key={t}
                type="button"
                className="vf-chip"
                aria-pressed={filters.billingCycleTag === t}
                onClick={() => set('billingCycleTag', filters.billingCycleTag === t ? null : t)}
              >
                {t}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {roster.error ? (
        <p className="vf-banner-error" role="alert">
          {roster.error}
        </p>
      ) : null}

      {firstLoad ? (
        <div className="vf-cardc-grid" aria-busy="true" aria-label="Loading clients">
          {/* PAGE_SIZE, not a round 12: the first load is always unfiltered, so it lands exactly one
              full page of cards. Reserving half of that made the grid double in height the moment
              data arrived — the same class of jump the skeleton exists to prevent. */}
          {Array.from({ length: PAGE_SIZE }, (_, i) => (
            <div key={i} className="vf-sk vf-sk-card" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="vf-empty">
          <Users size={28} />
          <div className="vf-empty-title">No clients match</div>
          <p>Try a different payment type, debtor status or search term.</p>
        </div>
      ) : (
        <>
          <div className="vf-cardc-grid">
            {visible.map((c) => (
              <VerificationClientCard key={c.carrierId} client={c} onOpen={setOpenClient} />
            ))}
          </div>

          {totalPages > 1 ? (
            <nav className="vf-pager" aria-label="Client pages">
              <button
                type="button"
                className="vf-icon-btn"
                aria-label="Previous page"
                disabled={clampedPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="vf-pager-label">
                Page <strong>{clampedPage}</strong> of <strong>{totalPages}</strong>
              </span>
              <button
                type="button"
                className="vf-icon-btn"
                aria-label="Next page"
                disabled={clampedPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRight size={16} />
              </button>
            </nav>
          ) : null}
        </>
      )}

      {openClient ? (
        <VerificationClientModal client={openClient} onClose={() => setOpenClient(null)} />
      ) : null}
    </div>
  );
}
