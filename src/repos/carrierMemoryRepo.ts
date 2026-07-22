import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  paymentCarrierMemory,
  type NewPaymentCarrierMemory,
  type PaymentCarrierMemory,
} from '../db/schema/index.js';
import { firstOrThrow } from './util.js';

/**
 * carrierMemoryRepo — the sender/company → carrier learning store (replaces the Zoho
 * `Company_Carrier_Id_Memory` module). Dedup is case-insensitive at the DB level via
 * `company_name_lc` + a unique index; a colliding insert is a no-op (returns the existing row).
 */

export interface InsertMemoryInput {
  companyName: string;
  carrierId: string;
  createdBy?: string | undefined;
}

export interface InsertMemoryResult {
  row: PaymentCarrierMemory;
  created: boolean;
}

export const carrierMemoryRepo = {
  /** Entire memory table (companyName ASC), capped — the panel fetches it whole (widget parity). */
  async list(limit = 10000): Promise<PaymentCarrierMemory[]> {
    return db
      .select()
      .from(paymentCarrierMemory)
      .orderBy(asc(paymentCarrierMemory.companyName))
      .limit(Math.min(50000, Math.max(1, limit)));
  },

  /** Every carrier learned for a company name (case-insensitive). */
  async findByCompany(companyName: string): Promise<PaymentCarrierMemory[]> {
    const lc = (companyName || '').trim().toLowerCase();
    if (!lc) return [];
    return db.select().from(paymentCarrierMemory).where(eq(paymentCarrierMemory.companyNameLc, lc));
  },

  /**
   * Insert a learned (company → carrier) pair. Idempotent: a duplicate (company_name_lc, carrier_id)
   * neither errors nor double-inserts — returns the existing row with `created: false`. Callers must
   * apply the junk-name guard BEFORE calling (parity with the widget's client-side filter).
   */
  async insertDedup(input: InsertMemoryInput): Promise<InsertMemoryResult> {
    const companyName = (input.companyName || '').trim();
    const lc = companyName.toLowerCase();
    const values: NewPaymentCarrierMemory = {
      companyName,
      companyNameLc: lc,
      carrierId: String(input.carrierId).trim(),
    };
    if (input.createdBy !== undefined) values.createdBy = input.createdBy;

    const inserted = await db
      .insert(paymentCarrierMemory)
      .values(values)
      .onConflictDoNothing({ target: [paymentCarrierMemory.companyNameLc, paymentCarrierMemory.carrierId] })
      .returning();

    const created = inserted[0];
    if (created) return { row: created, created: true };

    // Conflict on (company_name_lc, carrier_id) → the exact pair already exists. Return it.
    const existing = await db
      .select()
      .from(paymentCarrierMemory)
      .where(
        and(
          eq(paymentCarrierMemory.companyNameLc, lc),
          eq(paymentCarrierMemory.carrierId, values.carrierId),
        ),
      )
      .limit(1);
    return { row: firstOrThrow(existing, 'carrier-memory conflict but no existing row found'), created: false };
  },
};
