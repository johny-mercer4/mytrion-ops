import { and, asc, desc, eq, lt, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { moneyCodeRequests, type MoneyCodeRequest, type NewMoneyCodeRequest } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';

export type MoneyCodeStatus = 'ISSUED' | 'VOIDED' | 'USED';

export interface NewMoneyCodeRequestInput {
  carrierId: number;
  invoiceId: number;
  invoiceAmount?: number | undefined;
  limitPct?: number | undefined;
  moneyCodeAmount?: number | undefined;
  billingType?: string | undefined;
  /** ISO date/time string. */
  validUntil?: string | undefined;
  status?: MoneyCodeStatus | undefined;
  efsMoneyCode?: string | undefined;
  requestedBy?: string | undefined;
  email?: string | null | undefined;
  companyName?: string | undefined;
  moneycodeReason?: string | undefined;
  unitNumber?: string | undefined;
}

export interface InsertMoneyCodeResult {
  row: MoneyCodeRequest;
  /** Always true for the draw model (many ISSUED rows per invoice are expected). */
  created: boolean;
}

export interface ListMoneyCodesOptions {
  status?: 'ISSUED' | 'VOIDED' | undefined;
  /** Only rows with created_at strictly before this instant. */
  generatedBefore?: Date | undefined;
  limit: number;
  order: 'asc' | 'desc';
}

export interface ListAgentMoneyCodesOptions {
  /** Own-only scope — matched case-insensitively against requested_by. Required. */
  requestedBy: string;
  page: number;
  limit: number;
  search?: string | undefined;
  status?: MoneyCodeStatus | undefined;
  carrierId?: number | undefined;
}

/** Public row for Data Center — never includes efs_money_code / efs_id. */
export interface MoneyCodeListRow {
  id: number;
  carrier_id: number;
  company_name: string | null;
  money_code_amount: string | null;
  code_total: string | null;
  batch_rows: number;
  invoice_ids: unknown;
  billing_type: string | null;
  valid_until: Date | string | null;
  status: string;
  requested_by: string | null;
  moneycode_reason: string | null;
  unit_number: string | null;
  created_at: Date | string | null;
  voided_at: Date | string | null;
  void_reason: string | null;
  has_code: boolean;
  notified_at: Date | string | null;
  notify_error: string | null;
}

export interface ListAgentMoneyCodesResult {
  data: MoneyCodeListRow[];
  page: number;
  limit: number;
  count: number;
  more_records: boolean;
}

/** NUMERIC columns round-trip as strings in Drizzle — format with fixed scale. */
function money(n: number | undefined, scale = 2): string | undefined {
  return n === undefined ? undefined : n.toFixed(scale);
}

function stripCodeFields(row: Record<string, unknown>): MoneyCodeListRow {
  const hasCode = Boolean(row.efs_money_code);
  delete row.efs_money_code;
  delete row.efs_id;
  return {
    id: Number(row.id),
    carrier_id: Number(row.carrier_id),
    company_name: (row.company_name as string | null) ?? null,
    money_code_amount: (row.money_code_amount as string | null) ?? null,
    code_total: row.code_total != null ? String(row.code_total) : null,
    batch_rows: Number(row.batch_rows ?? 1),
    invoice_ids: row.invoice_ids ?? null,
    billing_type: (row.billing_type as string | null) ?? null,
    valid_until: (row.valid_until as Date | string | null) ?? null,
    status: String(row.status ?? 'ISSUED'),
    requested_by: (row.requested_by as string | null) ?? null,
    moneycode_reason: (row.moneycode_reason as string | null) ?? null,
    unit_number: (row.unit_number as string | null) ?? null,
    created_at: (row.created_at as Date | string | null) ?? null,
    voided_at: (row.voided_at as Date | string | null) ?? null,
    void_reason: (row.void_reason as string | null) ?? null,
    has_code: hasCode,
    notified_at: (row.notified_at as Date | string | null) ?? null,
    notify_error: (row.notify_error as string | null) ?? null,
  };
}

function toPublicRow(row: MoneyCodeRequest): MoneyCodeListRow {
  return stripCodeFields({
    id: row.id,
    carrier_id: row.carrierId,
    company_name: row.companyName,
    money_code_amount: row.moneyCodeAmount,
    code_total: row.moneyCodeAmount,
    batch_rows: 1,
    invoice_ids: [row.invoiceId],
    billing_type: row.billingType,
    valid_until: row.validUntil,
    status: row.status,
    requested_by: row.requestedBy,
    moneycode_reason: row.moneycodeReason,
    unit_number: row.unitNumber,
    created_at: row.createdAt,
    voided_at: row.voidedAt,
    void_reason: row.voidReason,
    efs_money_code: row.efsMoneyCode,
    efs_id: row.efsId,
    notified_at: row.notifiedAt,
    notify_error: row.notifyError,
  });
}

export const moneyCodeRequestRepo = {
  async findById(id: number): Promise<MoneyCodeRequest | null> {
    const rows = await db.select().from(moneyCodeRequests).where(eq(moneyCodeRequests.id, id)).limit(1);
    return rows[0] ?? null;
  },

  /**
   * Insert one money-code request row. Draw model: no uniqueness on (carrier, invoice) —
   * many ISSUED draws per invoice are expected.
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
    if (input.validUntil !== undefined) values.validUntil = new Date(input.validUntil);
    if (input.status !== undefined) values.status = input.status;
    if (input.efsMoneyCode !== undefined) values.efsMoneyCode = input.efsMoneyCode;
    if (input.requestedBy !== undefined) values.requestedBy = input.requestedBy;
    if (input.email !== undefined) values.email = input.email;
    if (input.companyName !== undefined) values.companyName = input.companyName;
    if (input.moneycodeReason !== undefined) values.moneycodeReason = input.moneycodeReason;
    if (input.unitNumber !== undefined) values.unitNumber = input.unitNumber;

    const inserted = await db.insert(moneyCodeRequests).values(values).returning();
    const created = inserted[0];
    if (!created) {
      throw new AppError('Money code insert returned no row', {
        code: 'DB_INSERT_EMPTY',
        statusCode: 500,
      });
    }
    return { row: created, created: true };
  },

  /** List rows for the void sweep: optional status + created_at < generatedBefore. */
  async list(opts: ListMoneyCodesOptions): Promise<MoneyCodeRequest[]> {
    const conds: SQL[] = [];
    if (opts.status) conds.push(eq(moneyCodeRequests.status, opts.status));
    if (opts.generatedBefore) conds.push(lt(moneyCodeRequests.createdAt, opts.generatedBefore));
    const where = conds.length ? and(...conds) : undefined;
    const orderBy = opts.order === 'desc' ? desc(moneyCodeRequests.createdAt) : asc(moneyCodeRequests.createdAt);
    return db.select().from(moneyCodeRequests).where(where).orderBy(orderBy).limit(opts.limit);
  },

  /**
   * Data Center list — one display row per physical code (batch collapsed), own draws only.
   * Never returns efs_money_code / efs_id.
   */
  async listForAgent(opts: ListAgentMoneyCodesOptions): Promise<ListAgentMoneyCodesResult> {
    const requester = opts.requestedBy.trim();
    if (!requester) {
      throw new AppError('requestedBy is required — the list is scoped to your own money codes', {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        expose: true,
      });
    }

    const page = Math.max(1, opts.page);
    const limit = Math.min(200, Math.max(1, opts.limit));
    const offset = (page - 1) * limit;

    const whereParts: SQL[] = [
      sql`p.batch_id IS NULL`,
      sql`LOWER(TRIM(p.requested_by)) = LOWER(TRIM(${requester}))`,
    ];

    const q = opts.search?.trim() ?? '';
    if (q) {
      if (/^\d+$/.test(q)) {
        whereParts.push(sql`p.carrier_id = ${Number(q)}::bigint`);
      } else {
        whereParts.push(sql`p.company_name ILIKE ${`%${q}%`}`);
      }
    }
    if (opts.status) {
      whereParts.push(sql`p.status = ${opts.status}`);
    }
    if (opts.carrierId != null && Number.isFinite(opts.carrierId)) {
      whereParts.push(sql`p.carrier_id = ${opts.carrierId}::bigint`);
    }

    const whereSql = sql.join(whereParts, sql` AND `);

    const result = await db.execute(sql`
      SELECT p.*, b.code_total, b.batch_rows, b.invoice_ids
        FROM money_code_requests p
        JOIN LATERAL (
              SELECT COALESCE(SUM(s.money_code_amount), 0) AS code_total,
                     COUNT(*)::int                         AS batch_rows,
                     ARRAY_AGG(s.invoice_id ORDER BY s.id) AS invoice_ids
                FROM money_code_requests s
               WHERE s.id = p.id OR s.batch_id = p.id
              ) b ON true
       WHERE ${whereSql}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ${limit + 1} OFFSET ${offset}
    `);

    // postgres-js RowList is array-like (not `{ rows }`).
    const rawRows = [...result] as Array<Record<string, unknown>>;
    const more = rawRows.length > limit;
    const slice = more ? rawRows.slice(0, limit) : rawRows;
    const data = slice.map((r) => stripCodeFields({ ...r }));
    return { data, page, limit, count: data.length, more_records: more };
  },

  /**
   * Void one record by id (and, when batch siblings exist, the whole batch via
   * COALESCE(batch_id, id)). Idempotent for already-VOIDED rows.
   * Prefer money_code.void touchpoint for agent voids (EFS-safe via ServerCRM).
   */
  async voidById(id: number, reason: string | null): Promise<MoneyCodeRequest | null> {
    await db.execute(sql`
      WITH target AS (
        SELECT COALESCE(batch_id, id) AS root
          FROM money_code_requests
         WHERE id = ${id}
      )
      UPDATE money_code_requests r
         SET status = 'VOIDED', voided_at = now(), void_reason = ${reason}
        FROM target
       WHERE COALESCE(r.batch_id, r.id) = target.root
         AND r.status <> 'VOIDED'
    `);
    return moneyCodeRequestRepo.findById(id);
  },

  /** Public (code-stripped) view of one row — for void response shaping. */
  toPublicRow,
};
