import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { formatCachedAt } from '../../_shared/swrCache';
import type { VerificationClientRow } from '../../../api/verificationClients';
import { VerificationClientCard } from '../VerificationClientCard';
import { VerificationClientModal } from '../VerificationClientModal';
import { VerificationFilters } from '../VerificationFilters';
import {
  DEFAULT_VERIFICATION_SORT,
  distinctValues,
  EMPTY_VERIFICATION_FILTERS,
  filtersAreActive,
  useFilteredVerificationClients,
  useVerificationRoster,
  type VerificationFilters as Filters,
  type VerificationSort,
} from '../verificationData';

/**
 * Verification → Existing clients. Every carrier company-wide, from `octane.dim_company`.
 *
 * PAGINATION. The roster is fetched once (cached — see `verificationData.ts`) so search and every
 * filter chip are instant, no round trip. Only one page's worth is ever mounted at a time.
 */

const PAGE_SIZE = 24;

export function VerificationClients() {
  const roster = useVerificationRoster();
  const [filters, setFilters] = useState<Filters>(EMPTY_VERIFICATION_FILTERS);
  const [sort, setSort] = useState<VerificationSort>(DEFAULT_VERIFICATION_SORT);
  const [page, setPage] = useState(1);
  const [openClient, setOpenClient] = useState<VerificationClientRow | null>(null);
  const lastClient = useRef<VerificationClientRow | null>(null);
  if (openClient) lastClient.current = openClient;
  const shownClient = openClient ?? lastClient.current;

  const rows = roster.data ?? [];
  const deferredQ = useDeferredValue(filters.q);
  const filtered = useFilteredVerificationClients(rows, { ...filters, q: deferredQ }, sort);

  const companyTypes = useMemo(() => distinctValues(rows, 'companyType'), [rows]);
  const cycleTags = useMemo(() => distinctValues(rows, 'billingCycleTag'), [rows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const visible = filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]): void => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const clearFilters = (): void => {
    setFilters(EMPTY_VERIFICATION_FILTERS);
    setPage(1);
  };

  const debtorCount = useMemo(() => filtered.filter((c) => c.isDebtor).length, [filtered]);
  const clearCount = filtered.length - debtorCount;

  const firstLoad = roster.loading && !roster.data;
  const cachedCaption = formatCachedAt(roster.cachedAt);
  const emptyBecauseFilters = filtersAreActive(filters);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div className="vf-clients">
      <VerificationFilters
        filters={filters}
        sort={sort}
        companyTypes={companyTypes}
        cycleTags={cycleTags}
        matching={filtered.length}
        clearCount={clearCount}
        debtorCount={debtorCount}
        rosterTotal={rows.length}
        cachedCaption={cachedCaption}
        revalidating={roster.revalidating}
        onFilter={set}
        onSort={(value) => {
          setSort(value);
          setPage(1);
        }}
        onClear={clearFilters}
        onRefresh={roster.reload}
      />

      {roster.error && rows.length > 0 ? (
        <p className="vf-banner-error" role="alert">
          {roster.error}
        </p>
      ) : null}

      {firstLoad ? (
        <div className="vf-cardc-grid" aria-busy="true" aria-label="Loading clients">
          {Array.from({ length: PAGE_SIZE }, (_, i) => (
            <div key={i} className="vf-sk vf-sk-card" />
          ))}
        </div>
      ) : roster.error && rows.length === 0 ? (
        <div className="vf-empty" role="alert">
          <Users size={28} aria-hidden="true" />
          <div className="vf-empty-title">Couldn’t load clients</div>
          <p>{roster.error}</p>
          <button type="button" className="vf-btn" onClick={roster.reload}>
            Try again
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="vf-empty">
          <Users size={28} aria-hidden="true" />
          <div className="vf-empty-title">No clients match</div>
          <p>
            {emptyBecauseFilters
              ? 'Nothing in this activity window, payment type, debtor status or search. Clear filters to see the full roster.'
              : 'The roster is empty.'}
          </p>
          {emptyBecauseFilters ? (
            <button type="button" className="vf-btn" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
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

      {shownClient ? (
        <VerificationClientModal
          open={openClient != null}
          client={shownClient}
          onClose={() => setOpenClient(null)}
        />
      ) : null}
    </div>
  );
}
