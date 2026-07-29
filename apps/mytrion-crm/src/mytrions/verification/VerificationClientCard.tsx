/**
 * One carrier, as a card — the Verification roster's unit.
 *
 * The whole card is the click target (a real `<button>`, so keyboard users get Enter/Space and the
 * focus ring for free), which opens the detail modal with the full "Payment & Verification" panel.
 * The card itself surfaces the four facts a reviewer scans a roster FOR: is this a debtor, what are
 * their terms, what do they owe as a minimum, and (if LOC) their credit standing — everything else
 * lives in the modal.
 */
import type { CSSProperties } from 'react';
import { AlertTriangle, Landmark } from 'lucide-react';
import type { VerificationClientRow } from '../../api/verificationClients';

/** Deterministic tone per company type value, so the same value reads the same colour everywhere —
 *  the same recipe HR's department tones use, just keyed by a fixed small set of CMP billing types. */
const TYPE_TONE: Record<string, string> = {
  BANK: 'var(--tone-sky)',
  DIRECT: 'var(--tone-emerald)',
  MERCHANT_CARD: 'var(--tone-amber)',
  ZELLE: 'var(--tone-violet)',
};

function typeTone(companyType: string): string {
  return TYPE_TONE[companyType] ?? 'var(--accent)';
}

function money(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function VerificationClientCard({
  client,
  onOpen,
}: {
  client: VerificationClientRow;
  onOpen: (c: VerificationClientRow) => void;
}) {
  const tone = typeTone(client.companyType);
  const isLoc = client.paymentTerms === 'LOC';

  return (
    <button
      type="button"
      className={`vf-cardc${client.isDebtor ? ' is-debtor' : ''}`}
      style={{ ['--vc' as string]: tone } as CSSProperties}
      onClick={() => onOpen(client)}
      aria-label={`Open ${client.companyName}`}
    >
      <span className="vf-cardc-shimmer" aria-hidden="true" />

      <span className="vf-cardc-top">
        <span className="vf-cardc-ident">
          <span className="vf-cardc-name">{client.companyName}</span>
          <span className="vf-cardc-id">#{client.carrierId}</span>
        </span>
        {client.isDebtor ? (
          <span className="vf-tag vf-tag-danger" title="Flagged as a debtor on file">
            <AlertTriangle size={12} />
            Debtor
          </span>
        ) : null}
      </span>

      <span className="vf-cardc-tags">
        {client.companyType ? <span className="vf-tag vf-tag-tone">{client.companyType.replace(/_/g, ' ')}</span> : null}
        {client.paymentTerms ? (
          <span className={`vf-tag${isLoc ? ' vf-tag-loc' : ' vf-tag-prepay'}`}>{client.paymentTerms}</span>
        ) : null}
        {client.billingCycleTag ? <span className="vf-tag">{client.billingCycleTag}</span> : null}
      </span>

      <span className="vf-cardc-meta">
        <span className="vf-cardc-cell">
          <span className="vf-cardc-l">Min. balance</span>
          <span className="vf-cardc-v">{money(client.minimumRequiredBalance)}</span>
        </span>
        <span className="vf-cardc-cell">
          <span className="vf-cardc-l">{isLoc ? 'Credit limit' : 'Credit score'}</span>
          <span className="vf-cardc-v">
            {isLoc ? money(client.creditLimit) : (client.creditScore ?? '—')}
            {isLoc && client.creditScore != null ? (
              <span className="vf-cardc-dim"> · {client.creditScore}</span>
            ) : null}
          </span>
        </span>
      </span>

      {!client.isActive ? (
        <span className="vf-cardc-inactive">
          <Landmark size={11} />
          Inactive
        </span>
      ) : null}
    </button>
  );
}
