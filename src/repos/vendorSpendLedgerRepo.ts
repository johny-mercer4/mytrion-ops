import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  verificationVendorSpendAttempts,
  type VerificationSpendStatus,
} from '../db/schema/verification_vendor_spend.js';

/**
 * Tenant-scoped spend ledger. Insert is the fail-close: if this throws, `runVendor` must not
 * call a metered vendor. Resolve is best-effort after the HTTP has already happened.
 */
export const vendorSpendLedgerRepo = {
  async insertAttempt(input: {
    id: string;
    tenantId: string;
    vendorId: string;
    caseId: string;
    requestedBy: string | null;
  }): Promise<void> {
    await db.insert(verificationVendorSpendAttempts).values({
      id: input.id,
      tenantId: input.tenantId,
      vendorId: input.vendorId,
      caseId: input.caseId,
      status: 'pending',
      requestedBy: input.requestedBy,
    });
  },

  async resolveAttempt(id: string, status: Exclude<VerificationSpendStatus, 'pending'>): Promise<void> {
    await db
      .update(verificationVendorSpendAttempts)
      .set({ status, resolvedAt: new Date() })
      .where(eq(verificationVendorSpendAttempts.id, id));
  },
};
