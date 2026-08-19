/**
 * Collection cases — the list.
 *
 * WHAT CHANGED AND WHY. The shipped table answered "what state is this in" three times over —
 * Stage, Status and Close reason are the same fact at different resolutions, and the stage badge
 * already carries all of it. Those three collapse into one, which buys the width for the two
 * columns a collector actually reads first and neither of which existed:
 *
 *   Recovered   how much of the invoiced total has come back, and what share that is. Remaining
 *               alone cannot distinguish a debt nobody has touched from one 80% repaid.
 *   Last touch  when anyone last reached out, and how. Needs the contact log, which is why this
 *               column could not exist before the desk had a write side.
 *
 * `Next action` is the open promise, so a due or lapsed commitment is visible without opening
 * the case.
 *
 * There is deliberately NO owner column. `assignee_user_id` has been on the table all along with
 * nothing writing it, so the column would render an em-dash on every row for ever. It goes in
 * with case assignment, not before.
 */
import { useMemo } from 'react';
import { Badge, DataTable, EmptyState, Pagination, type DataColumn } from '@/ds';
import type { CollectionCaseRow } from '@/api/collection';
import type { CaseDeskInfo } from '@/api/collectionDesk';
import { AgeCell, LastTouch, PromiseChip } from '../CollectionBits';
import { fmtDate, money } from '../collectionFormat';
import { caseInitials, caseName, stageChip, stageLabel } from './casesModel';

const PAGE_SIZE = 15;
const LOADING_MIN_HEIGHT = `${PAGE_SIZE * 66 + 37}px`;

/** Share of the invoiced total already recovered. Null when nothing was ever invoiced. */
function recoveredShare(row: CollectionCaseRow): number | null {
  const invoiced = Number(row.totalInvoiceAmount);
  const paid = Number(row.totalAmountPaid);
  if (!Number.isFinite(invoiced) || invoiced <= 0 || !Number.isFinite(paid)) return null;
  return Math.min(100, Math.round((paid / invoiced) * 100));
}

export function CasesList({
  rows,
  desk,
  total,
  page,
  loading,
  filtered,
  onPage,
  onOpen,
}: {
  rows: CollectionCaseRow[];
  desk: Record<string, CaseDeskInfo>;
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
        width: '22%',
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
        width: '13%',
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
        id: 'debt',
        header: 'Remaining',
        width: '12%',
        align: 'end',
        cell: (row) => <span className="num cc-strong">{money(row.totalDebtAmount)}</span>,
      },
      {
        id: 'recovered',
        header: 'Recovered',
        width: '13%',
        align: 'end',
        cell: (row) => {
          const share = recoveredShare(row);
          const paid = Number(row.totalAmountPaid) || 0;
          return (
            <span className="cc-recovered">
              <span className="num" data-zero={paid <= 0 ? 'true' : undefined}>
                {money(row.totalAmountPaid)}
              </span>
              <span className="cc-recovered-share num">
                {share === null ? '—' : `${share}% of invoiced`}
              </span>
            </span>
          );
        },
      },
      {
        id: 'age',
        header: 'Age',
        width: '10%',
        cell: (row) => <AgeCell days={row.daysPastDue} />,
      },
      {
        id: 'touch',
        header: 'Last touch',
        width: '9%',
        cell: (row) => {
          const info = desk[row.id];
          return (
            <LastTouch
              days={info?.daysSinceContact ?? null}
              channel={info?.lastContact?.channel ?? null}
            />
          );
        },
      },
      {
        id: 'next',
        header: 'Next action',
        width: '21%',
        cell: (row) => {
          const promise = desk[row.id]?.promise;
          if (promise) {
            return (
              <PromiseChip
                amount={promise.amount}
                dueDate={promise.dueDate}
                daysLate={promise.daysLate}
              />
            );
          }
          if (row.placementDate) {
            return <span className="cc-muted">Filed {fmtDate(row.placementDate)}</span>;
          }
          return <span className="cc-muted">—</span>;
        },
      },
    ],
    [desk],
  );

  if (!loading && total === 0) {
    return (
      <EmptyState
        size="page"
        icon="inbox"
        title={filtered ? 'No cases match' : 'No collection cases'}
        description={
          filtered
            ? 'Nothing matches these filters. Clear them to see the book.'
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
