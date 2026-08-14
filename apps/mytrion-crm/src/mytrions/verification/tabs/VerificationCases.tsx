import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Inbox, RefreshCw, Search, X } from 'lucide-react';
import { formatCachedAt } from '../../_shared/swrCache';
import type { VerificationCaseRow, VerificationCaseStatus } from '../../../api/verificationCases';
import { VerificationCaseModal } from '../VerificationCaseModal';
import { CASES_PAGE_SIZE, useVerificationCasesList } from '../verificationData';

const STATUSES: { id: VerificationCaseStatus | ''; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'awaiting_decision', label: 'Awaiting decision' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'failed', label: 'Failed' },
];

const CASE_COLUMNS = [
  'Company',
  'Zoho stage',
  'Applied',
  'DOT',
  'Owner',
  'Queue',
  'Pipeline',
  'Carrier',
  'Status',
] as const;

const SK_ROWS = 8;
const SK_CARDS = 6;

function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : '—';
}

function statusLabel(status: VerificationCaseStatus): string {
  return STATUSES.find((s) => s.id === status)?.label ?? status;
}

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

export function VerificationCases() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<VerificationCaseStatus | ''>('');
  const [unmatched, setUnmatched] = useState(false);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const list = useVerificationCasesList({ status, q: debounced, unmatched, page });
  const items = list.data?.items ?? [];
  const aggregates = list.data?.aggregates;
  const total = list.data?.total ?? 0;
  const firstLoad = list.loading && !list.data;
  const totalPages = Math.max(1, Math.ceil(total / CASES_PAGE_SIZE));
  const cachedCaption = formatCachedAt(list.cachedAt);
  const filtersOn = Boolean(debounced.trim() || status || unmatched);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const selectStatus = (id: VerificationCaseStatus | ''): void => {
    setStatus(id);
    setPage(1);
  };

  const toggleUnmatched = (): void => {
    setUnmatched((v) => !v);
    setPage(1);
  };

  const agg = (value: number | undefined): string =>
    firstLoad || value == null ? '—' : value.toLocaleString();

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
            {STATUSES.map((s) => (
              <button
                key={s.id || 'all'}
                type="button"
                className="vf-chip"
                aria-pressed={status === s.id}
                onClick={() => selectStatus(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="vf-filter-group" role="group" aria-label="Carrier match">
            <span className="vf-filter-label">Carrier</span>
            <button type="button" className="vf-chip" aria-pressed={unmatched} onClick={toggleUnmatched}>
              Unmatched
            </button>
          </div>
        </div>

        <p className="vf-summary" aria-live="polite">
          <span className="vf-summary-item">
            <strong>{agg(aggregates?.open)}</strong> open
          </span>
          <span className="vf-summary-item">
            <strong>{agg(aggregates?.shared)}</strong> shared
          </span>
          <span className="vf-summary-item">
            <strong>{agg(aggregates?.inProgress)}</strong> in progress
          </span>
          <span className="vf-summary-item">
            <strong>{agg(aggregates?.awaitingDecision)}</strong> awaiting decision
          </span>
          <span className="vf-summary-item">
            <strong>{agg(aggregates?.unmatched)}</strong> unmatched
          </span>
        </p>
      </div>

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
              ? 'Nothing in this status, search or unmatched filter. Clear them to see the full queue.'
              : 'New Zoho applications appear here after intake.'}
          </p>
          {filtersOn ? (
            <button
              type="button"
              className="vf-btn"
              onClick={() => {
                setQ('');
                setDebounced('');
                setStatus('');
                setUnmatched(false);
                setPage(1);
              }}
            >
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
                <button type="button" className="vf-case-card" onClick={() => setOpenId(row.id)}>
                  <strong>{dash(row.companyName)}</strong>
                  <span>
                    {statusLabel(row.status)} · {row.stagesDone}/{row.stagesTotal}
                  </span>
                  <span>
                    {dash(row.zohoStage)} · {dash(row.applicationDate)}
                  </span>
                </button>
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

function CaseRow({
  row,
  onOpen,
}: {
  row: VerificationCaseRow;
  onOpen: (id: string) => void;
}) {
  return (
    <tr>
      <td>
        <button type="button" className="vf-link" onClick={() => onOpen(row.id)}>
          {dash(row.companyName)}
        </button>
      </td>
      <td>{dash(row.zohoStage)}</td>
      <td>{dash(row.applicationDate)}</td>
      <td>{dash(row.dot)}</td>
      <td>{dash(row.ownerName)}</td>
      <td>{row.distributeType === 'shared' ? 'Shared' : 'Personal'}</td>
      <td>
        {row.stagesDone}/{row.stagesTotal}
      </td>
      <td>{row.matchedSnapshotId ? dash(row.carrierOperatingStatus) || 'Matched' : '—'}</td>
      <td>{statusLabel(row.status)}</td>
    </tr>
  );
}
