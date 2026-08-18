import { and, asc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '../db/client.js';
import { withDbRetry } from '../db/retry.js';
import { ConflictError } from '../lib/errors.js';
import { maintenanceCases, type MaintenanceCase, type NewMaintenanceCase } from '../db/schema/index.js';
import { PREPAY_PAYMENT_METHOD } from '../modules/customerService/maintenanceFields.js';
import { firstOrUndefined, isUniqueViolation } from './util.js';

/**
 * A raw SQLSTATE 23505 is not an AppError, so errorHandler swaps its message for "Internal server
 * error" — same trap as hrEmployeeRepo's employeeWriteConflict. Only reachable for an agent-TYPED
 * reference number: `withGeneratedReferenceNumber` already checks-and-retries before insert for the
 * auto-generated path, so this is the backstop for the one case that skips that check on purpose.
 */
export function referenceNumberConflict(err: unknown): unknown {
  if (!isUniqueViolation(err)) return err;
  const constraint = (err as { constraint?: unknown }).constraint;
  if (constraint !== 'maintenance_cases_reference_number_uk') return err;
  return new ConflictError('That reference number is already in use on another case', {
    code: 'REFERENCE_NUMBER_TAKEN',
    cause: err,
  });
}

/**
 * maintenanceCaseRepo — the maintenance case queue. Postgres is the source of truth (Zoho was read
 * once, at migration time), so this repo owns both reads and writes.
 *
 * Not tenant-scoped: a global operational table keyed on the carrier_id domain, matching
 * paymentTransactionRepo. NUMERIC round-trips as a string in Drizzle — writes come pre-formatted by
 * `money()` in modules/customerService/maintenanceFields.ts.
 */

export interface MaintenanceFilters {
  /** Free text across carrier id, company, unit number, case name, owner, work order. */
  search?: string | undefined;
  status?: string[] | undefined;
  caseType?: string[] | undefined;
  paymentMethod?: string[] | undefined;
  paymentStatus?: string[] | undefined;
  ownerZohoUserId?: string | undefined;
  /** Exact match, from a carrier drilldown link. */
  carrierId?: string | undefined;
  invoiced?: boolean | undefined;
  /** true → case_completion is not null (signed off); false → still open. */
  completed?: boolean | undefined;
  /** case_date bounds, YYYY-MM-DD, both inclusive. */
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

export type MaintenanceSort = 'date' | 'created' | 'amount' | 'company' | 'carrier';

/**
 * A list row — exactly the columns `CARD_COLUMNS` selects, derived from it rather than restated, so
 * adding a column to the card can never silently disagree with the type the route returns.
 */
export type MaintenanceCard = Pick<MaintenanceCase, keyof typeof CARD_COLUMNS>;

export interface MaintenancePage {
  rows: MaintenanceCard[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
}

export interface MaintenanceFacets {
  total: number;
  byStatus: Record<string, number>;
  byCaseType: Record<string, number>;
  byPaymentStatus: Record<string, number>;
  totalAmount: number;
}

export interface OwnerFacet {
  ownerZohoUserId: string;
  ownerName: string;
  count: number;
}

/**
 * Unit numbers arrive as '012', '#123', 'T-123', so a raw equality never matches what an agent
 * types. This expression MUST stay character-identical to `maintenance_cases_unit_norm_idx` in
 * 0079_maintenance_cases.sql — if the two drift, the index silently stops being used and the
 * predicate falls back to a seq scan.
 */
const UNIT_NORM = sql`lower(regexp_replace(${maintenanceCases.unitNumber}, '[^a-zA-Z0-9]', '', 'g'))`;
const normalizeUnit = (q: string): string => q.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Every ordering ends in `id` so the sort is TOTAL. Without that tiebreak an offset page can skip or
 * duplicate rows whenever many cases share a date — the same failure the referral drain hit when 680
 * of 687 records shared one timestamp.
 */
const ORDERS: Record<MaintenanceSort, { asc: SQL; desc: SQL }> = {
  date: {
    desc: sql`${maintenanceCases.caseDate} DESC NULLS LAST, ${maintenanceCases.id} DESC`,
    asc: sql`${maintenanceCases.caseDate} ASC NULLS LAST, ${maintenanceCases.id} ASC`,
  },
  created: {
    desc: sql`${maintenanceCases.createdAt} DESC, ${maintenanceCases.id} DESC`,
    asc: sql`${maintenanceCases.createdAt} ASC, ${maintenanceCases.id} ASC`,
  },
  amount: {
    desc: sql`${maintenanceCases.totalAmount} DESC NULLS LAST, ${maintenanceCases.id} DESC`,
    asc: sql`${maintenanceCases.totalAmount} ASC NULLS LAST, ${maintenanceCases.id} ASC`,
  },
  company: {
    desc: sql`lower(coalesce(${maintenanceCases.companyName}, ${maintenanceCases.name})) DESC NULLS LAST, ${maintenanceCases.id} DESC`,
    asc: sql`lower(coalesce(${maintenanceCases.companyName}, ${maintenanceCases.name})) ASC NULLS LAST, ${maintenanceCases.id} ASC`,
  },
  carrier: {
    desc: sql`${maintenanceCases.carrierId} DESC NULLS LAST, ${maintenanceCases.id} DESC`,
    asc: sql`${maintenanceCases.carrierId} ASC NULLS LAST, ${maintenanceCases.id} ASC`,
  },
};

function buildFilters(f: MaintenanceFilters): SQL[] {
  const conds: SQL[] = [];

  const q = f.search?.trim();
  if (q) {
    const like = `%${q}%`;
    const terms: (SQL | undefined)[] = [
      // Company reads two ways: the module's own `name` and the linked Account's label. Searching
      // only one of them misses roughly half the records.
      ilike(maintenanceCases.companyName, like),
      ilike(maintenanceCases.name, like),
      ilike(maintenanceCases.ownerName, like),
      ilike(maintenanceCases.workOrderId, like),
      ilike(maintenanceCases.driverName, like),
      ilike(maintenanceCases.shopNumber, like),
    ];
    // A digits-only query is an identifier, not a name. Exact hit plus prefix hit, because agents
    // type the first digits of a carrier id and expect it to narrow.
    if (/^\d+$/.test(q)) {
      terms.push(eq(maintenanceCases.carrierId, q));
      terms.push(sql`${maintenanceCases.carrierId} LIKE ${`${q}%`}`);
      terms.push(eq(maintenanceCases.referenceNumber, q));
    }
    const unitKey = normalizeUnit(q);
    if (unitKey) terms.push(sql`${UNIT_NORM} = ${unitKey}`);
    if (q.replace(/[^0-9]/g, '')) terms.push(sql`regexp_replace(${maintenanceCases.phone}, '[^0-9]', '', 'g') LIKE ${`%${q.replace(/[^0-9]/g, '')}%`}`); // phone: digit-substring match

    const search = or(...terms);
    if (search) conds.push(search);
  }

  // Picklist filters are EXACT. A substring match would silently widen "PMs" into "PMs / Mechanical"
  // and "PMs and CARB", making the count on the tab disagree with the rows under it.
  if (f.status?.length) conds.push(inArray(maintenanceCases.status, f.status));
  if (f.caseType?.length) conds.push(inArray(maintenanceCases.caseType, f.caseType));
  if (f.paymentMethod?.length) conds.push(inArray(maintenanceCases.paymentMethod, f.paymentMethod));
  if (f.paymentStatus?.length) conds.push(inArray(maintenanceCases.paymentStatus, f.paymentStatus));

  if (f.ownerZohoUserId?.trim()) {
    conds.push(eq(maintenanceCases.ownerZohoUserId, f.ownerZohoUserId.trim()));
  }
  if (f.carrierId?.trim()) conds.push(eq(maintenanceCases.carrierId, f.carrierId.trim()));
  if (f.invoiced !== undefined) conds.push(eq(maintenanceCases.invoiced, f.invoiced));
  if (f.completed !== undefined) {
    conds.push(
      f.completed
        ? isNotNull(maintenanceCases.caseCompletion)
        : isNull(maintenanceCases.caseCompletion),
    );
  }
  if (f.dateFrom) conds.push(sql`${maintenanceCases.caseDate} >= ${f.dateFrom}`);
  if (f.dateTo) conds.push(sql`${maintenanceCases.caseDate} <= ${f.dateTo}`);
  return conds;
}

const whereOf = (f: MaintenanceFilters): SQL | undefined => {
  const conds = buildFilters(f);
  return conds.length ? and(...conds) : undefined;
};

/** Count rows grouped by one column, dropping the filter that column itself drives. */
async function groupCount(
  column: AnyPgColumn,
  filters: MaintenanceFilters,
): Promise<Record<string, number>> {
  const grouped = await db
    .select({ key: column, n: sql<number>`count(*)::int` })
    .from(maintenanceCases)
    .where(whereOf(filters))
    .groupBy(column);
  const out: Record<string, number> = {};
  for (const r of grouped) out[r.key ?? '—'] = r.n;
  return out;
}

/**
 * The columns a CARD renders — deliberately not `select()`.
 *
 * A plain `select()` ships `raw` too: the whole original Zoho record, ~930 bytes a row, which was
 * **41% of the list response** (21KB of 52KB for one page of 24) and is read by nothing in the UI. It
 * exists for provenance and recovery, so it stays available on the single-record fetch and never
 * rides along with a list or a search-as-you-type.
 */
const CARD_COLUMNS = {
  id: maintenanceCases.id,
  zohoRecordId: maintenanceCases.zohoRecordId,
  source: maintenanceCases.source,
  name: maintenanceCases.name,
  companyZohoId: maintenanceCases.companyZohoId,
  companyName: maintenanceCases.companyName,
  carrierId: maintenanceCases.carrierId,
  unitNumber: maintenanceCases.unitNumber,
  status: maintenanceCases.status,
  caseType: maintenanceCases.caseType,
  caseDate: maintenanceCases.caseDate,
  caseCompletion: maintenanceCases.caseCompletion,
  driverName: maintenanceCases.driverName,
  phone: maintenanceCases.phone,
  shopNumber: maintenanceCases.shopNumber,
  parts: maintenanceCases.parts,
  workOrderId: maintenanceCases.workOrderId,
  referenceNumber: maintenanceCases.referenceNumber,
  paymentMethod: maintenanceCases.paymentMethod,
  paymentStatus: maintenanceCases.paymentStatus,
  invoiced: maintenanceCases.invoiced,
  cardDigits: maintenanceCases.cardDigits,
  totalAmount: maintenanceCases.totalAmount,
  completionCompensation: maintenanceCases.completionCompensation,
  halfCompletionCompensation: maintenanceCases.halfCompletionCompensation,
  leadCompensation: maintenanceCases.leadCompensation,
  ownerZohoUserId: maintenanceCases.ownerZohoUserId,
  ownerName: maintenanceCases.ownerName,
  bonusCompletionUserId: maintenanceCases.bonusCompletionUserId,
  bonusCompletionName: maintenanceCases.bonusCompletionName,
  bonusLeadName: maintenanceCases.bonusLeadName,
  createdTime: maintenanceCases.createdTime,
  modifiedTime: maintenanceCases.modifiedTime,
  createdByName: maintenanceCases.createdByName,
  updatedByName: maintenanceCases.updatedByName,
  createdAt: maintenanceCases.createdAt,
  updatedAt: maintenanceCases.updatedAt,
} as const;

export const maintenanceCaseRepo = {
  /** One page of cards + the grand total matching the same filters, in a SINGLE query. */
  async listPage(
    opts: { page?: number; perPage?: number; sort?: MaintenanceSort; dir?: 'asc' | 'desc' } &
      MaintenanceFilters,
  ): Promise<MaintenancePage> {
    const page = Math.max(1, opts.page || 1);
    // Capped at 100: these render as cards, which cost far more per row than table rows.
    const perPage = Math.min(100, Math.max(1, opts.perPage || 24));
    const offset = (page - 1) * perPage;
    const where = whereOf(opts);
    const order = ORDERS[opts.sort ?? 'date'][opts.dir === 'asc' ? 'asc' : 'desc'];

    /*
     * `count(*) OVER ()` carries the unpaginated total on every row, so the page and its total come
     * back together instead of as two queries. The previous Promise.all pair measured ~3 network
     * round-trips against the hosted DB versus ~2 for the heavy query alone; one statement removes
     * that. The window is evaluated after WHERE but before LIMIT, which is exactly the total we want.
     *
     * withDbRetry: this is the query behind the Maintenance tab's Refresh button — CS feedback
     * 2026-08-07 reported it throwing "Internal server error" (see db/retry.ts for why: a pooled
     * connection idling while the agent reads the list can be severed before our own idle_timeout
     * notices, and the read is idempotent so one retry on a fresh connection is safe).
     */
    const rows = await withDbRetry(() =>
      db
        .select({ ...CARD_COLUMNS, total: sql<number>`count(*) OVER ()::int` })
        .from(maintenanceCases)
        .where(where)
        .orderBy(order)
        .limit(perPage)
        .offset(offset),
    );

    // An empty page carries no window value — fall back to 0 for page 1, and for a page past the end
    // keep the caller's offset honest rather than reporting a total of 0 for a non-empty table.
    const total = rows[0]?.total ?? 0;
    const cards: MaintenanceCard[] = rows.map(({ total: _total, ...card }) => card);
    return { rows: cards, page, perPage, total, hasMore: offset + cards.length < total };
  },

  /**
   * Counts for the filter chrome.
   *
   * Each facet is computed with every filter EXCEPT the one it drives: the status counts ignore the
   * selected status, so the tabs keep showing how many cases each other status holds instead of
   * collapsing to "the tab you're on: N, everything else: 0".
   *
   * withDbRetry wraps the whole batch (see listPage's comment) — simplest correct behavior for a
   * transient failure in any one of the four parallel queries is to retry all four; they're plain
   * reads, so re-running the ones that already succeeded costs nothing but a little latency.
   */
  async facets(filters: MaintenanceFilters = {}): Promise<MaintenanceFacets> {
    const withoutStatus = { ...filters, status: undefined };
    const withoutCaseType = { ...filters, caseType: undefined };
    const withoutPaymentStatus = { ...filters, paymentStatus: undefined };

    const [byStatus, byCaseType, byPaymentStatus, totals] = await withDbRetry(() =>
      Promise.all([
        groupCount(maintenanceCases.status, withoutStatus),
        groupCount(maintenanceCases.caseType, withoutCaseType),
        groupCount(maintenanceCases.paymentStatus, withoutPaymentStatus),
        db
          .select({
            n: sql<number>`count(*)::int`,
            amt: sql<string>`coalesce(sum(${maintenanceCases.totalAmount}), 0)::text`,
          })
          .from(maintenanceCases)
          .where(whereOf(filters)),
      ]),
    );

    return {
      total: totals[0]?.n ?? 0,
      totalAmount: Number(totals[0]?.amt ?? 0) || 0,
      byStatus,
      byCaseType,
      byPaymentStatus,
    };
  },

  async getById(id: string): Promise<MaintenanceCase | undefined> {
    return firstOrUndefined(
      await db.select().from(maintenanceCases).where(eq(maintenanceCases.id, id)).limit(1),
    );
  },

  async getByZohoId(zohoRecordId: string): Promise<MaintenanceCase | undefined> {
    return firstOrUndefined(
      await db
        .select()
        .from(maintenanceCases)
        .where(eq(maintenanceCases.zohoRecordId, zohoRecordId))
        .limit(1),
    );
  },

  async insert(row: NewMaintenanceCase): Promise<MaintenanceCase | undefined> {
    try {
      return firstOrUndefined(await db.insert(maintenanceCases).values(row).returning());
    } catch (err) {
      throw referenceNumberConflict(err);
    }
  },

  async update(id: string, patch: Partial<NewMaintenanceCase>): Promise<MaintenanceCase | undefined> {
    return firstOrUndefined(
      await db
        .update(maintenanceCases)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(maintenanceCases.id, id))
        .returning(),
    );
  },

  /**
   * Migration upsert, keyed on the Zoho record id.
   *
   * `createdByUserId` / `createdByName` / `updatedByUserId` / `updatedByName` are DELIBERATELY absent
   * from `set`: a re-run must never clobber an edit an agent made in Mytrion (the same rule
   * paymentTransactionRepo.upsertMany follows for its mapping columns). `id` is absent too — a
   * migrated row keeps the cuid2 it was first given.
   *
   * Omitting those four columns from `set` was NOT enough to honour that rule. It preserved the
   * *audit trail* of an agent's edit while overwriting the edit itself: every business column above
   * still took `excluded.…`, so a re-import silently replaced an agent's corrected status or amount
   * with Zoho's frozen value and left `updated_by_user_id` pointing at the agent, as if they had made
   * the change. Zoho is not synced, so its value is by definition the stale one.
   *
   * Hence `setWhere`: a row that carries `updated_by_user_id` is owned by Mytrion and is skipped
   * outright. In ON CONFLICT DO UPDATE, an unqualified target column reads the EXISTING row (as
   * against `excluded.…` for the incoming one), which is what makes the test on the stored value work.
   * Skipped rows are counted separately rather than silently — an import that reports
   * `written < fetched` with no explanation looks like data loss.
   *
   * Chunked because the alternative is unusable at this RTT: hrEmployeeRepo measured 213 records at
   * ~4 round-trips each against the hosted Postgres (~266 ms RTT) taking ~226 s and never finishing
   * inside a request. Multi-row upserts bring the same work to a handful of round-trips.
   */
  async upsertMany(
    rows: NewMaintenanceCase[],
    opts: { chunkSize?: number } = {},
  ): Promise<{ written: number; skipped: number; chunks: number }> {
    if (!rows.length) return { written: 0, skipped: 0, chunks: 0 };
    const chunkSize = Math.min(500, Math.max(1, opts.chunkSize ?? 200));
    let written = 0;
    let skipped = 0;
    let chunks = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const res = await db
        .insert(maintenanceCases)
        .values(chunk)
        .onConflictDoUpdate({
          target: maintenanceCases.zohoRecordId,
          targetWhere: sql`${maintenanceCases.zohoRecordId} IS NOT NULL`,
          set: {
            source: sql`excluded.source`,
            name: sql`excluded.name`,
            companyZohoId: sql`excluded.company_zoho_id`,
            companyName: sql`excluded.company_name`,
            carrierId: sql`excluded.carrier_id`,
            unitNumber: sql`excluded.unit_number`,
            status: sql`excluded.status`,
            caseType: sql`excluded.case_type`,
            caseDate: sql`excluded.case_date`,
            caseCompletion: sql`excluded.case_completion`,
            driverName: sql`excluded.driver_name`,
            phone: sql`excluded.phone`,
            shopNumber: sql`excluded.shop_number`,
            parts: sql`excluded.parts`,
            workOrderId: sql`excluded.work_order_id`,
            referenceNumber: sql`excluded.reference_number`,
            paymentMethod: sql`excluded.payment_method`,
            paymentStatus: sql`excluded.payment_status`,
            invoiced: sql`excluded.invoiced`,
            cardDigits: sql`excluded.card_digits`,
            totalAmount: sql`excluded.total_amount`,
            completionCompensation: sql`excluded.completion_compensation`,
            halfCompletionCompensation: sql`excluded.half_completion_compensation`,
            leadCompensation: sql`excluded.lead_compensation`,
            ownerZohoUserId: sql`excluded.owner_zoho_user_id`,
            ownerName: sql`excluded.owner_name`,
            bonusCompletionUserId: sql`excluded.bonus_completion_user_id`,
            bonusCompletionName: sql`excluded.bonus_completion_name`,
            bonusLeadUserId: sql`excluded.bonus_lead_user_id`,
            bonusLeadName: sql`excluded.bonus_lead_name`,
            createdTime: sql`excluded.created_time`,
            modifiedTime: sql`excluded.modified_time`,
            raw: sql`excluded.raw`,
            syncedAt: sql`now()`,
            updatedAt: sql`now()`,
          },
          // Unqualified = the row already stored. Mytrion owns any row an agent has edited.
          setWhere: sql`${maintenanceCases.updatedByUserId} is null`,
        })
        .returning({ id: maintenanceCases.id });
      written += res.length;
      skipped += chunk.length - res.length;
      chunks += 1;
    }
    return { written, skipped, chunks };
  },

  /**
   * Individual maintenance cases for one carrier in a window — the itemized lines behind the
   * maintenance term of a Billing Ledger statement (the drill-down modal).
   *
   * Returns every payment method; the caller filters to the one that hits the EFS card for that client
   * type, because it also needs to itemize exactly what the aggregate counted.
   */
  async listForLedger(
    carrierId: string,
    startDate: string,
    endDateExclusive: string,
    limit = 5000,
  ): Promise<Array<{ id: string; caseDate: string | null; totalAmount: string | null; paymentMethod: string | null; caseType: string | null }>> {
    return db
      .select({
        id: maintenanceCases.id,
        caseDate: maintenanceCases.caseDate,
        totalAmount: maintenanceCases.totalAmount,
        paymentMethod: maintenanceCases.paymentMethod,
        caseType: maintenanceCases.caseType,
      })
      .from(maintenanceCases)
      .where(
        and(
          eq(maintenanceCases.carrierId, String(carrierId).trim()),
          sql`${maintenanceCases.caseDate} >= ${startDate}`,
          sql`${maintenanceCases.caseDate} < ${endDateExclusive}`,
        ),
      )
      .orderBy(asc(maintenanceCases.caseDate), asc(maintenanceCases.id))
      .limit(Math.min(20000, Math.max(1, limit)));
  },

  /**
   * Fee sums per carrier for a window, for an explicit set of payment methods — the maintenance term
   * in a Billing Ledger Customer Balance sub-ledger (TZ §5.1/§5.2).
   *
   * Generalizes `sumPrepayByCarrier` below, which is the `['Prepay / EFS']` case. The caller passes
   * the method(s) that hit the EFS card for that client type: `LOC_PAYMENT_METHOD` for LOC carriers,
   * `PREPAY_PAYMENT_METHOD` for Prepay. `Prepay / Card`, `Prepay / Zelle` and `Selfpay` settle
   * outside the card and must not be passed — including one would overstate Customer Balance credit.
   *
   * `endDateExclusive` is EXCLUSIVE, matching every other billing caller.
   */
  async sumByCarrierAndMethod(
    methods: readonly string[],
    startDate: string,
    endDateExclusive: string,
    carrierIds?: readonly string[],
  ): Promise<Map<string, number>> {
    if (!methods.length) return new Map();
    const conds = [
      inArray(maintenanceCases.paymentMethod, [...methods]),
      isNotNull(maintenanceCases.carrierId),
      sql`${maintenanceCases.caseDate} >= ${startDate}`,
      sql`${maintenanceCases.caseDate} < ${endDateExclusive}`,
    ];
    if (carrierIds?.length) {
      conds.push(inArray(maintenanceCases.carrierId, [...new Set(carrierIds)]));
    }
    const rows = await db
      .select({
        carrierId: maintenanceCases.carrierId,
        amt: sql<string>`coalesce(sum(${maintenanceCases.totalAmount}), 0)::text`,
      })
      .from(maintenanceCases)
      .where(and(...conds))
      .groupBy(maintenanceCases.carrierId);
    const out = new Map<string, number>();
    for (const r of rows) {
      if (r.carrierId) out.set(r.carrierId, Number(r.amt) || 0);
    }
    return out;
  },

  /**
   * Prepay fee sums per carrier for a window — the maintenance term in the prepay ledger's
   * `loaded = top_up - rmve + maintenance + money_code`.
   *
   * Semantics copied EXACTLY from servercrm's `services/prepayLedger.js`, which is what this
   * replaces: only `Payment_Method = 'Prepay / EFS'` counts (the other four methods never touch the
   * EFS balance), the fee is `total_amount`, and rows are bucketed on `case_date`. `endDate` is
   * EXCLUSIVE — the widget's `computeRange()` convention, which every prepay caller already passes.
   */
  async sumPrepayByCarrier(
    startDate: string,
    endDateExclusive: string,
  ): Promise<Map<string, number>> {
    const rows = await db
      .select({
        carrierId: maintenanceCases.carrierId,
        amt: sql<string>`coalesce(sum(${maintenanceCases.totalAmount}), 0)::text`,
      })
      .from(maintenanceCases)
      .where(
        and(
          eq(maintenanceCases.paymentMethod, PREPAY_PAYMENT_METHOD),
          isNotNull(maintenanceCases.carrierId),
          sql`${maintenanceCases.caseDate} >= ${startDate}`,
          sql`${maintenanceCases.caseDate} < ${endDateExclusive}`,
        ),
      )
      .groupBy(maintenanceCases.carrierId);
    const out = new Map<string, number>();
    for (const r of rows) {
      if (r.carrierId) out.set(r.carrierId, Number(r.amt) || 0);
    }
    return out;
  },

  /** Same semantics, one carrier, bucketed per calendar day — the ledger modal's daily column. */
  async sumPrepayByDay(
    carrierId: string,
    startDate: string,
    endDateExclusive: string,
  ): Promise<Map<string, number>> {
    const rows = await db
      .select({
        day: maintenanceCases.caseDate,
        amt: sql<string>`coalesce(sum(${maintenanceCases.totalAmount}), 0)::text`,
      })
      .from(maintenanceCases)
      .where(
        and(
          eq(maintenanceCases.carrierId, carrierId),
          eq(maintenanceCases.paymentMethod, PREPAY_PAYMENT_METHOD),
          sql`${maintenanceCases.caseDate} >= ${startDate}`,
          sql`${maintenanceCases.caseDate} < ${endDateExclusive}`,
        ),
      )
      .groupBy(maintenanceCases.caseDate);
    const out = new Map<string, number>();
    for (const r of rows) {
      if (r.day) out.set(String(r.day).slice(0, 10), Number(r.amt) || 0);
    }
    return out;
  },

  async countAll(): Promise<number> {
    const res = await db.select({ n: sql<number>`count(*)::int` }).from(maintenanceCases);
    return res[0]?.n ?? 0;
  },

  /** Owner filter options, straight from the table — so the tab needs no Zoho user call to render. */
  async distinctOwners(): Promise<OwnerFacet[]> {
    const rows = await db
      .select({
        ownerZohoUserId: maintenanceCases.ownerZohoUserId,
        ownerName: maintenanceCases.ownerName,
        n: sql<number>`count(*)::int`,
      })
      .from(maintenanceCases)
      .where(isNotNull(maintenanceCases.ownerZohoUserId))
      .groupBy(maintenanceCases.ownerZohoUserId, maintenanceCases.ownerName)
      .orderBy(sql`count(*) DESC`);
    return rows.map((r) => ({
      ownerZohoUserId: r.ownerZohoUserId ?? '',
      ownerName: r.ownerName ?? r.ownerZohoUserId ?? '',
      count: r.n,
    }));
  },

  /**
   * Values actually present in a picklist column. Unioned with the canonical lists so a legacy value
   * on a migrated record stays selectable even after Zoho stopped offering it.
   */
  async distinctPicklistValues(
    column: 'status' | 'caseType' | 'paymentMethod' | 'paymentStatus',
  ): Promise<string[]> {
    const col = maintenanceCases[column];
    const rows = await db
      .selectDistinct({ v: col })
      .from(maintenanceCases)
      .where(isNotNull(col))
      .orderBy(col);
    return rows.map((r) => r.v).filter((v): v is string => typeof v === 'string' && v !== '');
  },
};
