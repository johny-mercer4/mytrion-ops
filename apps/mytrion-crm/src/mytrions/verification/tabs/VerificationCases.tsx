import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Inbox, RefreshCw, Search, X } from 'lucide-react';
import { formatCachedAt } from '../../_shared/swrCache';
import {
  exportVerificationCases,
  type VerificationCaseAggregates,
  type VerificationCaseStatus,
  type VerificationOwnerScope,
} from '../../../api/verificationCases';
import { VerificationCaseModal } from '../VerificationCaseModal';
import { VerificationSummary, VerificationSummaryItem } from '../VerificationSummaryItem';
import { CaseCard, CASE_COLUMNS, CaseRow } from '../VerificationCaseListItems';
import { CASES_PAGE_SIZE, useVerificationCasesList } from '../verificationData';
import { CASE_STATUS_LABELS, isClosedCaseStatus } from '../verificationCaseUi';
import { OWNER_SCOPE_CHIPS, ownerScopeCount, statusBucketCount } from '../verificationCaseDesk';

const SK_ROWS = 8;
const SK_CARDS = 6;

function CasesSkeleton() {
  return (
    <div className="vf-sk-cases" aria-busy="true">
      <span className="sr-only" role="status">
        Loading verification cases
      </span>
      <div className="vf-table-wrap" aria-hidden="true">
        <table className="vf-table">
          <thead>
            <tr>
              {CASE_COLUMNS.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: SK_ROWS }, (_, i) => (
              <tr key={i} className="vf-sk-row">
                {CASE_COLUMNS.map((col) => (
                  <td key={col}>
                    <span className="vf-sk vf-sk-cell" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="vf-case-cards" aria-hidden="true">
        {Array.from({ length: SK_CARDS }, (_, i) => (
          <li key={i} className="vf-sk vf-sk-case-card" />
        ))}
      </ul>
    </div>
  );
}

function ChipCount({ value }: { value: number | null }) {
  if (value == null) return null;
  return <span className="vf-chip-n">{value.toLocaleString()}</span>;
}

export function VerificationCases() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<VerificationCaseStatus | ''>('');
  const [owner, setOwner] = useState<VerificationOwnerScope | ''>('');
  const [unmatched, setUnmatched] = useState(false);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const list = useVerificationCasesList({ status, q: debounced, unmatched, owner, page });
  const items = list.data?.items ?? [];
  const aggregates = list.data?.aggregates;
  const lastAggregates = useRef<VerificationCaseAggregates | undefined>(aggregates);
  if (aggregates) lastAggregates.current = aggregates;
  const shownAgg = aggregates ?? lastAggregates.current;
  const total = list.data?.total ?? 0;
  const firstLoad = list.loading && !list.data;
  const countsPending = shownAgg == null && !list.error;
  const totalPages = Math.max(1, Math.ceil(total / CASES_PAGE_SIZE));
  const cachedCaption = formatCachedAt(list.cachedAt);
  const filtersOn = Boolean(debounced.trim() || status || unmatched || owner);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const selectStatus = (id: VerificationCaseStatus | ''): void => {
    setStatus(id);
    setPage(1);
  };

  const selectOwner = (id: VerificationOwnerScope | ''): void => {
    setOwner(id);
    setPage(1);
  };

  const clearFilters = (): void => {
    setQ('');
    setDebounced('');
    setStatus('');
    setOwner('');
    setUnmatched(false);
    setPage(1);
  };

  const onExport = async (): Promise<void> => {
    setExporting(true);
    setExportError(null);
    try {
      await exportVerificationCases({
        ...(status ? { status } : {}),
        q: debounced,
        unmatched,
        ...(owner ? { owner } : {}),
      });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="vf-clients">
      <div className="vf-panel">
        <div className="vf-toolbar">
          <label className="vf-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && q) {
                  e.preventDefault();
                  setQ('');
                  setDebounced('');
                  setPage(1);
                }
              }}
              placeholder="Company, DOT, email, deal id…"
              aria-label="Search cases by company, DOT, email or deal id"
            />
            {q ? (
              <button
                type="button"
                className="vf-search-clear"
                aria-label="Clear search"
                onClick={() => {
                  setQ('');
                  setDebounced('');
                  setPage(1);
                }}
              >
                <X size={14} />
              </button>
            ) : null}
          </label>
          <div className="vf-refresh">
            {list.revalidating ? (
              <span className="vf-cached">Refreshing…</span>
            ) : cachedCaption ? (
              <span className="vf-cached">Updated {cachedCaption}</span>
            ) : null}
            <button
              type="button"
              className="vf-btn"
              disabled={exporting || firstLoad}
              onClick={() => void onExport()}
              aria-label="Export filtered cases as CSV"
            >
              <Download size={14} />
              {exporting ? 'Exporting…' : 'Export'}
            </button>
            <button
              type="button"
              className="vf-btn"
              disabled={list.revalidating || firstLoad}
              onClick={list.reload}
              aria-label="Reload cases"
            >
              <RefreshCw size={14} className={list.revalidating ? 'vf-spin' : undefined} />
              Refresh
            </button>
          </div>
        </div>

        <div className="vf-filters">
          <div className="vf-filter-group" role="group" aria-label="Status">
            <span className="vf-filter-label">Status</span>
            {CASE_STATUS_LABELS.map((s) => (
              <button
                key={s.id || 'all'}
                type="button"
                className={`vf-chip${isClosedCaseStatus(s.id) ? ' is-closed' : ''}`}
                aria-pressed={status === s.id}
                onClick={() => selectStatus(s.id)}
              >
                {s.label}
                <ChipCount value={countsPending ? null : statusBucketCount(shownAgg, s.id)} />
              </button>
            ))}
          </div>
          <div className="vf-filter-group" role="group" aria-label="Queue owner">
            <span className="vf-filter-label">Owner</span>
            {OWNER_SCOPE_CHIPS.map((s) => (
              <button
                key={s.id || 'all-owners'}
                type="button"
                className="vf-chip"
                aria-pressed={owner === s.id}
                onClick={() => selectOwner(s.id)}
              >
                {s.label}
                <ChipCount value={countsPending ? null : ownerScopeCount(shownAgg, s.id)} />
              </button>
            ))}
          </div>
          <div className="vf-filter-group" role="group" aria-label="Carrier match">
            <span className="vf-filter-label">Carrier</span>
            <button type="button" className="vf-chip" aria-pressed={unmatched} onClick={() => {
              setUnmatched((v) => !v);
              setPage(1);
            }}>
              Unmatched
            </button>
          </div>
        </div>

        <VerificationSummary pending={countsPending}>
          <VerificationSummaryItem
            pending={countsPending}
            value={shownAgg?.new ?? 0}
            label="new"
            pressed={status === 'new'}
            onSelect={() => selectStatus(status === 'new' ? '' : 'new')}
          />
          <VerificationSummaryItem
            pending={countsPending}
            value={shownAgg?.inProgress ?? 0}
            label="in progress"
            pressed={status === 'in_progress'}
            onSelect={() => selectStatus(status === 'in_progress' ? '' : 'in_progress')}
          />
          <VerificationSummaryItem
            pending={countsPending}
            value={shownAgg?.awaitingDecision ?? 0}
            label="hold"
            pressed={status === 'awaiting_decision'}
            onSelect={() => selectStatus(status === 'awaiting_decision' ? '' : 'awaiting_decision')}
          />
          <VerificationSummaryItem
            pending={countsPending}
            value={shownAgg?.unclaimed ?? 0}
            label="unclaimed"
            pressed={owner === 'unclaimed'}
            onSelect={() => selectOwner(owner === 'unclaimed' ? '' : 'unclaimed')}
          />
          <VerificationSummaryItem
            pending={countsPending}
            value={shownAgg?.mine ?? 0}
            label="mine"
            pressed={owner === 'mine'}
            onSelect={() => selectOwner(owner === 'mine' ? '' : 'mine')}
          />
          <VerificationSummaryItem pending={countsPending} value={shownAgg?.stale ?? 0} label="stale" />
          <VerificationSummaryItem
            pending={countsPending}
            value={shownAgg?.approved ?? 0}
            label="approved"
            pressed={status === 'approved'}
            onSelect={() => selectStatus(status === 'approved' ? '' : 'approved')}
          />
          <VerificationSummaryItem
            pending={countsPending}
            value={shownAgg?.rejected ?? 0}
            label="rejected"
            pressed={status === 'rejected'}
            onSelect={() => selectStatus(status === 'rejected' ? '' : 'rejected')}
          />
        </VerificationSummary>
      </div>

      {exportError ? (
        <p className="vf-banner-error" role="alert">
          {exportError}
        </p>
      ) : null}

      {list.error && items.length > 0 ? (
        <p className="vf-banner-error" role="alert">
          {list.error}
        </p>
      ) : null}

      {firstLoad ? (
        <CasesSkeleton />
      ) : list.error && items.length === 0 ? (
        <div className="vf-empty" role="alert">
          <Inbox size={28} aria-hidden="true" />
          <div className="vf-empty-title">Couldn’t load cases</div>
          <p>{list.error}</p>
          <button type="button" className="vf-btn" onClick={list.reload}>
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="vf-empty">
          <Inbox size={28} aria-hidden="true" />
          <div className="vf-empty-title">{filtersOn ? 'No cases match' : 'No verification cases yet'}</div>
          <p>
            {filtersOn
              ? 'Nothing in this status, owner, search or unmatched filter. Clear them to see the full queue.'
              : 'New Zoho applications appear here after intake.'}
          </p>
          {filtersOn ? (
            <button type="button" className="vf-btn" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="vf-table-wrap">
            <table className="vf-table">
              <caption className="sr-only">Verification cases</caption>
              <thead>
                <tr>
                  {CASE_COLUMNS.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <CaseRow key={row.id} row={row} onOpen={setOpenId} />
                ))}
              </tbody>
            </table>
          </div>
          <ul className="vf-case-cards" aria-label="Verification cases">
            {items.map((row) => (
              <li key={row.id}>
                <CaseCard row={row} onOpen={setOpenId} />
              </li>
            ))}
          </ul>
        </>
      )}

      {!firstLoad && items.length > 0 && totalPages > 1 ? (
        <nav className="vf-pager" aria-label="Case pages">
          <button
            type="button"
            className="vf-icon-btn"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="vf-pager-label">
            Page <strong>{page}</strong> of <strong>{totalPages}</strong>
          </span>
          <button
            type="button"
            className="vf-icon-btn"
            aria-label="Next page"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <ChevronRight size={16} />
          </button>
        </nav>
      ) : null}

      {openId ? (
        <VerificationCaseModal
          caseId={openId}
          preview={items.find((r) => r.id === openId) ?? null}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}
