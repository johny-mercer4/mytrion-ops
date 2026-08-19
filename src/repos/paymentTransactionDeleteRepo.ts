import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { paymentTransactions, type PaymentTransaction } from '../db/schema/index.js';

/**
 * Hard delete — for a manually-entered row (Chase is the only rail with no automated feed) that
 * should never have existed, not a correction to a real payment. Guarded to UNMAPPED only: a row
 * still holding an invoice/prepay mapping has to go through the existing (audited) unmap flow
 * first, so a real CMP reversal actually happens before the row that recorded it disappears.
 * Conditional on `is_invoice_mapped = false` at the DB level (not just checked-then-deleted) so a
 * concurrent map cannot land between the check and the delete.
 *
 * Returns the deleted row so the caller can audit-log a full snapshot — this is the one place in
 * the system a payment_transactions row is destroyed rather than corrected in place, so the audit
 * trail is the only remaining record of what it was.
 *
 * Lives in its own file, re-exported as `paymentTransactionRepo.deleteIfUnmapped`, so that repo's
 * file stays under the 600-line cap without changing the method's public shape or call sites.
 */
export async function deleteIfUnmapped(id: number): Promise<PaymentTransaction | undefined> {
  const rows = await db
    .delete(paymentTransactions)
    .where(and(eq(paymentTransactions.id, id), eq(paymentTransactions.isInvoiceMapped, false)))
    .returning();
  return rows[0];
}
