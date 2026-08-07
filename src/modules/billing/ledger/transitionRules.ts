/**
 * LOC ↔ Prepay transition rules — TZ §8.
 *
 * PHASE 1 THIS IS A DELIBERATE NO-OP. It exists as a NAMED SEAM so the three deferred rules have one
 * obvious place to land, rather than being retrofitted into the middle of the client-type route:
 *
 *   1. §8.2 — LOC → Prepay is BLOCKED while the carrier has unpaid AR. The check needs the AR
 *      section's Closing balance, so it hooks here once the compute layer exists:
 *        const ar = await computeSection({ carrierIds: [carrierId], section: 'ar', period });
 *        if ((ar[0]?.closing ?? 0) > 0) throw new ConflictError(...)   // message must state the amount
 *      The TZ is explicit that the user is told the outstanding sum, not just refused.
 *
 *   2. §8.3 — Prepay → LOC carries the remaining deposit forward as an "opening credit" into the new
 *      AR sub-ledger, and the first invoice after the switch is reduced by it. Mechanically that is a
 *      new `ledger_opening_balances` revision for section 'ar' with a negative amount, written in the
 *      same transaction as the type change so the two can never disagree.
 *
 *   3. §8.4 — a back-dated `effective_from` (earlier than `entered_at`) opens a window in which CMP
 *      already processed transactions under the OLD type. The TZ forbids automatic retroactive
 *      reclassification; instead every transaction and invoice in that window goes into a
 *      "Reclassification exception" queue for manual agreement with CMP. That queue needs its own
 *      table and surface — the detection is trivial here (`effectiveFrom < today`), the workflow is not.
 *
 * Keeping the call site live from day one means enabling any of the three is a change inside this
 * function, not a change to the route's shape or its audit record.
 */
import type { LedgerClientType } from './sections.js';

export interface TransitionRequest {
  carrierId: string;
  /** The currently resolved type, or null when the carrier had none. */
  from: LedgerClientType | null;
  to: LedgerClientType;
  /** yyyy-mm-dd the new type takes effect. Earlier than today ⇒ back-dated (rule 3). */
  effectiveFrom: string;
}

/**
 * Throws when a transition is not permitted. Phase 1 permits everything — the ledger records the
 * type change and the deferred rules above decide what else must happen.
 */
export async function assertTransitionAllowed(_request: TransitionRequest): Promise<void> {
  // Intentionally empty. See the module header for the three rules this seam will enforce.
  return;
}
