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
}

/** The bits of a `payment_transactions` row the precondition looks at. */
export interface TransactionMatchState {
  id: number;
  isReturned: boolean;
}

/**
 * Throws `ConflictError` (409) when matching this pair would reverse money twice.
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
}
