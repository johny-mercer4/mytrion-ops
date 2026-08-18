/**
 * One collection case — breadcrumb, identity, debt totals, debtor snapshot, unpaid invoices.
 *
 * Chrome mirrors Verification CaseView (crumbs, mono tile, fact strip, stage rail). Bodies
 * are Collection's: remaining debt and the invoice table. Invoices load here only — the
 * list already carries counts and aggregates.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Icon,
  Pagination,
  Skeleton,
  SkeletonRegion,
  type DataColumn,
} from '@/ds';
import {
  getCollectionCase,
  listCollectionInvoices,
  type CollectionInvoiceRow,
} from '@/api/collection';
import { useCachedLoad, type CachedLoad } from '../../_shared/swrCache';
import { fmtDate, money, moneyExact } from '../collectionFormat';
import './cases.css';
import {
  CASE_INVOICES_PAGE_SIZE,
  CLOSED_REASON_LABEL,
  KANBAN_STAGES,
  caseInitials,
  caseName,
  invoiceCacheKey,
  invoicePageOffset,
  invoicePanelKind,
  stageChip,
  stageLabel,
  statusChip,
} from './casesModel';

export function CaseDetail({ caseId, onBack }: { caseId: string; onBack: () => void }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [caseId]);

  const loadCase = useCallback(() => getCollectionCase(caseId), [caseId]);
  const loadInvoices = useCallback(
    () =>
      listCollectionInvoices(caseId, {
        limit: CASE_INVOICES_PAGE_SIZE,
        offset: invoicePageOffset(page, CASE_INVOICES_PAGE_SIZE),
      }),
    [caseId, page],
  );
  const detail = useCachedLoad(`collection:case:${caseId}`, loadCase);
  const invoices = useCachedLoad(
    invoiceCacheKey(caseId, page, CASE_INVOICES_PAGE_SIZE),
    loadInvoices,
  );
  const row = detail.data?.case ?? null;
  const name = row ? caseName(row) : 'Collection case';
  const chip = row ? statusChip(row) : null;

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
      { id: 'stage', header: 'CMP stage', cell: (inv) => inv.cmpStage ?? '—' },
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
        cell: (inv) => <span className="num">{moneyExact(inv.remainingAmount)}</span>,
      },
      { id: 'due', header: 'Due', cell: (inv) => fmtDate(inv.dueDate) },
    ],
    [],
  );

  const facts = row
    ? [
        { k: 'Carrier', v: row.carrierId },
        { k: 'MC / DOT', v: row.debtorMcDot },
        { k: 'Remaining', v: money(row.totalDebtAmount) },
        { k: 'Past due', v: `${row.daysPastDue}d` },
        { k: 'Invoices', v: String(row.issueInvoiceCount) },
        { k: 'Placed', v: fmtDate(row.placementDate) },
      ]
    : [];

  return (
    <div className="cc-case">
      <section className="cc-case-head">
        <div className="cc-crumbs">
          <Button variant="secondary" size="sm" icon="chevron_left" onClick={onBack}>
            All cases
          </Button>
          <span className="cc-crumb">Collection Case</span>
          <Icon name="chevron_right" size="sm" className="cc-crumb-sep" />
          <span className="cc-crumb-current">{name}</span>
          <span className="cc-crumbs-gap" />
          {row ? <span className="cc-case-id num">CASE {row.id}</span> : null}
        </div>

        {detail.error ? (
          <div className="cc-banner" data-tone="danger" role="alert">
            <span className="cc-banner-title">Could not load this case</span>
            <p className="cc-banner-body">{String(detail.error)}</p>
            <Button variant="secondary" size="sm" onClick={() => void detail.reload()}>
              Retry
            </Button>
          </div>
        ) : null}

        {detail.loading && !row ? (
          <SkeletonRegion busy label="Loading the collection case">
            <Skeleton variant="rect" height="112px" radius="panel" />
            <Skeleton variant="rect" height="48px" radius="panel" />
          </SkeletonRegion>
        ) : row ? (
          <>
            <div className="cc-case-identity">
              <div className="cc-case-who">
                <span className="cc-mono" aria-hidden="true">
                  {caseInitials(row)}
                </span>
                <div className="cc-case-titles">
                  <div className="cc-case-title-row">
                    <h1 className="cc-case-name">{name}</h1>
                    {chip ? (
                      <Badge intent={chip.intent} icon={chip.icon}>
                        {chip.label}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="cc-case-facts">
                    {facts.map((f) => (
                      <span className="cc-fact" key={f.k}>
                        <span className="t-eyebrow">{f.k}</span>
                        <span className="cc-fact-v num" data-empty={!f.v}>
                          {f.v || 'Not recorded'}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <ol className="cc-spine hscroll" aria-label="Collection stages">
              {KANBAN_STAGES.map((stage) => {
                const active = row.collectionStage === stage;
                const sChip = stageChip(stage);
                return (
                  <li key={stage} className="cc-spine-step" data-active={active}>
                    <Badge intent={active ? sChip.intent : 'neutral'} icon={sChip.icon}>
                      {stageLabel(stage)}
                    </Badge>
                  </li>
                );
              })}
            </ol>
          </>
        ) : null}
      </section>

      {row ? (
        <>
          {row.status === 'closed' ? (
            <div className="cc-banner" data-tone="success" role="status">
              <span className="cc-banner-title">
                Closed
                {row.closedReason ? ` — ${CLOSED_REASON_LABEL[row.closedReason]}` : ''}
              </span>
              <p className="cc-banner-body">
                {row.closedAt ? `Signed off ${fmtDate(row.closedAt)}.` : 'Read-only from here.'}
              </p>
            </div>
          ) : null}

          <div className="cc-panes">
            <section className="cc-pane">
              <h2 className="cc-pane-title">Debt</h2>
              <dl className="cc-dl">
                <Fact k="Remaining">{moneyExact(row.totalDebtAmount)}</Fact>
                <Fact k="Invoiced">{moneyExact(row.totalInvoiceAmount)}</Fact>
                <Fact k="Paid">{moneyExact(row.totalAmountPaid)}</Fact>
                <Fact k="First delinquent">{fmtDate(row.firstDelinquentDate)}</Fact>
                <Fact k="Agency">{row.firstCollectionAgency ?? '—'}</Fact>
                <Fact k="Zoho deal">{row.zohoDealId ?? '—'}</Fact>
              </dl>
            </section>
            <section className="cc-pane">
              <h2 className="cc-pane-title">Debtor</h2>
              <dl className="cc-dl">
                <Fact k="Name">{row.debtorFullName ?? '—'}</Fact>
                <Fact k="Email">{row.debtorEmail ?? '—'}</Fact>
                <Fact k="Phone">{row.debtorPhone ?? row.debtorCellPhone ?? '—'}</Fact>
                <Fact k="Address">{addressOf(row)}</Fact>
                <Fact k="Date of birth">{fmtDate(row.debtorDateOfBirth)}</Fact>
                <Fact k="Opened">{fmtDate(row.caseCreatedDate)}</Fact>
              </dl>
            </section>
          </div>

          <section className="cc-pane">
            <h2 className="cc-pane-title">Unpaid invoices</h2>
            <InvoicePane invoices={invoices} page={page} onPage={setPage} columns={invoiceCols} />
          </section>
        </>
      ) : null}
    </div>
  );
}

function InvoicePane({
  invoices,
  page,
  onPage,
  columns,
}: {
  invoices: CachedLoad<{ items: CollectionInvoiceRow[]; total: number }>;
  page: number;
  onPage: (next: number) => void;
  columns: DataColumn<CollectionInvoiceRow>[];
}) {
  const kind = invoicePanelKind({
    loading: invoices.loading,
    error: invoices.error,
    data: invoices.data,
  });
  const rows = invoices.data?.items ?? [];
  const total = invoices.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / CASE_INVOICES_PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * CASE_INVOICES_PAGE_SIZE + 1;
  const to = Math.min(total, (page - 1) * CASE_INVOICES_PAGE_SIZE + rows.length);

  if (kind === 'loading') {
    return (
      <SkeletonRegion busy label="Loading invoices">
        <Skeleton variant="rect" height="160px" radius="panel" />
      </SkeletonRegion>
    );
  }
  if (kind === 'error') {
    return (
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
    );
  }
  if (kind === 'empty') {
    return (
      <EmptyState
        size="panel"
        icon="receipt"
        title="No invoices on this case"
        description="Unpaid CMP invoices appear here when the finder attaches them."
      />
    );
  }

  return (
    <>
      {invoices.error ? (
        <div className="cc-banner" data-tone="danger" role="alert">
          <span className="cc-banner-title">Could not load invoices</span>
          <p className="cc-banner-body">{String(invoices.error)}</p>
          <Button variant="secondary" size="sm" onClick={() => void invoices.reload()}>
            Retry
          </Button>
        </div>
      ) : null}
      <DataTable<CollectionInvoiceRow>
        caption="Unpaid invoices on this case"
        rows={rows}
        rowKey={(inv) => inv.id}
        columns={columns}
        density="compact"
        empty="No invoices on this case."
      />
      <div className="cc-foot">
        <span className="cc-foot-count">
          Showing{' '}
          <strong className="num">
            {from}–{to}
          </strong>{' '}
          of <strong className="num">{total}</strong>
        </span>
        <Pagination
          page={page}
          pageCount={pageCount}
          onPageChange={onPage}
          pageSize={CASE_INVOICES_PAGE_SIZE}
          total={total}
          itemLabel="invoices"
          size="sm"
        />
      </div>
    </>
  );
}

function Fact({ k, children }: { k: string; children: string }) {
  return (
    <div className="cc-dl-row">
      <dt>{k}</dt>
      <dd className="num">{children}</dd>
    </div>
  );
}

function addressOf(row: {
  debtorAddress: string | null;
  debtorCity: string | null;
  debtorState: string | null;
  debtorZipCode: string | null;
}): string {
  const line = [row.debtorAddress, [row.debtorCity, row.debtorState].filter(Boolean).join(', '), row.debtorZipCode]
    .filter(Boolean)
    .join(' · ');
  return line || '—';
}
