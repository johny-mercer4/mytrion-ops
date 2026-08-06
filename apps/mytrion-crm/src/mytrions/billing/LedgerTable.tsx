/**
 * The ONE table that renders all five balance sections.
 *
 * The sections are isomorphic — they differ only in an extra Billing Cycle column (unbilled), the
 * reconciliation caption, and an aging footer (AR) — so a config array drives one component rather than
 * five near-copies of the same skeleton + pagination + empty/error + amount-cell markup.
 *
 * Two things this component refuses to do:
 *   • Render a fabricated Closing. A row whose `opening` is null shows `—` with a click-to-fix caption,
 *     because the server deliberately did not invent a zero.
 *   • Trust its own arithmetic over the server's. It asserts `closing === opening + debit − credit` and
 *     surfaces an `imbalance` caption if they ever disagree — a cheap guard against a silent
 *     aggregation bug in a tool whose whole job is reconciliation.
 *
 * Every amount cell is a real `<button>`, so the drill-down is keyboard-reachable and gets a focus ring
 * with no extra a11y machinery.
 */
import { useEffect, useMemo, useState } from 'react';

import { fetchLedgerSection } from '../../api/billing';
import type {
  LedgerSectionId,
  LedgerSectionRow,
  LedgerSectionResponse,
} from '../../api/ledgerTypes';
import { fmtCycle } from './data';
import { useLoad } from '../_shared/useLoad';
import type { LedgerFilters } from './Ledger';
import { fmtMoney, formatYmd, toWireRange, type LedgerRange } from './ledgerModel';

const P_ERROR = 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';

/** Which amount column was clicked — the modal tints the matching header so the link is obvious. */
export type AmountColumn = 'opening' | 'debit' | 'credit' | 'closing';

export interface StatementTarget {
  carrierId: string;
  companyName: string;
  section: LedgerSectionId;
  column: AmountColumn;
}

const PAGE_SIZE = 50;

const LEDGER_LABELS: Record<LedgerSectionId, string> = {
  'cb-loc': 'Customer Balance (LOC)',
  unbilled: 'Unbilled Transactions',
  ar: 'Accounts Receivable',
  'cb-prepay': 'Customer Balance (Prepay)',
  untopped: 'Un Top-Upped Payments',
};

/**
 * A schema-readiness 503 is a deployment state, not a transient fault — "Try Again" will fail
 * identically until someone applies the migration, so the UI offers an instruction instead of a button.
 */
function isSetupError(message: string | null): boolean {
  return Boolean(message && /being set up|not.*ready|LEDGER_SCHEMA/i.test(message));
}

export function LedgerTable({
  section,
  range,
  filters,
  onOpenStatement,
  onFixOpening,
  canWrite,
}: {
  section: LedgerSectionId;
  range: LedgerRange;
  filters: LedgerFilters;
  onOpenStatement: (t: StatementTarget) => void;
  onFixOpening: (carrierId: string) => void;
  canWrite: boolean;
}) {
  const [page, setPage] = useState(1);
  const [missingOnly, setMissingOnly] = useState(false);

  const wire = toWireRange(range);
  // Only `applied` range values reach here (the period bar is Apply-gated), so this dep list is stable
  // between Applies and a keystroke in the period inputs cannot trigger a recompute.
  const load = useLoad<LedgerSectionResponse>(
    () =>
      fetchLedgerSection(section, wire, {
        page,
        limit: PAGE_SIZE,
        ...(filters.carrierId.trim() || filters.company.trim()
          ? { search: (filters.carrierId.trim() || filters.company.trim()) }
          : {}),
        ...(missingOnly ? { missingOpeningOnly: true } : {}),
      }),
    [section, wire.startDate, wire.endDate, page, filters.carrierId, filters.company, missingOnly],
  );

  // A filter or period change invalidates the page number.
  useEffect(() => {
    setPage(1);
  }, [section, wire.startDate, wire.endDate, filters.carrierId, filters.company, missingOnly]);

  const data = load.data;
  const rows = data?.rows ?? [];

  /** Billing Cycle is a real column only where the section actually varies by it. */
  const showCycle = section === 'unbilled';

  const cycleFiltered = useMemo(() => {
    const q = filters.billingCycle.trim().toLowerCase();
    if (!q || !showCycle) return rows;
    return rows.filter((r) => fmtCycle(r.billingCycle).toLowerCase().includes(q));
  }, [rows, filters.billingCycle, showCycle]);

  const pageCount = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const initialLoading = load.loading && !data;

  const header = (
    <div className="db-list-header lg-section-header">
      <div className="db-col-carrier">Carrier</div>
      <div className="db-col-company">Client</div>
      {showCycle ? <div className="lg-col-cycle">Billing cycle</div> : null}
      <div className="lg-col-amt">Opening</div>
      <div className="lg-col-amt">Debit</div>
      <div className="lg-col-amt">Credit</div>
      <div className="lg-col-amt lg-col-closing">Closing</div>
    </div>
  );

  const failed = Boolean(load.error) && !data;
  /** How many rows actually contributed a closing balance — 0 means the total is meaningless. */
  const closedRows = data ? data.totals.carriers - data.totals.missingOpening : 0;

  return (
    <>
      {/* ── KPI strip: the section totals, plus the migration backlog kept visible ──
          Suppressed entirely on a failed load: skeletons above an error message read as a band of
          empty boxes and push the actual explanation down the page. */}
      {failed ? null : (
      <div className="db-kpi-grid">
        {data ? (
          <>
            <div className="db-kpi-card">
              <div className="db-kpi-title">Clients</div>
              <div className="db-kpi-value">{data.totals.carriers}</div>
              <div className="lg-kpi-sub">
                {data.clientType} · {data.total} shown
              </div>
            </div>
            <div className="db-kpi-card">
              <div className="db-kpi-title">Debit</div>
              <div className="db-kpi-value">{fmtMoney(data.totals.debit)}</div>
              <div className="lg-kpi-sub">{sectionDebitLabel(section)}</div>
            </div>
            <div className="db-kpi-card">
              <div className="db-kpi-title">Credit</div>
              <div className="db-kpi-value">{fmtMoney(data.totals.credit)}</div>
              <div className="lg-kpi-sub">{sectionCreditLabel(section)}</div>
            </div>
            <div className="db-kpi-card">
              <div className="db-kpi-title">Closing</div>
              {/*
                When NO row could state a closing balance, the total is 0 only because nothing was
                summed — rendering "$0.00" there reads as "the book balances", which is the opposite of
                the truth. Show the same em dash the rows show.
              */}
              <div
                className={`db-kpi-value${
                  closedRows > 0 && data.shouldTrendToZero && Math.abs(data.totals.closing) > 0.005
                    ? ' text-warning'
                    : ''
                }`}
              >
                {closedRows > 0 ? fmtMoney(data.totals.closing) : '—'}
              </div>
              <div className="lg-kpi-sub">
                {closedRows === 0
                  ? 'no client has an opening balance yet'
                  : data.shouldTrendToZero
                    ? 'should trend to zero'
                    : `vs ${externalLabel(data.externalSource)}`}
              </div>
            </div>
            {/* A partly-migrated book must not present a total that silently omits carriers. */}
            <button
              type="button"
              className={`db-kpi-card lg-kpi-clickable${missingOnly ? ' lg-kpi-active' : ''}`}
              onClick={() => setMissingOnly((v) => !v)}
              title="Show only clients with no opening balance"
            >
              <div className="db-kpi-title">No opening balance</div>
              <div className={`db-kpi-value${data.totals.missingOpening ? ' text-danger' : ''}`}>
                {data.totals.missingOpening}
              </div>
              <div className="lg-kpi-sub">
                {data.totals.missingOpening
                  ? 'excluded from the totals above'
                  : 'every client has one'}
              </div>
            </button>
          </>
        ) : (
          Array.from({ length: 5 }, (_, i) => (
            <div className="db-kpi-card" key={`kskel-${i}`} aria-hidden>
              <div className="bm-skeleton" style={{ height: 11, width: 80 }} />
              <div className="bm-skeleton" style={{ height: 20, width: 96, marginTop: 8 }} />
            </div>
          ))
        )}
      </div>
      )}

      {data && data.totals.missingOpening > 0 ? (
        <div className="lg-exclusion-note">
          {data.totals.missingOpening} client{data.totals.missingOpening === 1 ? '' : 's'} have no
          opening balance for this section, so no closing balance can be stated for them — their Debit
          and Credit are still shown.
        </div>
      ) : null}

      {/* ── Rows ── */}
      {initialLoading ? (
        <div className="db-content-area" aria-busy="true" aria-label="Computing the ledger">
          {/* A full-book compute can run for tens of seconds over a WAN. A bare skeleton that long reads
              as a hung page, so say what is happening. */}
          <div className="lg-computing" role="status">
            Computing {LEDGER_LABELS[section]} for {formatYmd(range.from)} – {formatYmd(range.to)} across
            every {section.startsWith('cb-prepay') || section === 'untopped' ? 'Prepay' : 'LOC'} client…
          </div>
          {header}
          {Array.from({ length: 8 }, (_, i) => (
            <div className="db-row-item" key={`skel-${i}`} aria-hidden>
              <div className="db-row-main lg-section-row" style={{ pointerEvents: 'none' }}>
                <div className="db-col-carrier">
                  <div className="bm-skeleton" style={{ height: 11, width: 62 }} />
                </div>
                <div className="db-col-company">
                  <div className="bm-skeleton" style={{ height: 11, width: 170 }} />
                  {/* Second line too — the breakdown subnote makes rows taller, so a one-line
                      skeleton would make every row jump when the data lands. */}
                  <div className="bm-skeleton" style={{ height: 9, width: 120, marginTop: 5 }} />
                </div>
                {showCycle ? (
                  <div className="lg-col-cycle">
                    <div className="bm-skeleton" style={{ height: 11, width: 60 }} />
                  </div>
                ) : null}
                {['o', 'd', 'c', 'x'].map((k) => (
                  <div className="lg-col-amt" key={k}>
                    <div className="bm-skeleton" style={{ height: 11, width: 64, marginLeft: 'auto' }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : failed ? (
        <div className="db-error-state">
          <svg width="26" height="26" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d={P_ERROR} />
          </svg>
          <div className="db-error-msg">{load.error}</div>
          {/* Retrying a not-yet-created table just fails again — say what actually unblocks it. */}
          {isSetupError(load.error) ? (
            <div className="lg-error-hint">
              The ledger&rsquo;s tables have not been created in this environment yet. Ask R&amp;D to apply
              the pending database migration, then reload.
            </div>
          ) : (
            <button className="bm-refresh-btn" onClick={() => void load.reload()}>
              Try Again
            </button>
          )}
        </div>
      ) : cycleFiltered.length === 0 ? (
        <div className="db-empty-state">
          {missingOnly
            ? 'Every client in this section has an opening balance.'
            : 'No clients match the current filters.'}
        </div>
      ) : (
        <div className="db-content-area">
          {header}
          {cycleFiltered.map((row) => (
            <SectionRow
              key={row.carrierId}
              row={row}
              showCycle={showCycle}
              shouldTrendToZero={data?.shouldTrendToZero ?? false}
              externalSource={data?.externalSource ?? ''}
              canWrite={canWrite}
              onOpenStatement={onOpenStatement}
              onFixOpening={onFixOpening}
            />
          ))}
        </div>
      )}

      {pageCount > 1 ? (
        <div className="db-pagination">
          <span className="db-page-info">
            Page {page} of {pageCount} · {data?.total ?? 0} clients
          </span>
          <div className="db-page-actions">
            <button className="db-page-btn" disabled={page <= 1 || load.loading} onClick={() => setPage((p) => p - 1)}>
              Prev
            </button>
            <span className="db-page-current">{page}</span>
            <button
              className="db-page-btn"
              disabled={page >= pageCount || load.loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SectionRow({
  row,
  showCycle,
  shouldTrendToZero,
  externalSource,
  canWrite,
  onOpenStatement,
  onFixOpening,
}: {
  row: LedgerSectionRow;
  showCycle: boolean;
  shouldTrendToZero: boolean;
  externalSource: string;
  canWrite: boolean;
  onOpenStatement: (t: StatementTarget) => void;
  onFixOpening: (carrierId: string) => void;
}) {
  const open = (column: AmountColumn): void =>
    onOpenStatement({
      carrierId: row.carrierId,
      companyName: row.companyName,
      section: row.section,
      column,
    });

  /**
   * Independent check on the server's arithmetic. Not defensive padding — in a reconciliation tool a
   * silent aggregation bug produces numbers that look right, so it is worth one subtraction to catch.
   */
  const imbalance =
    row.opening !== null && row.closing !== null
      ? Math.round((row.opening + row.debit - row.credit - row.closing) * 100) / 100
      : 0;

  const breakdown = Object.entries(row.components)
    .filter(([, v]) => Math.abs(v) > 0.005)
    .map(([k, v]) => `${k} ${fmtMoney(v)}`)
    .join(' · ');

  const cell = (column: AmountColumn, value: number | null, extraClass = ''): JSX.Element => (
    <div className={`lg-col-amt ${extraClass}`}>
      <button
        type="button"
        className={`lg-amt${column === 'closing' ? ' lg-amt-closing' : ''}`}
        onClick={() => open(column)}
        title={`Open the ${column} statement for ${row.companyName || row.carrierId}`}
      >
        {fmtMoney(value)}
      </button>
    </div>
  );

  return (
    <div className="db-row-item">
      <div className="db-row-main lg-section-row">
        <div className="db-col-carrier">
          <span className="db-carrier-id">{row.carrierId}</span>
        </div>
        <div className="db-col-company">
          <span className="db-company-name">{row.companyName || '—'}</span>
          {breakdown ? <span className="lg-breakdown">{breakdown}</span> : null}
        </div>
        {showCycle ? (
          <div className="lg-col-cycle">
            <span className="lg-cycle-tag">{fmtCycle(row.billingCycle) || '—'}</span>
          </div>
        ) : null}
        {cell('opening', row.opening)}
        {cell('debit', row.debit)}
        {cell('credit', row.credit)}
        <div className="lg-col-amt lg-col-closing">
          <button
            type="button"
            className="lg-amt lg-amt-closing"
            onClick={() => open('closing')}
            title={`Open the closing statement for ${row.companyName || row.carrierId}`}
          >
            {fmtMoney(row.closing)}
          </button>
          <ReconCaption
            row={row}
            imbalance={imbalance}
            shouldTrendToZero={shouldTrendToZero}
            externalSource={externalSource}
            canWrite={canWrite}
            onFixOpening={onFixOpening}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The caption under Closing. Deliberately does NOT claim a ✓ against EFS/CMP — that is a factual
 * assertion about an external system, and until the reconciliation pass compares them the honest
 * caption says what the closing WILL be checked against, not that it matched.
 */
function ReconCaption({
  row,
  imbalance,
  shouldTrendToZero,
  externalSource,
  canWrite,
  onFixOpening,
}: {
  row: LedgerSectionRow;
  imbalance: number;
  shouldTrendToZero: boolean;
  externalSource: string;
  canWrite: boolean;
  onFixOpening: (carrierId: string) => void;
}) {
  if (Math.abs(imbalance) > 0.005) {
    return <span className="lg-recon lg-recon--error">imbalance {fmtMoney(imbalance)}</span>;
  }

  if (row.opening === null) {
    if (row.openingSource === 'predates-inception') {
      return (
        <span className="lg-recon lg-recon--warn">
          starts {row.openingAsOf ? formatYmd(row.openingAsOf) : 'later'}
        </span>
      );
    }
    // The gap is discovered HERE, so this is where it gets fixed.
    return canWrite ? (
      <button type="button" className="lg-recon lg-recon--warn lg-recon-btn" onClick={() => onFixOpening(row.carrierId)}>
        no opening balance — add
      </button>
    ) : (
      <span className="lg-recon lg-recon--warn">no opening balance</span>
    );
  }

  if (shouldTrendToZero) {
    return Math.abs(row.closing ?? 0) <= 0.005 ? (
      <span className="lg-recon lg-recon--ok">fully cleared</span>
    ) : (
      <span className="lg-recon lg-recon--warn">outstanding — awaiting the next cycle</span>
    );
  }

  return (
    <span className="lg-recon lg-recon--none">
      {row.openingSource === 'rolled-forward' ? 'carried forward · ' : ''}
      to check vs {externalLabel(externalSource)}
    </span>
  );
}

function externalLabel(source: string): string {
  switch (source) {
    case 'efs':
      return 'EFS';
    case 'cmp_invoice':
      return 'CMP invoices';
    case 'cmp_balance_after':
      return 'CMP balance';
    case 'payments_unapplied':
      return 'unapplied payments';
    default:
      return source || 'the source system';
  }
}

function sectionDebitLabel(section: LedgerSectionId): string {
  switch (section) {
    case 'cb-loc':
    case 'cb-prepay':
      return 'top-ups net of draws';
    case 'unbilled':
      return 'fuel + money code + maintenance';
    case 'ar':
      return 'invoices issued';
    case 'untopped':
      return 'payments received';
  }
}

function sectionCreditLabel(section: LedgerSectionId): string {
  switch (section) {
    case 'cb-loc':
    case 'cb-prepay':
      return 'fuel + money code + maintenance';
    case 'unbilled':
      return 'amount invoiced';
    case 'ar':
      return 'payments applied';
    case 'untopped':
      return 'top-ups applied';
  }
}
