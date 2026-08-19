/**
 * One collection case.
 *
 * The orchestrator only: it owns the two fetches (the case, and the desk bundle of plan +
 * promises + tradeline), the write dialogs, and the `reloadKey` that makes every panel re-read
 * after a write. The three panels are their own files under `detail/` — the record is now four
 * distinct reads and one 600-line component would be the wrong unit to review.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Pagination,
  Skeleton,
  SkeletonRegion,
  type DataColumn,
} from '@/ds';
import { getCollectionCase, listCollectionInvoices, type CollectionInvoiceRow } from '@/api/collection';
import { getCaseDesk, reopenCase, setStage } from '@/api/collectionDesk';
import { useCachedLoad } from '../../_shared/swrCache';
import { CaseActionDialogs, useCaseActions } from '../actions/useCaseActions';
import { fmtDate, moneyExact } from '../collectionFormat';
import { CaseHeader } from './detail/CaseHeader';
import { CaseRail } from './detail/CaseRail';
import { CaseTimeline } from './detail/CaseTimeline';
import {
  CASE_INVOICES_PAGE_SIZE,
  invoiceCacheKey,
  invoicePageOffset,
  invoicePanelKind,
  nextStage,
} from './casesModel';
import './cases.css';
import './caseDetail.css';

export function CaseDetail({
  caseId,
  onBack,
  onChanged,
}: {
  caseId: string;
  onBack: () => void;
  /** Lets the list behind this view refresh once the case is put back. */
  onChanged: () => void;
}) {
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => setPage(1), [caseId]);

  const loadCase = useCallback(() => getCollectionCase(caseId), [caseId]);
  const loadDesk = useCallback(() => getCaseDesk(caseId), [caseId]);
  const loadInvoices = useCallback(
    () =>
      listCollectionInvoices(caseId, {
        limit: CASE_INVOICES_PAGE_SIZE,
        offset: invoicePageOffset(page, CASE_INVOICES_PAGE_SIZE),
      }),
    [caseId, page],
  );

  const detail = useCachedLoad(`collection:case:${caseId}:${reloadKey}`, loadCase);
  const desk = useCachedLoad(`collection:case:${caseId}:desk:${reloadKey}`, loadDesk);
  const invoices = useCachedLoad(
    invoiceCacheKey(caseId, page, CASE_INVOICES_PAGE_SIZE),
    loadInvoices,
  );

  const row = detail.data?.case ?? null;
  const bundle = desk.data ?? null;

  /** One seam for every write: re-read the case, its bundle and its feed, then tell the list. */
  const refresh = useCallback(() => {
    setReloadKey((n) => n + 1);
    onChanged();
  }, [onChanged]);

  const actions = useCaseActions({ onDone: refresh });

  /**
   * Reopen is the one write with no dialog: there is nothing to fill in, and the confirmation is
   * the case coming back open in front of you.
   */
  const reopen = useCallback(async () => {
    await reopenCase(caseId);
    refresh();
  }, [caseId, refresh]);

  /** Advance = the next stage in the progression the spine reads left to right. */
  const advance = useCallback(async () => {
    if (!row) return;
    const next = nextStage(row.collectionStage);
    if (!next) return;
    await setStage(caseId, { stage: next });
    refresh();
  }, [row, caseId, refresh]);

  const invoiceCols = useMemo<DataColumn<CollectionInvoiceRow>[]>(
    () => [
      {
        id: 'number',
        header: 'Invoice',
        rowHeader: true,
        mobile: 'primary',
        cell: (inv) => (
          <span className="cc-ident-text">
            <span className="cc-ident-label">{inv.invoiceNumber ?? `#${inv.cmpInvoiceId}`}</span>
            <span className="cc-ident-sub">{inv.periodLabel ?? fmtDate(inv.periodFrom)}</span>
          </span>
        ),
      },
      { id: 'status', header: 'Status', cell: (inv) => inv.status ?? '—' },
      {
        id: 'total',
        header: 'Total',
        align: 'end',
        cell: (inv) => <span className="num">{moneyExact(inv.totalAmount)}</span>,
      },
      {
        id: 'paid',
        header: 'Paid',
        align: 'end',
        cell: (inv) => <span className="num">{moneyExact(inv.totalPaid)}</span>,
      },
      {
        id: 'left',
        header: 'Remaining',
        align: 'end',
        mobile: 'secondary',
        cell: (inv) => <span className="num cc-strong">{moneyExact(inv.remainingAmount)}</span>,
      },
      { id: 'due', header: 'Due', cell: (inv) => fmtDate(inv.dueDate) },
    ],
    [],
  );

  if (detail.error && !row) {
    return (
      <div className="cc-case">
        <ErrorState
          size="page"
          title="Could not load this case"
          description="Retry the request, or check that you can reach Collection."
          primaryAction={
            <Button variant="primary" onClick={() => void detail.reload()}>
              Retry
            </Button>
          }
          secondaryAction={
            <Button variant="secondary" onClick={onBack}>
              Back to the book
            </Button>
          }
        />
      </div>
    );
  }

  if (!row) {
    return (
      <div className="cc-case">
        <SkeletonRegion busy label="Loading the collection case">
          <Skeleton variant="rect" height="180px" radius="panel" />
          <Skeleton variant="rect" height="360px" radius="panel" />
        </SkeletonRegion>
      </div>
    );
  }

  const kind = invoicePanelKind({
    loading: invoices.loading,
    error: invoices.error,
    data: invoices.data,
  });
  const invoiceRows = invoices.data?.items ?? [];
  const invoiceTotal = invoices.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(invoiceTotal / CASE_INVOICES_PAGE_SIZE));

  return (
    <div className="cc-case">
      <CaseHeader
        row={row}
        bundle={bundle}
        policy={bundle?.policy ?? null}
        onBack={onBack}
        onAdvance={() => void advance()}
        onLogContact={() => actions.openContact(row)}
      />

      <div className="cc-case-body">
        <div className="cc-case-main">
          <CaseTimeline
            caseId={caseId}
            reloadKey={reloadKey}
            onLogContact={() => actions.openContact(row)}
          />

          <section className="cc-pane">
            <header className="cc-pane-head">
              <h2 className="cc-pane-title">Unpaid invoices</h2>
              <span className="cc-pane-meta">
                <span className="num">{invoiceTotal}</span> unpaid ·{' '}
                <span className="num">{moneyExact(row.totalDebtAmount)}</span> outstanding
              </span>
            </header>
            {kind === 'loading' ? (
              <SkeletonRegion busy label="Loading invoices">
                <Skeleton variant="rect" height="160px" radius="panel" />
              </SkeletonRegion>
            ) : kind === 'error' ? (
              <ErrorState
                size="panel"
                title="Could not load invoices"
                description="Retry the request, or check that you can reach Collection."
                primaryAction={
                  <Button variant="primary" onClick={() => void invoices.reload()}>
                    Retry
                  </Button>
                }
              />
            ) : kind === 'empty' ? (
              <EmptyState
                size="panel"
                icon="receipt"
                title="No invoices on this case"
                description="Unpaid CMP invoices appear here when the finder attaches them."
              />
            ) : (
              <>
                <DataTable<CollectionInvoiceRow>
                  caption="Unpaid invoices on this case"
                  rows={invoiceRows}
                  rowKey={(inv) => inv.id}
                  columns={invoiceCols}
                  density="compact"
                  empty="No invoices on this case."
                />
                <div className="cc-foot">
                  <span className="cc-foot-count">
                    Showing{' '}
                    <strong className="num">
                      {invoiceTotal === 0 ? 0 : (page - 1) * CASE_INVOICES_PAGE_SIZE + 1}–
                      {Math.min(invoiceTotal, (page - 1) * CASE_INVOICES_PAGE_SIZE + invoiceRows.length)}
                    </strong>{' '}
                    of <strong className="num">{invoiceTotal}</strong>
                  </span>
                  <Pagination
                    page={page}
                    pageCount={pageCount}
                    onPageChange={setPage}
                    pageSize={CASE_INVOICES_PAGE_SIZE}
                    total={invoiceTotal}
                    itemLabel="invoices"
                    size="sm"
                  />
                </div>
              </>
            )}
          </section>
        </div>

        <CaseRail
          row={row}
          bundle={bundle}
          onLogContact={() => actions.openContact(row)}
          onPlan={() => actions.openPlan(row, bundle?.plan ?? null)}
          onPlacement={() => actions.openPlacement(row)}
          onClose={() => actions.openClose(row)}
          onReopen={() => void reopen()}
        />
      </div>

      <CaseActionDialogs actions={actions} />
    </div>
  );
}
