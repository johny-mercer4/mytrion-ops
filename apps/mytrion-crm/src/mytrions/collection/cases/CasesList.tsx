/**
 * Collection cases — list. Same desk language as Verification's applicant queue:
 * PageHead lives in the shell; this is the panel, table, and pager.
 */
import { useMemo } from 'react';
import { Badge, DataTable, EmptyState, Pagination, type DataColumn } from '@/ds';
import type { CollectionCaseRow } from '@/api/collection';
import { fmtDate, money } from '../collectionFormat';
import {
  CLOSED_REASON_LABEL,
  caseInitials,
  caseName,
  daysTone,
  stageChip,
  stageLabel,
  statusChip,
} from './casesModel';

const PAGE_SIZE = 15;
const LOADING_MIN_HEIGHT = `${PAGE_SIZE * 66 + 37}px`;

export function CasesList({
  rows,
  total,
  page,
  loading,
  filtered,
  onPage,
  onOpen,
}: {
  rows: CollectionCaseRow[];
  total: number;
  page: number;
  loading: boolean;
  filtered: boolean;
  onPage: (page: number) => void;
  onOpen: (id: string) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const from = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, (currentPage - 1) * PAGE_SIZE + rows.length);

  const columns = useMemo<DataColumn<CollectionCaseRow>[]>(
    () => [
      {
        id: 'name',
        header: 'Carrier',
        rowHeader: true,
        width: '24%',
        mobile: 'primary',
        cell: (row) => (
          <span className="cc-ident">
            <span className="cc-mono" aria-hidden="true">
              {caseInitials(row)}
            </span>
            <span className="cc-ident-text">
              <span className="cc-ident-name">
                <span className="cc-ident-label">{caseName(row)}</span>
              </span>
              <span className="cc-ident-sub">
                {row.carrierId}
                {row.debtorMcDot ? ` · ${row.debtorMcDot}` : ''}
              </span>
            </span>
          </span>
        ),
      },
      {
        id: 'stage',
        header: 'Stage',
        width: '14%',
        mobile: 'secondary',
        cell: (row) => {
          const chip = stageChip(row.collectionStage);
          return (
            <span className="cc-status-cell">
              <Badge intent={chip.intent} icon={chip.icon}>
                <span className="cc-status-label">{stageLabel(row.collectionStage)}</span>
              </Badge>
            </span>
          );
        },
      },
      {
        id: 'status',
        header: 'Status',
        width: '12%',
        cell: (row) => {
          const chip = statusChip(row);
          return (
            <Badge intent={chip.intent} icon={chip.icon}>
              {chip.label}
            </Badge>
          );
        },
      },
      {
        id: 'debt',
        header: 'Remaining',
        width: '12%',
        align: 'end',
        cell: (row) => <span className="num">{money(row.totalDebtAmount)}</span>,
      },
      {
        id: 'dpd',
        header: 'Past due',
        width: '10%',
        align: 'end',
        cell: (row) => (
          <span className="num" data-tone={daysTone(row.daysPastDue)}>
            {row.daysPastDue}d
          </span>
        ),
      },
      {
        id: 'invoices',
        header: 'Invoices',
        width: '8%',
        align: 'end',
        cell: (row) => <span className="num">{row.issueInvoiceCount}</span>,
      },
      {
        id: 'placed',
        header: 'Placed',
        width: '12%',
        cell: (row) => <span className="num">{fmtDate(row.placementDate)}</span>,
      },
      {
        id: 'closed',
        header: 'Close reason',
        width: '8%',
        cell: (row) => (row.closedReason ? CLOSED_REASON_LABEL[row.closedReason] : '—'),
      },
    ],
    [],
  );

  if (!loading && total === 0) {
    return (
      <EmptyState
        size="page"
        icon="inbox"
        title={filtered ? 'No cases match' : 'No collection cases'}
        description={
          filtered
            ? 'Nothing matches these filters. Clear them to see the board.'
            : 'Cases appear when remaining debt stays above $100. The finder writes them here, not Zoho.'
        }
      />
    );
  }

  return (
    <div className="cc-panel">
      <DataTable<CollectionCaseRow>
        caption="Collection cases"
        rows={rows}
        rowKey={(row) => row.id}
        columns={columns}
        layout="fixed"
        density="comfortable"
        loading={loading}
        {...(loading && rows.length === 0 ? { scrollerStyle: { minBlockSize: LOADING_MIN_HEIGHT } } : {})}
        onRowActivate={(row) => onOpen(row.id)}
        empty={filtered ? 'Nothing matches. Clear the filters.' : 'Nothing in this state.'}
      />
      <div className="cc-foot">
        <span className="cc-foot-count">
          Showing{' '}
          <strong className="num">
            {from}–{to}
          </strong>{' '}
          of <strong className="num">{total}</strong>
        </span>
        <Pagination page={currentPage} pageCount={pageCount} onPageChange={onPage} />
      </div>
    </div>
  );
}

export { PAGE_SIZE as CASES_PAGE_SIZE };
