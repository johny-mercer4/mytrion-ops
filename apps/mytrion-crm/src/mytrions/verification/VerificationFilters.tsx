/**
 * Search + filter + sort chrome for Existing clients.
 *
 * One panel, not a toolbar plus a second chip strip: the operator's job is "find the right carrier
 * without losing debtor vs creditworthy". Active filters stay visible; Clear is one control.
 */
import { RefreshCw, Search, X } from 'lucide-react';
import { AggregatorMark, KNOWN_AGGREGATOR_IDS, aggregatorMeta } from './verificationAggregators';
import { VerificationSummary, VerificationSummaryItem } from './VerificationSummaryItem';
import {
  filtersAreActive,
  isVerificationSort,
  type VerificationActivity,
  type VerificationFilters,
  type VerificationSort,
} from './verificationData';

const TERMS: { id: VerificationFilters['paymentTerms']; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'LOC', label: 'LOC' },
  { id: 'Prepay', label: 'Prepay' },
  { id: 'none', label: 'Not set' },
];
const DEBTOR: { id: VerificationFilters['debtor']; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'debtors', label: 'Debtors' },
  { id: 'clear', label: 'Not flagged' },
];
const ACTIVITY: { id: VerificationActivity; label: string }[] = [
  { id: 'all', label: 'Any time' },
  { id: '30', label: 'Last 30 days' },
  { id: '60', label: 'Last 60 days' },
  { id: '90', label: 'Last 90 days' },
];
const SORTS: { id: VerificationSort; label: string }[] = [
  { id: 'creditworthy', label: 'Creditworthy first' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'score', label: 'Credit score' },
  { id: 'recent', label: 'Recently active' },
];

export function VerificationFilters({
  filters,
  sort,
  companyTypes,
  cycleTags,
  matching,
  clearCount,
  debtorCount,
  rosterTotal,
  cachedCaption,
  revalidating,
  countsPending = false,
  onFilter,
  onSort,
  onClear,
  onRefresh,
}: {
  filters: VerificationFilters;
  sort: VerificationSort;
  companyTypes: string[];
  cycleTags: string[];
  matching: number;
  clearCount: number;
  debtorCount: number;
  rosterTotal: number;
  cachedCaption: string | null;
  revalidating: boolean;
  /** True only on the cold first roster fetch — remounts keep last counts. */
  countsPending?: boolean;
  onFilter: <K extends keyof VerificationFilters>(key: K, value: VerificationFilters[K]) => void;
  onSort: (value: VerificationSort) => void;
  onClear: () => void;
  onRefresh: () => void;
}) {
  const active = filtersAreActive(filters);
  const scopeLabel = active ? 'matching' : 'on file';

  return (
    <div className="vf-panel">
      <div className="vf-toolbar">
        <label className="vf-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={filters.q}
            onChange={(e) => onFilter('q', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filters.q) {
                e.preventDefault();
                onFilter('q', '');
              }
            }}
            placeholder="Company or carrier id…"
            aria-label="Search companies or carrier ids"
          />
          {filters.q ? (
            <button
              type="button"
              className="vf-search-clear"
              aria-label="Clear search"
              onClick={() => onFilter('q', '')}
            >
              <X size={14} />
            </button>
          ) : null}
        </label>
        <div className="vf-refresh">
          {revalidating ? (
            <span className="vf-cached">Refreshing…</span>
          ) : cachedCaption ? (
            <span className="vf-cached">Updated {cachedCaption}</span>
          ) : null}
          <button type="button" className="vf-btn" onClick={onRefresh} disabled={revalidating}>
            <RefreshCw size={14} className={revalidating ? 'vf-spin' : undefined} />
            Refresh
          </button>
        </div>
      </div>

      <VerificationSummary pending={countsPending}>
        <VerificationSummaryItem pending={countsPending} value={matching} label={scopeLabel} />
        <VerificationSummaryItem
          pending={countsPending}
          value={clearCount}
          label="not flagged"
          tone="clear"
        />
        <VerificationSummaryItem
          pending={countsPending}
          value={debtorCount}
          label={debtorCount === 1 ? 'debtor' : 'debtors'}
          tone="debt"
        />
        {active && rosterTotal > 0 && !countsPending ? (
          <span className="vf-summary-hint">of {rosterTotal.toLocaleString()} total</span>
        ) : null}
      </VerificationSummary>

      <div className="vf-filters">
        <div className="vf-filter-group" role="group" aria-label="Active in">
          <span className="vf-filter-label">Active</span>
          {ACTIVITY.map((t) => (
            <button
              key={t.id}
              type="button"
              className="vf-chip"
              aria-pressed={filters.activity === t.id}
              onClick={() => onFilter('activity', filters.activity === t.id && t.id !== 'all' ? 'all' : t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="vf-filter-group" role="group" aria-label="Payment terms">
          <span className="vf-filter-label">Payment</span>
          {TERMS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="vf-chip"
              aria-pressed={filters.paymentTerms === t.id}
              onClick={() => onFilter('paymentTerms', t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="vf-filter-group" role="group" aria-label="Debtor flag">
          <span className="vf-filter-label">Debtor</span>
          {DEBTOR.map((d) => (
            <button
              key={d.id}
              type="button"
              className="vf-chip"
              aria-pressed={filters.debtor === d.id}
              onClick={() => onFilter('debtor', d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
        {countsPending ? (
          <div className="vf-filter-group" role="group" aria-hidden="true">
            <span className="vf-filter-label">Aggregator</span>
            {KNOWN_AGGREGATOR_IDS.map((id) => (
              <span key={id} className="vf-chip vf-sk vf-sk-chip">
                {aggregatorMeta(id).label}
              </span>
            ))}
          </div>
        ) : companyTypes.length > 0 ? (
          <div className="vf-filter-group" role="group" aria-label="Aggregator">
            <span className="vf-filter-label">Aggregator</span>
            <button
              type="button"
              className="vf-chip"
              aria-pressed={filters.companyType == null}
              onClick={() => onFilter('companyType', null)}
            >
              All
            </button>
            {companyTypes.map((t) => (
              <button
                key={t}
                type="button"
                className="vf-chip vf-chip-agg"
                aria-pressed={filters.companyType === t}
                onClick={() => onFilter('companyType', filters.companyType === t ? null : t)}
              >
                <AggregatorMark companyType={t} />
              </button>
            ))}
          </div>
        ) : null}
        {cycleTags.length > 0 ? (
          <div className="vf-filter-group" role="group" aria-label="Billing cycle">
            <span className="vf-filter-label">Cycle</span>
            <button
              type="button"
              className="vf-chip"
              aria-pressed={filters.billingCycleTag == null}
              onClick={() => onFilter('billingCycleTag', null)}
            >
              All
            </button>
            {cycleTags.map((t) => (
              <button
                key={t}
                type="button"
                className="vf-chip"
                aria-pressed={filters.billingCycleTag === t}
                onClick={() => onFilter('billingCycleTag', filters.billingCycleTag === t ? null : t)}
              >
                {t}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="vf-panel-foot">
        <label className="vf-sort">
          <span className="vf-filter-label">Sort</span>
          <select
            value={sort}
            aria-label="Sort clients"
            onChange={(e) => {
              if (isVerificationSort(e.target.value)) onSort(e.target.value);
            }}
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {active ? (
          <button type="button" className="vf-btn vf-btn-clear" onClick={onClear}>
            <X size={14} />
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}
