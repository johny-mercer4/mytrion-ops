/**
 * Resolve + reverse the CMP payment behind a return whose original MX transaction has no carrier
 * resolved in our system.
 *
 * An MX Merchant charge is frequently paid straight through the CMP client portal and auto-applied
 * to an invoice there — independent of whether our system ever resolved a carrier for the row. The
 * live `/billing/returns/:id/match` route used to assume "never mapped in our system" meant "never
 * touched CMP," which left real money reversed-in-name-only for every such return.
 *
 * Carrier resolution: prefer `tx.carrierId` when the row already has one (cheap, and safer — never
 * let a name-guessed carrier override or contradict one already on file). Otherwise, resolve it by
 * searching CMP directly by company name (`cmpCarrierDiscovery.ts` → servercrm's
 * `services/cmpCarrierByName.js`) — NOT via the local `payment_carrier_memory`/DWH fuzzy match
 * (`fuzzyCarrier.ts`), per an explicit user decision that local data is unreliable for this task.
 * Either way, the resolved carrier then goes through the SAME resolve-then-reverse plumbing
 * (`cmpWrites.ts`'s `resolveMissingRef` path) already proven for the `isInvoiceMapped: true` branch —
 * that code is untouched by this module; carrier stays a plain input to it.
 *
 * Shared by the live route (new returns) and `scripts/backfillReturnCmpReversals.ts` (the existing
 * backlog) so both paths make exactly the same decision. Never throws — a servercrm hiccup must not
 * fail the caller; it degrades to a "reconcile manually" note instead.
 */
import type { PaymentTransaction } from '../../db/schema/index.js';
import { paymentTransactionRepo } from '../../repos/paymentTransactionRepo.js';
import { discoverCarrierByName } from './cmpCarrierDiscovery.js';
import { reverseMapping, type CmpEntry } from './cmpWrites.js';

export const NOT_MAPPED_NOTE = 'not mapped — no CMP payment to reverse';
export const REVERSED_NOTE = 'Reversal(s) applied to CMP';
export const AMBIGUOUS_NOTE_PREFIX = 'several CMP companies match the payer name';
export const AUTO_MAPPED_RETURN_TYPE = 'Auto-Mapped (return)';

export interface ReturnCmpResolution {
  matchNote: string;
  isReversed: boolean;
  /**
   * True whenever a confident carrier match + CMP resolve succeeded — regardless of `dryRun`. Lets a
   * dry-run caller report what WOULD happen; `isReversed` only ever tracks a REAL delete.
   */
  wouldSucceed: boolean;
  /** Set whenever `wouldSucceed` — the caller stamps these onto the transaction row (real runs only). */
  mappingPatch?: { carrierId: string; mappingType: string } | undefined;
  /** Audit-detail enrichment; `attempted: false` means we never had enough signal to even try. */
  detail: {
    attempted: boolean;
    carrierId?: string | undefined;
    carrierVia?: string | undefined;
    invoiceNumber?: string | undefined;
    reversedCount?: number | undefined;
    resolveMessage?: string | undefined;
    /** Present only on the ambiguous outcome — candidate carriers a human could pick from. */
    candidateCount?: number | undefined;
  };
}

const notAttempted: ReturnCmpResolution = {
  matchNote: NOT_MAPPED_NOTE,
  isReversed: false,
  wouldSucceed: false,
  detail: { attempted: false },
};

function invoiceNumberOf(tx: PaymentTransaction): string | undefined {
  const v = tx.raw && typeof tx.raw === 'object' ? (tx.raw as Record<string, unknown>).invoice : undefined;
  return typeof v === 'string' || typeof v === 'number' ? String(v) : undefined;
}

/**
 * `tx` must be the ORIGINAL transaction a return was matched against, with no `cmpRef` on file yet —
 * that's the only reliable "already resolved" signal. `isInvoiceMapped` is NOT: a transaction can
 * have a known carrier (the ingest-time auto-map job, or a plain manual map) while its CMP payment
 * was never checked or reversed, so a mapped-but-unreffed row must still be attempted here, just
 * using `tx.carrierId` directly instead of discovering it. Gated to `source === 'mx'`: the "portal
 * auto-applies independent of our mapping" rationale is MX-only, and a Zelle/Chase row must never
 * get a guessed carrier + a CMP delete.
 *
 * `alreadyMapped` (captured before any resolution) controls whether the result carries a
 * `mappingPatch`: a row that was already mapped keeps its existing mapping record untouched (carrier,
 * mappingType, mappedBy/mappedAt history) — only a genuinely-unmapped row gets a fresh mapping
 * stamped from the carrier resolved here.
 *
 * `opts.dryRun` (the backfill script's dry-run mode only — the live route never sets this): resolves
 * and verifies (carrier, amount match, claim check) exactly as normal, but stops short of the actual
 * CMP delete. `wouldSucceed` reports the outcome either way; `isReversed` only ever reflects a REAL
 * delete.
 */
export async function resolveReturnCmpReversal(
  tx: PaymentTransaction,
  opts: { dryRun?: boolean } = {},
): Promise<ReturnCmpResolution> {
  if (tx.source !== 'mx' || tx.cmpRef) return notAttempted;
  if (tx.amount == null) return notAttempted;
  const alreadyMapped = tx.isInvoiceMapped;
  const invoiceNumber = invoiceNumberOf(tx);

  let carrierId: string;
  let via: string;

  // Mutually exclusive by construction, not by a runtime check: discovery is only ever consulted
  // when the row has no carrier of its own, so a discovered carrier can never disagree with
  // `tx.carrierId` — there is no code path where both are compared.
  if (tx.carrierId && tx.carrierId.trim()) {
    carrierId = tx.carrierId.trim();
    via = 'tx';
  } else {
    const name = tx.senderName || tx.name || undefined;
    if (!name) return notAttempted;

    let discovered;
    try {
      discovered = await discoverCarrierByName({ companyName: name, invoiceNumber });
    } catch {
      return notAttempted;
    }

    if (!discovered.carrierId) {
      // Ambiguous (>=1 real candidate) is actionable — a human can pick in seconds — unlike a
      // genuine dead end, so it must not collapse into the same bucket as "no signal at all".
      if (discovered.candidates.length > 0) {
        return {
          matchNote: `${AMBIGUOUS_NOTE_PREFIX} (${discovered.candidates.length} candidates) — pick the carrier manually`,
          isReversed: false,
          wouldSucceed: false,
          detail: {
            attempted: true,
            invoiceNumber,
            resolveMessage: discovered.message,
            candidateCount: discovered.candidates.length,
          },
        };
      }
      return notAttempted;
    }
    carrierId = discovered.carrierId;
    via = discovered.via ?? 'cmp-name';
  }

  const detailBase = { attempted: true, carrierId, carrierVia: via, invoiceNumber };
  try {
    const rev = await reverseMapping({
      cmpRef: null,
      splitAllocations: null,
      carrierId,
      amount: Number(tx.amount),
      chargedDay: tx.occurredAt ? tx.occurredAt.toISOString().slice(0, 10) : null,
      resolveMissingRef: true,
      mappingType: null,
      invoiceNumber: invoiceNumber ?? null,
      dryRun: opts.dryRun,
      isEntryClaimed: (entry: CmpEntry) =>
        paymentTransactionRepo.isCmpPaymentClaimed(entry.invoiceId, entry.paymentId, tx.id),
    });
    if (rev.ok && rev.kind !== 'none') {
      const isReversed = !opts.dryRun;
      return {
        matchNote: isReversed ? REVERSED_NOTE : NOT_MAPPED_NOTE,
        isReversed,
        wouldSucceed: true,
        mappingPatch: alreadyMapped ? undefined : { carrierId, mappingType: AUTO_MAPPED_RETURN_TYPE },
        detail: { ...detailBase, reversedCount: rev.reversed.length },
      };
    }
    if (!rev.ok) {
      return {
        matchNote: `CMP reverse failed — reconcile manually: ${rev.message ?? ''}`,
        isReversed: false,
        wouldSucceed: false,
        detail: { ...detailBase, resolveMessage: rev.message },
      };
    }
    // rev.ok && kind === 'none': shouldn't happen on this path (resolveMissingRef always attempts an
    // invoice reversal once carrier+amount are present), but fall back safely if it ever does.
    return { ...notAttempted, detail: detailBase };
  } catch (e) {
    return {
      matchNote: 'CMP lookup failed — reconcile manually',
      isReversed: false,
      wouldSucceed: false,
      detail: { ...detailBase, resolveMessage: e instanceof Error ? e.message : String(e) },
    };
  }
}
