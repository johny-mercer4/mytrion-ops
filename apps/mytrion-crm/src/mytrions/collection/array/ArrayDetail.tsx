/**
 * One Array tradeline — what we reported to the bureau, and what came back.
 *
 * WHAT CHANGED. This was four `<dl>` grids of 24 label/value rows, a third of them em-dashes,
 * with everything weighted the same. Three things now carry the screen instead:
 *
 *   1. FILING HEALTH first. `excluded_reason` / `validation_errors` were rows fourteen and
 *      fifteen of the last grid; they are the only fields that mean something is WRONG, so they
 *      are a banner at the top or they are absent.
 *   2. The payment history profile is drawn as 24 months instead of printed as
 *      `000000000000BBBBBBBBBBBB`. It is the densest field on the record and it was unreadable.
 *   3. The money is a figure row, not a list — four amounts a collector compares at a glance.
 *
 * The tradeline and the collection case are two halves of one carrier and were never linked;
 * the header now offers the case.
 */
import { useCallback } from 'react';
import { Badge, Button, Icon, Skeleton, SkeletonRegion } from '@/ds';
import { getArrayReport, listCollectionCases } from '@/api/collection';
import { useCachedLoad } from '../../_shared/swrCache';
import { fmtDate, moneyExact } from '../collectionFormat';
import { accountStatusLabel, reportInitials, reportName } from './arrayModel';
import { PaymentHistoryStrip } from './PaymentHistoryStrip';
import '../cases/cases.css';
import '../cases/caseDetail.css';
import './array.css';

export function ArrayDetail({
  reportId,
  onBack,
  onOpenCase,
}: {
  reportId: string;
  onBack: () => void;
  /** Absent when the caller has nowhere to send them — the link is then not offered. */
  onOpenCase?: (caseId: string) => void;
}) {
  const load = useCallback(() => getArrayReport(reportId), [reportId]);
  const feed = useCachedLoad(`collection:array:${reportId}`, load);
  const row = feed.data?.report ?? null;
  const name = row ? reportName(row) : 'Array report';

  // The case for this carrier, if there is one. A search rather than a lookup because the API has
  // no by-carrier route; the exact match below is what makes a fuzzy search safe to act on.
  const carrierId = row?.carrierId ?? '';
  const loadCase = useCallback(
    () => listCollectionCases({ search: carrierId, limit: 5 }),
    [carrierId],
  );
  const cases = useCachedLoad(`collection:array:${reportId}:case`, loadCase, {
    enabled: Boolean(carrierId),
  });
  const linkedCase = cases.data?.items.find((c) => c.carrierId === carrierId) ?? null;

  const excluded = row?.validationErrors ?? row?.excludedReason ?? null;

  return (
    <div className="cc-case ar-detail">
      <section className="cc-case-head">
        <div className="cc-crumbs">
          <Button variant="secondary" size="sm" icon="chevron_left" onClick={onBack}>
            All reports
          </Button>
          <span className="cc-crumb">Array report</span>
          <Icon name="chevron_right" size="sm" className="cc-crumb-sep" />
          <span className="cc-crumb-current">{name}</span>
          <span className="cc-crumbs-gap" />
          {row?.customerAccountNumber ? (
            <span className="cc-case-id num">ACCT {row.customerAccountNumber}</span>
          ) : null}
        </div>

        {feed.error ? (
          <div className="cc-banner" data-tone="danger" role="alert">
            <span className="cc-banner-title">Could not load this report</span>
            <p className="cc-banner-body">{String(feed.error)}</p>
            <Button variant="secondary" size="sm" onClick={() => void feed.reload()}>
              Retry
            </Button>
          </div>
        ) : null}

        {feed.loading && !row ? (
          <SkeletonRegion busy label="Loading the Array report">
            <Skeleton variant="rect" height="112px" radius="panel" />
            <Skeleton variant="rect" height="220px" radius="panel" />
          </SkeletonRegion>
        ) : row ? (
          <>
            <div className="cc-case-identity">
              <div className="cc-case-who">
                <span className="cc-mono cc-mono-lg" aria-hidden="true">
                  {reportInitials(row)}
                </span>
                <div className="cc-case-titles">
                  <div className="cc-case-title-row">
                    <h1 className="cc-case-name">{name}</h1>
                    <Badge intent="neutral" icon="calendar_month">
                      {row.reportPeriod}
                    </Badge>
                    {row.accountStatus ? (
                      <Badge intent={row.dateClosed ? 'neutral' : 'info'}>
                        {row.accountStatus} · {accountStatusLabel(row.accountStatus)}
                      </Badge>
                    ) : null}
                    {row.needsDobLookup ? (
                      <Badge intent="warning" icon="warning">
                        Needs DOB
                      </Badge>
                    ) : null}
                  </div>
                  <div className="cc-case-facts">
                    <Fact k="Carrier">{row.carrierId}</Fact>
                    <Fact k="Opened">{fmtDate(row.dateOpen)}</Fact>
                    <Fact k="First delinquent">{fmtDate(row.dateOfFirstDelinquency)}</Fact>
                    <Fact k="Agency">{row.agencyName ?? 'Unplaced'}</Fact>
                    <Fact k="Reported">{fmtDate(row.lastSyncedAt)}</Fact>
                  </div>
                </div>
              </div>
              {linkedCase && onOpenCase ? (
                <div className="cc-case-cta">
                  <Button
                    variant="secondary"
                    icon="arrow_forward"
                    onClick={() => onOpenCase(linkedCase.id)}
                  >
                    Open the collection case
                  </Button>
                </div>
              ) : null}
            </div>

            {/* The only fields on this record that say something is wrong. Top, or absent. */}
            {excluded ? (
              <div className="cc-banner" data-tone="danger" role="alert">
                <span className="cc-banner-title">
                  Excluded from the {row.reportPeriod} filing
                </span>
                <p className="cc-banner-body">
                  {excluded} — until this is fixed on the carrier record the tradeline stays out of
                  the next file too, and nothing else reports that it is missing.
                </p>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      {row ? (
        <>
          <section className="cc-pane">
            <header className="cc-pane-head">
              <h2 className="cc-pane-title">Reported position</h2>
              <span className="cc-pane-meta">
                Metro 2 account type <span className="num">{row.accountType ?? '—'}</span>
                {row.paymentRating ? (
                  <>
                    {' '}
                    · payment rating <span className="num">{row.paymentRating}</span>
                  </>
                ) : null}
              </span>
            </header>

            <div className="ar-figures">
              <Figure k="Current balance" v={moneyExact(row.currentBalance)} strong />
              <Figure k="Amount past due" v={moneyExact(row.amountPastDue)} strong />
              <Figure k="Credit limit" v={moneyExact(row.creditLimit)} />
              <Figure k="Highest credit" v={moneyExact(row.highestCredit)} />
              <Figure k="Last payment" v={fmtDate(row.dateOfLastPayment)} />
              <Figure
                k="Months delinquent"
                v={row.monthsDelinquent == null ? '—' : String(row.monthsDelinquent)}
              />
            </div>

            <PaymentHistoryStrip
              profile={row.paymentHistoryProfile}
              reportPeriod={row.reportPeriod}
            />
          </section>

          <div className="ar-detail-cols">
            <section className="cc-pane">
              <h2 className="cc-pane-title">Identity as reported</h2>
              <dl className="cc-dl cc-dl-1">
                <Row k="Name">{[row.firstName, row.lastName].filter(Boolean).join(' ') || '—'}</Row>
                <Row k="Date of birth">{fmtDate(row.dateOfBirth)}</Row>
                <Row k="Phone">{row.telephoneNumber ?? '—'}</Row>
                <Row k="Email">{row.email ?? '—'}</Row>
                <Row k="City / state">{[row.city, row.state].filter(Boolean).join(', ') || '—'}</Row>
                <Row k="ZIP">{row.zipCode ?? '—'}</Row>
              </dl>
              {row.needsDobLookup ? (
                <p className="ar-note">
                  Array rejects a consumer tradeline with no date of birth. This one is flagged for
                  lookup and will not file until it has one.
                </p>
              ) : null}
            </section>

            <section className="cc-pane">
              <h2 className="cc-pane-title">Placement</h2>
              <dl className="cc-dl cc-dl-1">
                <Row k="Agency">{row.agencyName ?? 'Unplaced'}</Row>
                <Row k="Placed">{fmtDate(row.placementDate)}</Row>
                <Row k="Closed">{fmtDate(row.dateClosed)}</Row>
                <Row k="Account number">{row.customerAccountNumber ?? '—'}</Row>
                <Row k="Carrier type">{row.carrierType ?? '—'}</Row>
              </dl>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Fact({ k, children }: { k: string; children: string }) {
  return (
    <span className="cc-fact">
      <span className="t-eyebrow">{k}</span>
      <span className="cc-fact-v num" data-empty={children === '—' ? 'true' : undefined}>
        {children}
      </span>
    </span>
  );
}

/** A money or date figure. `strong` is the two a collector is actually comparing. */
function Figure({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="ar-figure" data-strong={strong ? 'true' : undefined}>
      <span className="t-eyebrow">{k}</span>
      <span className="ar-figure-v num">{v}</span>
    </div>
  );
}

function Row({ k, children }: { k: string; children: string }) {
  return (
    <div className="cc-dl-row">
      <dt>{k}</dt>
      <dd className="num" data-empty={children === '—' ? 'true' : undefined}>
        {children}
      </dd>
    </div>
  );
}
