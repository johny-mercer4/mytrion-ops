/**
 * One carrier's full verification detail — read-only (the DWH can't be written).
 *
 * Payment facts render instantly from the roster row. Identity/contact fills in after a per-carrier
 * fetch. Prepay clients never show credit score or minimum balance — those fields are omitted, not
 * dashed. Built on `ds/Dialog` so focus is trapped, Escape/backdrop work, and the header/footer
 * stay put while the body scrolls.
 */
import { useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Dialog } from '@/ds';
import type { VerificationClientDetail, VerificationClientRow } from '../../api/verificationClients';
import { AggregatorMark } from './verificationAggregators';
import { useVerificationClientDetail } from './verificationData';
import { dash, isPrepayTerms, money } from './verificationFormat';

/**
 * How many <Field> rows the loaded "Contact & identity" grid renders — keep in step with the <dl>
 * below. Height per row is the shared --vf-field-h, so skeleton and loaded grid agree.
 */
const DETAIL_FIELD_COUNT = 11;

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'accent' | undefined;
}) {
  return (
    <div className={`vf-stat${tone ? ` is-${tone}` : ''}`}>
      <span className="vf-stat-l">{label}</span>
      <span className="vf-stat-v">{value}</span>
    </div>
  );
}

export function VerificationClientModal({
  client,
  open,
  onClose,
}: {
  client: VerificationClientRow;
  open: boolean;
  onClose: () => void;
}) {
  const detail = useVerificationClientDetail(open ? client.carrierId : null);
  const lastDetail = useRef<VerificationClientDetail | null>(null);
  if (detail.data && detail.data.carrierId === client.carrierId) lastDetail.current = detail.data;
  const cached = lastDetail.current?.carrierId === client.carrierId ? lastDetail.current : null;
  const d = detail.data ?? cached;
  const isLoc = client.paymentTerms === 'LOC';
  const prepay = isPrepayTerms(client.paymentTerms);
  const lastActivity = d?.lastTransactionAt ?? client.lastTransactionAt;

  const subtitle = [
    `#${client.carrierId}`,
    d?.dot ? `DOT ${d.dot}` : null,
    client.isActive ? null : 'Inactive',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Dialog
      open={open}
      size="lg"
      mobile="sheet"
      title={client.companyName}
      subtitle={subtitle}
      onClose={() => onClose()}
      closeLabel="Close client detail"
      data-mytrion="verification"
      footer={
        <Button variant="secondary" onClick={() => onClose()}>
          Close
        </Button>
      }
    >
      <div className="vf-modal-body">
        <div className="vf-modal-flags">
          {client.companyType ? <AggregatorMark companyType={client.companyType} /> : null}
          {client.paymentTerms ? (
            <span className={`vf-tag${isLoc ? ' vf-tag-loc' : prepay ? ' vf-tag-prepay' : ''}`}>
              {client.paymentTerms}
            </span>
          ) : null}
          {client.isDebtor ? (
            <span className="vf-tag vf-tag-danger">
              <AlertTriangle size={12} aria-hidden="true" />
              Flagged as a debtor
            </span>
          ) : null}
        </div>

        <section className="vf-section">
          <h3 className="vf-section-title">Payment &amp; verification</h3>
          <div className="vf-stat-grid">
            <Stat label="Aggregator" value={dash(client.companyType.replace(/_/g, ' ') || null)} />
            <Stat label="Payment terms" value={dash(client.paymentTerms)} tone={isLoc ? 'accent' : undefined} />
            <Stat label="Payment day" value={dash(client.paymentDay)} />
            {prepay ? null : (
              <Stat label="Minimum required balance" value={money(client.minimumRequiredBalance)} />
            )}
            <Stat label="Billing cycle tag" value={dash(client.billingCycleTag)} />
            <Stat
              label="Debtor flag"
              value={client.isDebtor ? 'Yes' : 'No'}
              tone={client.isDebtor ? 'danger' : undefined}
            />
            <Stat label="Billing cycle" value={dash(client.billingCycle)} />
            {isLoc ? <Stat label="Credit limit" value={money(client.creditLimit)} tone="accent" /> : null}
            {prepay ? null : <Stat label="Credit score" value={dash(client.creditScore)} />}
            <Stat label="Last activity" value={dash(lastActivity)} />
          </div>
        </section>

        <section className="vf-section">
          <h3 className="vf-section-title">Contact &amp; identity</h3>
          {detail.loading && !d ? (
            <div className="vf-detail-grid" aria-busy="true" aria-label="Loading contact detail">
              {Array.from({ length: DETAIL_FIELD_COUNT }, (_, i) => (
                <div key={i} className="vf-sk vf-sk-field" />
              ))}
            </div>
          ) : detail.error && !d ? (
            <p className="vf-banner-error" role="alert">
              {detail.error}
            </p>
          ) : (
            <dl className="vf-detail-grid">
              <Field label="Contact" value={d?.contact} />
              <Field label="Phone" value={d?.phone} mono />
              <Field label="Email" value={d?.email} mono />
              <Field label="Agent" value={d?.agentName} />
              <Field label="Agent email" value={d?.agentEmail} mono />
              <Field label="Address" value={d?.address} />
              <Field label="Money code" value={d?.moneyCode} mono />
              <Field label="Insurance" value={d?.insuranceCoverage} />
              <Field label="CreditSafe grade" value={d?.creditsafeGrade} />
              <Field label="First swipe" value={d?.firstSwipeAt} mono />
              <Field label="Last transaction" value={d?.lastTransactionAt ?? client.lastTransactionAt} mono />
            </dl>
          )}
        </section>
      </div>
    </Dialog>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | null | undefined;
  mono?: boolean;
}) {
  const text = (value ?? '').trim();
  return (
    <div className="vf-field">
      <dt>{label}</dt>
      <dd className={mono ? 'vf-mono' : undefined}>{text || '—'}</dd>
    </div>
  );
}
