/**
 * One Array tradeline — identity, Metro 2, balances, agency. Read-only snapshot.
 */
import { useCallback } from 'react';
import { Badge, Button, Icon, Skeleton, SkeletonRegion } from '@/ds';
import { getArrayReport } from '@/api/collection';
import { useCachedLoad } from '../../_shared/swrCache';
import { fmtDate, moneyExact } from '../collectionFormat';
import { accountStatusLabel, reportInitials, reportName } from './arrayModel';
import '../cases/cases.css';
import './array.css';

export function ArrayDetail({ reportId, onBack }: { reportId: string; onBack: () => void }) {
  const load = useCallback(() => getArrayReport(reportId), [reportId]);
  const feed = useCachedLoad(`collection:array:${reportId}`, load);
  const row = feed.data?.report ?? null;
  const name = row ? reportName(row) : 'Array report';

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
          </SkeletonRegion>
        ) : row ? (
          <div className="cc-case-identity">
            <div className="cc-case-who">
              <span className="cc-mono" aria-hidden="true">
                {reportInitials(row)}
              </span>
              <div className="cc-case-titles">
                <div className="cc-case-title-row">
                  <h1 className="cc-case-name">{name}</h1>
                  <Badge intent={row.needsDobLookup ? 'warning' : 'neutral'} icon="calendar_month">
                    {row.reportPeriod}
                  </Badge>
                  {row.accountStatus ? (
                    <Badge intent="info">{accountStatusLabel(row.accountStatus)}</Badge>
                  ) : null}
                </div>
                <div className="cc-case-facts">
                  <span className="cc-fact">
                    <span className="t-eyebrow">Carrier</span>
                    <span className="cc-fact-v num">{row.carrierId}</span>
                  </span>
                  <span className="cc-fact">
                    <span className="t-eyebrow">Balance</span>
                    <span className="cc-fact-v num">{moneyExact(row.currentBalance)}</span>
                  </span>
                  <span className="cc-fact">
                    <span className="t-eyebrow">Past due</span>
                    <span className="cc-fact-v num">{moneyExact(row.amountPastDue)}</span>
                  </span>
                  <span className="cc-fact">
                    <span className="t-eyebrow">Agency</span>
                    <span className="cc-fact-v">{row.agencyName ?? 'Unplaced'}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {row ? (
        <div className="cc-panes">
          <section className="cc-pane">
            <h2 className="cc-pane-title">Metro 2</h2>
            <dl className="cc-dl">
              <Row k="Account status">{accountStatusLabel(row.accountStatus)}</Row>
              <Row k="Account type">{row.accountType ?? '—'}</Row>
              <Row k="Payment rating">{row.paymentRating ?? '—'}</Row>
              <Row k="Payment history">{row.paymentHistoryProfile ?? '—'}</Row>
              <Row k="Date open">{fmtDate(row.dateOpen)}</Row>
              <Row k="DOFD">{fmtDate(row.dateOfFirstDelinquency)}</Row>
            </dl>
          </section>
          <section className="cc-pane">
            <h2 className="cc-pane-title">Balances</h2>
            <dl className="cc-dl">
              <Row k="Current">{moneyExact(row.currentBalance)}</Row>
              <Row k="Past due">{moneyExact(row.amountPastDue)}</Row>
              <Row k="Credit limit">{moneyExact(row.creditLimit)}</Row>
              <Row k="Highest credit">{moneyExact(row.highestCredit)}</Row>
              <Row k="Last payment">{fmtDate(row.dateOfLastPayment)}</Row>
              <Row k="Months delinquent">{row.monthsDelinquent == null ? '—' : String(row.monthsDelinquent)}</Row>
            </dl>
          </section>
          <section className="cc-pane">
            <h2 className="cc-pane-title">Identity</h2>
            <dl className="cc-dl">
              <Row k="Name">{[row.firstName, row.lastName].filter(Boolean).join(' ') || '—'}</Row>
              <Row k="Email">{row.email ?? '—'}</Row>
              <Row k="Phone">{row.telephoneNumber ?? '—'}</Row>
              <Row k="City / state">{[row.city, row.state].filter(Boolean).join(', ') || '—'}</Row>
              <Row k="Date of birth">{fmtDate(row.dateOfBirth)}</Row>
              <Row k="Needs DOB">{row.needsDobLookup ? 'Yes' : 'No'}</Row>
            </dl>
          </section>
          <section className="cc-pane">
            <h2 className="cc-pane-title">Placement</h2>
            <dl className="cc-dl">
              <Row k="Agency">{row.agencyName ?? 'Unplaced'}</Row>
              <Row k="Placed">{fmtDate(row.placementDate)}</Row>
              <Row k="Closed">{fmtDate(row.dateClosed)}</Row>
              <Row k="Account #">{row.customerAccountNumber ?? '—'}</Row>
              <Row k="Excluded">{row.excludedReason ?? '—'}</Row>
              <Row k="Synced">{fmtDate(row.lastSyncedAt)}</Row>
            </dl>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Row({ k, children }: { k: string; children: string }) {
  return (
    <div className="cc-dl-row">
      <dt>{k}</dt>
      <dd className="num">{children}</dd>
    </div>
  );
}
