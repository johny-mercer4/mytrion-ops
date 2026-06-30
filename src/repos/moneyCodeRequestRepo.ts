import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { moneyCodeRequests, type MoneyCodeRequest, type NewMoneyCodeRequest } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';

export interface NewMoneyCodeRequestInput {
  carrierId: number;
  invoiceId: number;
  invoiceAmount?: number | undefined;
  limitPct?: number | undefined;
  moneyCodeAmount?: number | undefined;
  billingType?: string | undefined;
  /** ISO date string (YYYY-MM-DD). */
  validUntil?: string | undefined;
  status?: 'ISSUED' | 'VOIDED' | undefined;
  efsMoneyCode?: string | undefined;
  requestedBy?: string | undefined;
}

export interface InsertMoneyCodeResult {
  row: MoneyCodeRequest;
  /** false = a request for this (carrier, invoice) already existed; `row` is that existing one. */
  created: boolean;
}

/** NUMERIC columns round-trip as strings in Drizzle — format with fixed scale. */
function money(n: number | undefined, scale = 2): string | undefined {
  return n === undefined ? undefined : n.toFixed(scale);
}

async function selectByCarrierInvoice(carrierId: number, invoiceId: number): Promise<MoneyCodeRequest | undefined> {
  const rows = await db
    .select()
    .from(moneyCodeRequests)
    .where(and(eq(moneyCodeRequests.carrierId, carrierId), eq(moneyCodeRequests.invoiceId, invoiceId)))
    .limit(1);
  return rows[0];
}

export const moneyCodeRequestRepo = {
  findByCarrierInvoice: selectByCarrierInvoice,

  /**
   * Insert one money-code request. Idempotent + race-safe: a duplicate (carrier, invoice) neither
   * errors nor double-inserts — it returns the existing row with `created: false`, relying on the
   * DB UNIQUE(carrier_id, invoice_id) + ON CONFLICT DO NOTHING.
   */
  async insert(input: NewMoneyCodeRequestInput): Promise<InsertMoneyCodeResult> {
    const values: NewMoneyCodeRequest = {
      carrierId: input.carrierId,
      invoiceId: input.invoiceId,
    };
    const invoiceAmount = money(input.invoiceAmount);
    const limitPct = money(input.limitPct);
    const moneyCodeAmount = money(input.moneyCodeAmount);
    if (invoiceAmount !== undefined) values.invoiceAmount = invoiceAmount;
    if (limitPct !== undefined) values.limitPct = limitPct;
    if (moneyCodeAmount !== undefined) values.moneyCodeAmount = moneyCodeAmount;
    if (input.billingType !== undefined) values.billingType = input.billingType;
    if (input.validUntil !== undefined) values.validUntil = input.validUntil;
    if (input.status !== undefined) values.status = input.status;
    if (input.efsMoneyCode !== undefined) values.efsMoneyCode = input.efsMoneyCode;
    if (input.requestedBy !== undefined) values.requestedBy = input.requestedBy;

    const inserted = await db
      .insert(moneyCodeRequests)
      .values(values)
      .onConflictDoNothing({ target: [moneyCodeRequests.carrierId, moneyCodeRequests.invoiceId] })
      .returning();

    const created = inserted[0];
    if (created) return { row: created, created: true };

    // Lost the race / already issued — return the existing row so the caller is idempotent.
    const existing = await selectByCarrierInvoice(input.carrierId, input.invoiceId);
    if (!existing) {
      throw new AppError('Money code request conflict but no existing row found', {
        code: 'DB_CONFLICT_NO_ROW',
        statusCode: 500,
      });
    }
    return { row: existing, created: false };
  },
};
