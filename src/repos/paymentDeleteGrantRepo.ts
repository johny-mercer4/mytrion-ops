import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { paymentDeleteGrants, type NewPaymentDeleteGrant, type PaymentDeleteGrant } from '../db/schema/index.js';

/**
 * paymentDeleteGrantRepo — explicit per-user permission to hard-delete a manually-entered
 * payment_transactions row of a given source (today: 'chase', the only manual-entry rail).
 * Admins bypass this entirely (see requirePaymentDeleteAccess in billing.routes.ts) — this table
 * only ever grants a NON-admin an exception, never restricts one.
 */
export const paymentDeleteGrantRepo = {
  /** Whether this Zoho user has an explicit grant for this source. */
  async isGranted(zohoUserId: string, source: string): Promise<boolean> {
    const rows = await db
      .select({ id: paymentDeleteGrants.id })
      .from(paymentDeleteGrants)
      .where(and(eq(paymentDeleteGrants.zohoUserId, zohoUserId), eq(paymentDeleteGrants.source, source)))
      .limit(1);
    return rows.length > 0;
  },

  /** Every grant for a source (admin management view). */
  async listBySource(source: string): Promise<PaymentDeleteGrant[]> {
    return db.select().from(paymentDeleteGrants).where(eq(paymentDeleteGrants.source, source));
  },

  /** Grant (idempotent — re-granting an existing user/source is a no-op, not a duplicate row). */
  async grant(input: NewPaymentDeleteGrant): Promise<PaymentDeleteGrant> {
    const rows = await db
      .insert(paymentDeleteGrants)
      .values(input)
      .onConflictDoUpdate({
        target: [paymentDeleteGrants.zohoUserId, paymentDeleteGrants.source],
        set: { grantedBy: input.grantedBy },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to grant payment-delete permission');
    return row;
  },

  /** Revoke. Returns true if a row was actually removed. */
  async revoke(zohoUserId: string, source: string): Promise<boolean> {
    const rows = await db
      .delete(paymentDeleteGrants)
      .where(and(eq(paymentDeleteGrants.zohoUserId, zohoUserId), eq(paymentDeleteGrants.source, source)))
      .returning({ id: paymentDeleteGrants.id });
    return rows.length > 0;
  },
};
