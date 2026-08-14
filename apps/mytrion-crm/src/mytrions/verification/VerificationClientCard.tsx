/**
 * One carrier, as a card — the Verification roster's unit.
 *
 * The whole card is the click target (a real `<button>`, so keyboard users get Enter/Space and the
 * focus ring for free), which opens the detail modal. Prepay cards never show credit score or
 * minimum balance — those fields are LOC-only. Aggregator (billing type) is icon + label, not colour
 * alone.
 */
import { AlertTriangle, Landmark } from 'lucide-react';
import type { VerificationClientRow } from '../../api/verificationClients';
import { AggregatorMark } from './verificationAggregators';
import { isPrepayTerms, money } from './verificationFormat';

export function VerificationClientCard({
  client,
  onOpen,
}: {
  client: VerificationClientRow;
  onOpen: (c: VerificationClientRow) => void;
}) {
  const prepay = isPrepayTerms(client.paymentTerms);
  const isLoc = client.paymentTerms === 'LOC';

  return (
    <button
      type="button"
      className={`vf-cardc${client.isDebtor ? ' is-debtor' : ''}`}
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
          <span className="vf-tag vf-tag-danger">
            <AlertTriangle size={12} aria-hidden="true" />
            Debtor
          </span>
        ) : null}
      </span>

      <span className="vf-cardc-tags">
        {client.companyType ? <AggregatorMark companyType={client.companyType} /> : null}
        {client.paymentTerms ? (
          <span className={`vf-tag${isLoc ? ' vf-tag-loc' : prepay ? ' vf-tag-prepay' : ''}`}>
            {client.paymentTerms}
          </span>
        ) : null}
        {client.billingCycleTag ? <span className="vf-tag">{client.billingCycleTag}</span> : null}
      </span>

      <span className="vf-cardc-meta">
        {prepay ? (
          <>
            <span className="vf-cardc-cell">
              <span className="vf-cardc-l">Payment day</span>
              <span className="vf-cardc-v">{client.paymentDay || '—'}</span>
            </span>
            <span className="vf-cardc-cell">
              <span className="vf-cardc-l">Last activity</span>
              <span className="vf-cardc-v">{client.lastTransactionAt || '—'}</span>
            </span>
          </>
        ) : (
          <>
            <span className="vf-cardc-cell">
              <span className="vf-cardc-l">Min. balance</span>
              <span className="vf-cardc-v">{money(client.minimumRequiredBalance)}</span>
            </span>
            <span className="vf-cardc-cell">
              <span className="vf-cardc-l">{isLoc ? 'Credit limit' : 'Credit score'}</span>
              <span className="vf-cardc-v">
                {isLoc ? money(client.creditLimit) : (client.creditScore ?? '—')}
                {isLoc && client.creditScore != null && client.creditScore !== 0 ? (
                  <span className="vf-cardc-dim"> · {client.creditScore}</span>
                ) : null}
              </span>
            </span>
          </>
        )}
      </span>

      {!client.isActive ? (
        <span className="vf-cardc-inactive">
          <Landmark size={11} aria-hidden="true" />
          Inactive
        </span>
      ) : null}
    </button>
  );
}
