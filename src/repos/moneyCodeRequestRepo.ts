import { and, asc, desc, eq, lt, ne, sql, type SQL } from 'drizzle-orm';
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
  /** Company email (nullable, lightly normalized by the caller). Stored only on first insert. */
  email?: string | null | undefined;
}

export interface InsertMoneyCodeResult {
  row: MoneyCodeRequest;
  /** false = an ACTIVE (non-voided) request already existed; `row` is that existing one. */
  created: boolean;
}

export interface ListMoneyCodesOptions {
  status?: 'ISSUED' | 'VOIDED' | undefined;
  /** Only rows with created_at strictly before this instant. */
  generatedBefore?: Date | undefined;
  limit: number;
  order: 'asc' | 'desc';
}

/** ON CONFLICT arbiter predicate — must match the partial unique index (active rows only). */
const ACTIVE_PREDICATE = sql`${moneyCodeRequests.status} <> 'VOIDED'`;

/** NUMERIC columns round-trip as strings in Drizzle — format with fixed scale. */
function money(n: number | undefined, scale = 2): string | undefined {
  return n === undefined ? undefined : n.toFixed(scale);
}

/** The ACTIVE (non-voided) row for a (carrier, invoice), if any. At most one exists (partial index). */
async function selectActiveByCarrierInvoice(carrierId: number, invoiceId: number): Promise<MoneyCodeRequest | undefined> {
  const rows = await db
    .select()
    .from(moneyCodeRequests)
    .where(
      and(
        eq(moneyCodeRequests.carrierId, carrierId),
        eq(moneyCodeRequests.invoiceId, invoiceId),
        ne(moneyCodeRequests.status, 'VOIDED'),
      ),
    )
    .limit(1);
  return rows[0];
}

export const moneyCodeRequestRepo = {
  findActiveByCarrierInvoice: selectActiveByCarrierInvoice,

  /**
   * Insert one money-code request. Idempotent + race-safe on the ACTIVE row: a duplicate that
   * collides with an existing non-voided (carrier, invoice) neither errors nor double-inserts — it
   * returns that existing row with `created: false`. A VOIDED row does NOT block: re-issuing an
   * invoice that was voided inserts a fresh ISSUED row (`created: true`). Backed by the partial
   * unique index (status <> 'VOIDED') + ON CONFLICT DO NOTHING.
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
    if (input.email !== undefined) values.email = input.email;

    const inserted = await db
      .insert(moneyCodeRequests)
      .values(values)
      .onConflictDoNothing({
        target: [moneyCodeRequests.carrierId, moneyCodeRequests.invoiceId],
        where: ACTIVE_PREDICATE,
      })
      .returning();

    const created = inserted[0];
    if (created) return { row: created, created: true };

    // Conflict on the active partial index → an ISSUED row already exists. Return it (idempotent).
    const existing = await selectActiveByCarrierInvoice(input.carrierId, input.invoiceId);
    if (!existing) {
      throw new AppError('Money code request conflict but no active row found', {
        code: 'DB_CONFLICT_NO_ROW',
        statusCode: 500,
      });
    }
    return { row: existing, created: false };
  },

  /** List rows for the void sweep: optional status + created_at < generatedBefore, ordered, capped. */
  async list(opts: ListMoneyCodesOptions): Promise<MoneyCodeRequest[]> {
    const conds: SQL[] = [];
    if (opts.status) conds.push(eq(moneyCodeRequests.status, opts.status));
    if (opts.generatedBefore) conds.push(lt(moneyCodeRequests.createdAt, opts.generatedBefore));
    const where = conds.length ? and(...conds) : undefined;
    const orderBy = opts.order === 'desc' ? desc(moneyCodeRequests.createdAt) : asc(moneyCodeRequests.createdAt);
    return db.select().from(moneyCodeRequests).where(where).orderBy(orderBy).limit(opts.limit);
  },

  /**
   * Void one record by id. Idempotent: an already-VOIDED row is a no-op (returns it unchanged). The
   * conditional UPDATE (status <> 'VOIDED') is race-safe — only the first caller stamps voided_at /
   * void_reason. Returns the row, or null if no such id.
   */
  async voidById(id: number, reason: string | null): Promise<MoneyCodeRequest | null> {
    const updated = await db
      .update(moneyCodeRequests)
      .set({ status: 'VOIDED', voidedAt: new Date(), voidReason: reason })
      .where(and(eq(moneyCodeRequests.id, id), ne(moneyCodeRequests.status, 'VOIDED')))
      .returning();
    if (updated[0]) return updated[0];

    // Not updated → either already VOIDED (no-op) or no such id.
    const existing = await db.select().from(moneyCodeRequests).where(eq(moneyCodeRequests.id, id)).limit(1);
    return existing[0] ?? null;
  },
};
