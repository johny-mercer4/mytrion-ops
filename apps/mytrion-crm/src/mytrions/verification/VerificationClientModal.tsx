/**
 * One carrier's full verification detail — read-only (the DWH can't be written, and there is nothing
 * here for a reviewer to edit; this is a decisioning REFERENCE, not a record editor).
 *
 * Two tiers of data, on purpose: the "Payment & Verification" grid renders INSTANTLY from the roster
 * row the card was opened with (already in memory — no spinner for the numbers that matter most), while
 * identity/contact detail (agent, DOT, address, insurance) is fetched separately and fills in a beat
 * later. Splitting it this way is what keeps the roster fetch lean for all ~8,000 carriers.
 */
import { useEffect } from 'react';
import { AlertTriangle, Mail, MapPin, Phone, Truck, User, X } from 'lucide-react';
import type { VerificationClientRow } from '../../api/verificationClients';
import { useVerificationClientDetail } from './verificationData';

function money(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
const dash = (v: string | number | null | undefined): string =>
  v === '' || v == null ? '—' : String(v);

/** One tile in the 3-column Payment & Verification grid. */
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'accent' }) {
  return (
    <div className={`vf-stat${tone ? ` is-${tone}` : ''}`}>
      <span className="vf-stat-l">{label}</span>
      <span className="vf-stat-v">{value}</span>
    </div>
  );
}

export function VerificationClientModal({
  client,
  onClose,
}: {
  client: VerificationClientRow;
  onClose: () => void;
}) {
  const detail = useVerificationClientDetail(client.carrierId);
  const isLoc = client.paymentTerms === 'LOC';

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const d = detail.data;

  return (
    <div className="vf-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="vf-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vf-modal-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="vf-modal-head">
          <div className="vf-modal-ident">
            <h2 id="vf-modal-title">{client.companyName}</h2>
            <p className="vf-modal-sub">
              #{client.carrierId}
              {d?.dot ? ` · DOT ${d.dot}` : ''}
              {!client.isActive ? ' · Inactive' : ''}
            </p>
            {client.isDebtor ? (
              <span className="vf-tag vf-tag-danger vf-modal-debtor">
                <AlertTriangle size={12} />
                Flagged as a debtor
              </span>
            ) : null}
          </div>
          <button type="button" className="vf-icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <section className="vf-section">
          <h3 className="vf-section-title">Payment &amp; verification</h3>
          <div className="vf-stat-grid">
            <Stat label="Company type" value={dash(client.companyType.replace(/_/g, ' ') || null)} />
            <Stat label="Payment terms" value={dash(client.paymentTerms)} tone={isLoc ? 'accent' : undefined} />
            <Stat label="Payment day" value={dash(client.paymentDay)} />
            <Stat label="Minimum required balance" value={money(client.minimumRequiredBalance)} />
            <Stat label="Billing cycle tag" value={dash(client.billingCycleTag)} />
            <Stat label="Is debtor" value={client.isDebtor ? 'Yes' : 'No'} tone={client.isDebtor ? 'danger' : undefined} />
            <Stat label="Billing cycle" value={dash(client.billingCycle)} />
            {isLoc ? (
              <Stat label="Credit limit" value={money(client.creditLimit)} tone="accent" />
            ) : (
              <Stat label="Credit limit" value="— (not LOC)" />
            )}
            <Stat label="Credit score" value={dash(client.creditScore)} />
          </div>
        </section>

        <section className="vf-section">
          <h3 className="vf-section-title">Contact &amp; identity</h3>
          {detail.loading ? (
            <div className="vf-detail-grid" aria-busy="true" aria-label="Loading contact detail">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="vf-sk vf-sk-field" />
              ))}
            </div>
          ) : detail.error ? (
            <p className="vf-banner-error" role="alert">
              {detail.error}
            </p>
          ) : (
            <dl className="vf-detail-grid">
              <Field icon={<User size={13} />} label="Contact" value={d?.contact} />
              <Field icon={<Phone size={13} />} label="Phone" value={d?.phone} mono />
              <Field icon={<Mail size={13} />} label="Email" value={d?.email} mono />
              <Field icon={<User size={13} />} label="Agent" value={d?.agentName} />
              <Field icon={<Mail size={13} />} label="Agent email" value={d?.agentEmail} mono />
              <Field icon={<MapPin size={13} />} label="Address" value={d?.address} />
              <Field icon={<Truck size={13} />} label="Money code" value={d?.moneyCode} mono />
              <Field label="Insurance" value={d?.insuranceCoverage} />
              <Field label="CreditSafe grade" value={d?.creditsafeGrade} />
              <Field label="First swipe" value={d?.firstSwipeAt} mono />
              <Field label="Last transaction" value={d?.lastTransactionAt} mono />
            </dl>
          )}
        </section>

        <footer className="vf-modal-actions">
          <button type="button" className="vf-btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  icon,
  label,
  value,
  mono,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  const text = (value ?? '').trim();
  return (
    <div className="vf-field">
      <dt>
        {icon}
        {label}
      </dt>
      <dd className={mono ? 'vf-mono' : undefined}>{text || '—'}</dd>
    </div>
  );
}
