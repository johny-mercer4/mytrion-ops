/**
 * Resolve an MX return (ACH return or card chargeback) against its original MX charge, by an exact
 * reference key — `paymentTransactionRepo.findByReturnReference` — rather than the fuzzy
 * amount/customer/window candidate search the manual-match UI falls back to. This is what lets a
 * return get matched (and, where safe, reversed in CMP) the moment it lands, instead of waiting on
 * the legacy Zoho `automation.processReturnUnmap` workflow.
 *
 * Mirrors the two branches `POST /billing/returns/:id/match` already runs for a human-picked
 * candidate (`billing.routes.ts`): a transaction with a real stored `cmp_ref` reverses directly;
 * everything else (carrier known but no ref, or no carrier at all) delegates to
 * `resolveReturnCmpReversal`, which already carries the MX-only gate, the CMP-by-name discovery
 * fallback, and the claim-check guard. This module adds nothing new to THAT decision — it only adds
 * the double-reversal and partial-amount guards needed before an automatic, no-human-in-the-loop
 * attempt is safe to make at all.
 *
 * Race with Zoho: the legacy workflow may ALSO be matching/reversing this same return independently
 * (Zoho doesn't know PG's state). `zohoReturnMatchSync.js` already refuses to overwrite a row whose
 * `matched_by` isn't the literal `'Zoho (workflow)'` string, so once this module claims a return
 * first, Zoho's later sync leaves it alone. If Zoho's CMP delete wins the race instead, this
 * module's own CMP call simply finds nothing left to delete and reports a reconcile note — no
 * double loss, since a payment can't be deleted twice. Never throws — a lookup/CMP hiccup degrades
 * to a flagged outcome, same contract as `resolveReturnCmpReversal` and `stripeDisputeMatch.ts`.
 */
import { paymentTransactionRepo } from '../../repos/paymentTransactionRepo.js';
import { amountsMatch } from './returnsMatch.js';
import { resolveReturnCmpReversal } from './returnsCmpReversal.js';
import { reverseMapping } from './cmpWrites.js';

export type MxReturnMatchOutcome = 'unlinked' | 'flagged' | 'reversed';

export interface MxReturnMatchResolution {
  outcome: MxReturnMatchOutcome;
  originalTransactionId?: number;
  matchNote?: string;
  isReversed: boolean;
  /** Set only when a fresh carrier was resolved here (the resolveReturnCmpReversal path) and the
   *  transaction wasn't already mapped — same semantics as ReturnCmpResolution.mappingPatch. */
  mappingPatch?: { carrierId: string; mappingType: string } | undefined;
  detail: Record<string, unknown>;
}

const unlinked: MxReturnMatchResolution = { outcome: 'unlinked', isReversed: false, detail: {} };

export async function resolveMxReturnMatch(p: {
  referenceNumber?: string | null | undefined;
  amount: number;
}): Promise<MxReturnMatchResolution> {
  const ref = (p.referenceNumber ?? '').trim();
  if (!ref) return unlinked;

  const tx = await paymentTransactionRepo.findByReturnReference(ref);
  if (!tx) return { ...unlinked, detail: { referenceNumber: ref } };

  const detailBase = { transactionId: tx.id, referenceNumber: ref };

  if (tx.isReturned) {
    return {
      outcome: 'flagged',
      originalTransactionId: tx.id,
      matchNote: `transaction ${tx.id} is already flagged returned — reconcile manually`,
      isReversed: false,
      detail: detailBase,
    };
  }

  if (!amountsMatch(p.amount, tx.amount)) {
    return {
      outcome: 'flagged',
      originalTransactionId: tx.id,
      matchNote: `return amount ${p.amount} does not match transaction amount ${tx.amount ?? '?'} (possible partial return) — reconcile manually`,
      isReversed: false,
      detail: detailBase,
    };
  }

  const cmpRefObj = tx.cmpRef && typeof tx.cmpRef === 'object' ? (tx.cmpRef as Record<string, unknown>) : null;
  const hasUsableRef = Boolean(cmpRefObj && String(cmpRefObj.kind) === 'invoice' && cmpRefObj.paymentId && cmpRefObj.invoiceId);

  if (hasUsableRef) {
    const rev = await reverseMapping({
      cmpRef: tx.cmpRef,
      carrierId: tx.carrierId,
      amount: tx.amount != null ? Number(tx.amount) : null,
      chargedDay: tx.occurredAt ? tx.occurredAt.toISOString().slice(0, 10) : null,
      allowCmpLookup: false, // a real stored ref never needs the lookup-by-carrier/amount/day path
    });
    if (rev.ok && rev.kind !== 'none') {
      return {
        outcome: 'reversed',
        originalTransactionId: tx.id,
        matchNote: 'Reversal(s) applied to CMP',
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

  // No stored ref: delegate to the existing MX fallback (carrier known → direct lookup; no carrier →
  // CMP-by-name discovery). Already MX-gated, already claim-checked, already never throws.
  const fallback = await resolveReturnCmpReversal(tx);
  if (!fallback.detail.attempted) {
    // Genuinely nothing to go on (unmapped, no name, no amount) — leave unmatched for a human/Zoho,
    // not a flagged dead end that would just be noise.
    return { ...unlinked, detail: { ...detailBase, ...fallback.detail } };
  }
  // dryRun is never set on this call, so wouldSucceed and isReversed always agree here — the
  // 'ambiguous' and genuine resolver-miss cases both land in wouldSucceed:false → 'flagged'.
  return {
    outcome: fallback.isReversed ? 'reversed' : 'flagged',
    originalTransactionId: tx.id,
    matchNote: fallback.matchNote,
    isReversed: fallback.isReversed,
    mappingPatch: fallback.mappingPatch,
    detail: { ...detailBase, ...fallback.detail },
  };
}
