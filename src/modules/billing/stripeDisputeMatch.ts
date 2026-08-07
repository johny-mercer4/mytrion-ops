/**
 * Resolve a Stripe dispute (chargeback) against its original Stripe charge and, when safe, reverse
 * the CMP payment it created — the Stripe twin of `returnsCmpReversal.ts`'s MX logic, but far more
 * conservative, because the risk profile is different in a way confirmed against prod data:
 *
 * Every `source='stripe'` row is keyed by a Stripe payment-intent id (`pi_…`). The id embeds which
 * of THREE Stripe accounts it came from (`paymentsIngest.routes.ts`'s docblock): two are visible to
 * CMP's own Stripe feed and arrive here pre-mapped (`mappingType: 'Stripe (auto)'`, PG-only, we never
 * created a CMP payment for them) — a real prod query showed EVERY row in those two accounts has
 * `cmp_ref IS NULL`, including some that are still `mappingType: null` (unmapped) apparently by a
 * bookkeeping race, not because CMP never saw the charge. The third account is CMP-BLIND; an agent
 * manually creates the CMP payment via `/billing/transactions/:id/map`, which always stores a
 * complete `cmp_ref`.
 *
 * The consequence: `mappingType`/`isInvoiceMapped` do NOT reliably tell us whether CMP holds this
 * money — only a stored `cmp_ref` we created ourselves does. So unlike MX (where an unmapped charge
 * confidently means "nothing to reverse," and a mapped-without-ref charge gets a CMP company-name
 * discovery fallback), a Stripe row with no usable ref is NEVER treated as "no CMP action" — it is
 * always flagged for a human, because we genuinely cannot tell. Never falls back to name/carrier
 * discovery either (`discoverCarrierByName`) — an unjustified money risk for a rail that isn't the
 * MX portal-auto-apply case that fallback was built for.
 *
 * Never throws — a lookup failure degrades to a flagged outcome, same contract as
 * `resolveReturnCmpReversal`.
 */
import { paymentTransactionRepo } from '../../repos/paymentTransactionRepo.js';
import { amountsMatch } from './returnsMatch.js';
import { reverseMapping } from './cmpWrites.js';

export const REVERSED_NOTE = 'Reversal(s) applied to CMP';

export type StripeDisputeOutcome = 'unlinked' | 'flagged' | 'reversed';

export interface StripeDisputeResolution {
  outcome: StripeDisputeOutcome;
  /** Set whenever the dispute linked to a transaction, regardless of whether CMP was reversed. */
  originalTransactionId?: number;
  /** Present only when `outcome !== 'unlinked'` — the note the caller persists on the return row. */
  matchNote?: string;
  isReversed: boolean;
  detail: Record<string, unknown>;
}

const unlinked: StripeDisputeResolution = { outcome: 'unlinked', isReversed: false, detail: {} };

/**
 * `paymentIntentId` is optional by design — the Zapier dispute email may or may not contain it.
 * Absent, or no matching `payment_transactions` row → `unlinked` (lands unmatched; an agent matches
 * it manually in the Returns tab, same as any MX return with no automatic signal).
 */
export async function resolveStripeDisputeMatch(p: {
  paymentIntentId?: string | null | undefined;
  amount: number;
}): Promise<StripeDisputeResolution> {
  const pi = (p.paymentIntentId ?? '').trim();
  if (!pi) return unlinked;

  const tx = await paymentTransactionRepo.findBySourceRecord('stripe', pi);
  if (!tx) return { ...unlinked, detail: { paymentIntentId: pi } };

  const detailBase = { transactionId: tx.id, paymentIntentId: pi };

  if (tx.isReturned) {
    // Another return already reversed (or claimed) this exact transaction — matching a second
    // dispute to it would risk a double reversal. Flag rather than silently drop the dispute.
    return {
      outcome: 'flagged',
      originalTransactionId: tx.id,
      matchNote: `transaction ${tx.id} is already flagged returned — reconcile manually`,
      isReversed: false,
      detail: detailBase,
    };
  }

  if (!amountsMatch(p.amount, tx.amount)) {
    // Card disputes can be PARTIAL; a stored-ref reversal always deletes the WHOLE CMP payment.
    return {
      outcome: 'flagged',
      originalTransactionId: tx.id,
      matchNote: `dispute amount ${p.amount} does not match transaction amount ${tx.amount ?? '?'} (possible partial dispute) — reconcile manually`,
      isReversed: false,
      detail: detailBase,
    };
  }

  const ref = tx.cmpRef && typeof tx.cmpRef === 'object' ? (tx.cmpRef as Record<string, unknown>) : null;
  const hasUsableRef = Boolean(ref && String(ref.kind) === 'invoice' && ref.paymentId && ref.invoiceId);

  if (!hasUsableRef) {
    // We did not create a CMP payment we can point to — but per this module's docblock, that does
    // NOT mean CMP holds nothing. Always flag; never guess, never quietly dismiss.
    const via = tx.mappingType ? `mapping_type "${tx.mappingType}"` : 'unmapped';
    return {
      outcome: 'flagged',
      originalTransactionId: tx.id,
      matchNote: `Stripe dispute on a charge with no CMP reference on file (${via}) — CMP may hold this payment via its own Stripe feed; reconcile manually in the CMP portal`,
      isReversed: false,
      detail: detailBase,
    };
  }

  const rev = await reverseMapping({
    cmpRef: tx.cmpRef,
    carrierId: tx.carrierId,
    amount: tx.amount != null ? Number(tx.amount) : null,
    chargedDay: tx.occurredAt ? tx.occurredAt.toISOString().slice(0, 10) : null,
    // Never the CMP lookup-by-(carrier, amount, day) path here — a stored ref always has a complete
    // {invoiceId, paymentId} entry (confirmed against all 11 real rows), so this stays unreachable
    // in practice; explicit false anyway, matching this module's "never guess" contract.
    allowCmpLookup: false,
  });

  if (rev.ok && rev.kind !== 'none') {
    return {
      outcome: 'reversed',
      originalTransactionId: tx.id,
      matchNote: REVERSED_NOTE,
      isReversed: true,
      detail: { ...detailBase, reversedCount: rev.reversed.length },
    };
  }
  return {
    outcome: 'flagged',
    originalTransactionId: tx.id,
    matchNote: `CMP reverse failed — reconcile manually: ${rev.message ?? ''}`,
    isReversed: false,
    detail: { ...detailBase, resolveMessage: rev.message },
  };
}
