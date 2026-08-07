/**
 * Returns-matching preconditions.
 *
 * Matching a return to its payment is not a labelling exercise — it pulls the money back out of
 * CMP (deletes the invoice payment / decrements the prepay balance). So it must happen at most
 * once per return and at most once per payment, which is exactly what the Zoho Deluge twin
 * (`mytrionManualMatchReturn`) guards before it does anything.
 *
 * The UI hides the action on matched returns and disables already-returned candidates, but that
 * only holds while the rows on screen are current: a stale list, two agents working the same
 * queue, or a return the auto-flow processed after the page loaded all defeat it. This is the
 * server-side half of the same rule.
 */
import { ConflictError } from '../../lib/errors.js';

/** The bits of a `payment_returns` row the precondition looks at. */
export interface ReturnMatchState {
  id: number;
  matched: boolean;
  matchedBy?: string | null;
  source: string;
}

/** The bits of a `payment_transactions` row the precondition looks at. */
export interface TransactionMatchState {
  id: number;
  isReturned: boolean;
  source: string;
}

/** Return `source` → the rail it belongs to. A return source absent here (legacy data, or a rail
 *  with no compatibility rule yet) is NOT gated — see `isRailCompatible`. */
const RAIL_BY_RETURN_SOURCE: Record<string, string> = {
  'mx-ach': 'mx',
  'mx-dispute': 'mx',
  'stripe-dispute': 'stripe',
};

/** Whether a return could plausibly originate from a transaction on this rail. Unknown return
 *  sources allow everything (fail open) so legacy rows and old test fixtures never start 409-ing —
 *  this only exists to catch a KNOWN-wrong pairing (a Stripe dispute picked against an MX charge). */
function isRailCompatible(returnSource: string, txSource: string): boolean {
  const rail = RAIL_BY_RETURN_SOURCE[returnSource];
  return !rail || rail === txSource;
}

/**
 * Throws `ConflictError` (409) when matching this pair would reverse money twice, or would link a
 * return to a transaction on the wrong payment rail entirely (e.g. a Stripe dispute against an MX
 * charge) — a mistake `findReturnCandidates` already scopes against, but this is the server-side
 * guarantee the UI can't be trusted to enforce alone.
 *
 * @param ret the return being matched
 * @param tx  the payment the agent picked as the original
 */
export function assertReturnMatchable(ret: ReturnMatchState, tx: TransactionMatchState): void {
  if (ret.matched) {
    const who = ret.matchedBy ? ` (by ${ret.matchedBy})` : '';
    throw new ConflictError(
      `Return ${ret.id} is already matched${who} — matching it again would reverse the payment twice. Refresh the queue.`,
    );
  }
  if (tx.isReturned) {
    throw new ConflictError(
      `Transaction ${tx.id} is already flagged returned — another return has already reversed it.`,
    );
  }
  if (!isRailCompatible(ret.source, tx.source)) {
    throw new ConflictError(
      `Return ${ret.id} (${ret.source}) cannot be matched to transaction ${tx.id} (${tx.source}) — wrong payment rail.`,
    );
  }
}

/** Whether a return's amount matches the transaction's, to the cent. A card dispute (unlike an MX
 *  ACH return) can be PARTIAL — reversing a stored CMP ref always deletes the WHOLE payment
 *  (`cmpWrites.ts`'s `reverseInvoicePayments`), so a mismatch means "do not auto-reverse this,"
 *  not "these can't be the same event." Either side missing an amount is treated as a mismatch —
 *  never guess. Shared by the manual match route and the Stripe-dispute webhook. */
export function amountsMatch(retAmount: string | number | null | undefined, txAmount: string | number | null | undefined): boolean {
  if (retAmount == null || txAmount == null) return false;
  const a = Number(retAmount);
  const b = Number(txAmount);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < 0.005;
}
