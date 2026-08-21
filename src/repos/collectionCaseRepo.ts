/**
 * Collection cases + their unpaid CMP invoices.
 *
 * List + count run in one round trip so the desk can page and still show "Showing X–Y of Z".
 * Aggregates describe the WHOLE book (open / closed / remaining / by stage), never the current
 * page — a tile that changed when you filtered by it cannot be used to check your work.
 *
 * Invoices are loaded only on detail. The list already carries `issue_invoice_count` and the
 * debt totals; fetching 526 invoice rows for a 50-row page would be the unbounded join this
 * desk exists to avoid.
 */
import { and, desc, eq, gte, ilike, isNull, notExists, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  collectionCaseInvoices,
  collectionCases,
  type CollectionCase,
  type CollectionCaseInvoice,
  type CollectionCaseStatus,
  type CollectionClosedReason,
  type CollectionLossReason,
  type CollectionStage,
} from '../db/schema/collection.js';
import { collectionActivity } from '../db/schema/collection_desk.js';
import type { TenantContext } from '../types/tenantContext.js';
import { canReadCollectionSnapshot } from './collectionAccess.js';
import { firstOrUndefined, normalizePagination } from './util.js';

/** Board fetch needs every open case (~322). List pages stay at the 50-row default. */
export const COLLECTION_CASES_MAX_LIMIT = 500;

export interface CollectionCaseListFilter {
  limit?: number | undefined;
  offset?: number | undefined;
  status?: CollectionCaseStatus | undefined;
  stage?: CollectionStage | undefined;
  closedReason?: CollectionClosedReason | undefined;
  search?: string | undefined;
  /** Saved view: only cases with at least this much still outstanding. */
  minRemaining?: number | undefined;
  /** Saved view: nobody has ever logged a contact attempt against the case. */
  neverContacted?: boolean | undefined;
  /** "My cases". Pass `null` for the unassigned pool, which is a real thing to work through. */
  assigneeUserId?: string | null | undefined;
  /** Which agency holds it now. */
  currentAgency?: string | undefined;
}

export interface CollectionCaseDto {
  id: string;
  carrierId: string;
  status: CollectionCaseStatus;
  collectionStage: CollectionStage;
  displayName: string | null;
  debtorCompanyName: string | null;
  debtorFullName: string | null;
  debtorEmail: string | null;
  debtorSecondaryEmail: string | null;
  debtorPhone: string | null;
  debtorCellPhone: string | null;
  debtorAddress: string | null;
  debtorCity: string | null;
  debtorState: string | null;
  debtorZipCode: string | null;
  debtorMcDot: string | null;
  debtorDateOfBirth: string | null;
  totalDebtAmount: string;
  totalInvoiceAmount: string;
  totalAmountPaid: string;
  issueInvoiceCount: number;
  daysPastDue: number;
  firstDelinquentDate: string | null;
  placementDate: string | null;
  caseCreatedDate: string;
  closedAt: string | null;
  closedReason: CollectionClosedReason | null;
  zohoDealId: string | null;
  zohoRecordId: string | null;
  agencyTransferDate: string | null;
  firstCollectionAgency: string | null;

  // Desk-owned. The finder writes none of it — see the migration header on 0134.
  currentAgency: string | null;
  secondCollectionAgency: string | null;
  caineWeinerTier: string | null;
  agencyResponseStatus: string | null;
  legalActionRequired: boolean;
  courtType: string | null;
  legalFilingDate: string | null;
  legalDocumentsAttached: boolean;
  courtStatus: string | null;
  skipTraceRequired: boolean;
  verifiedEmail: string | null;
  verifiedPhone: string | null;
  verifiedAddress: string | null;
  escalationRequired: boolean;
  escalationDate: string | null;
  cooperationStatus: string | null;
  lossReason: CollectionLossReason | null;
  paymentReceived: boolean;
  paymentReceivedDate: string | null;
  reminderCycleActive: boolean;
  earlyBadDebtorFlag: boolean;
  totalCostIncurred: string;
  totalMerchantFee: string;

  assigneeUserId: string | null;
  assigneeName: string | null;
  assignedAt: string | null;
  currency: string;
  reopenCount: number;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionInvoiceDto {
  id: string;
  caseId: string;
  cmpInvoiceId: number;
  invoiceNumber: string | null;
  cmpStage: string | null;
  status: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  periodLabel: string | null;
  totalAmount: string;
  totalPaid: string;
  remainingAmount: string;
  totalMerchantFee: string;
  dueDate: string | null;
  cmpCreateDate: string | null;
  paymentDay: string | null;
  invoiceNotes: string | null;
  zohoDealId: string | null;
}

export interface CollectionCaseAggregates {
  open: number;
  closed: number;
  remainingDebt: string;
  byStage: Record<string, number>;
}

export interface CollectionCaseListResult {
  items: CollectionCaseDto[];
  total: number;
  aggregates: CollectionCaseAggregates;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const day = (d: string | null | undefined): string | null => (d ? d.slice(0, 10) : null);

export function toCollectionCaseDto(row: CollectionCase): CollectionCaseDto {
  return {
    id: row.id,
    carrierId: row.carrierId,
    status: row.status,
    collectionStage: row.collectionStage,
    displayName: row.displayName,
    debtorCompanyName: row.debtorCompanyName,
    debtorFullName: row.debtorFullName,
    debtorEmail: row.debtorEmail,
    debtorSecondaryEmail: row.debtorSecondaryEmail,
    debtorPhone: row.debtorPhone,
    debtorCellPhone: row.debtorCellPhone,
    debtorAddress: row.debtorAddress,
    debtorCity: row.debtorCity,
    debtorState: row.debtorState,
    debtorZipCode: row.debtorZipCode,
    debtorMcDot: row.debtorMcDot,
    debtorDateOfBirth: day(row.debtorDateOfBirth),
    totalDebtAmount: row.totalDebtAmount,
    totalInvoiceAmount: row.totalInvoiceAmount,
    totalAmountPaid: row.totalAmountPaid,
    issueInvoiceCount: row.issueInvoiceCount,
    daysPastDue: row.daysPastDue,
    firstDelinquentDate: day(row.firstDelinquentDate),
    placementDate: day(row.placementDate),
    caseCreatedDate: row.caseCreatedDate.slice(0, 10),
    closedAt: iso(row.closedAt),
    closedReason: row.closedReason ?? null,
    zohoDealId: row.zohoDealId,
    zohoRecordId: row.zohoRecordId,
    agencyTransferDate: day(row.agencyTransferDate),
    firstCollectionAgency: row.firstCollectionAgency,
    currentAgency: row.currentAgency,
    secondCollectionAgency: row.secondCollectionAgency,
    caineWeinerTier: row.caineWeinerTier,
    agencyResponseStatus: row.agencyResponseStatus,
    legalActionRequired: row.legalActionRequired,
    courtType: row.courtType,
    legalFilingDate: day(row.legalFilingDate),
    legalDocumentsAttached: row.legalDocumentsAttached,
    courtStatus: row.courtStatus,
    skipTraceRequired: row.skipTraceRequired,
    verifiedEmail: row.verifiedEmail,
    verifiedPhone: row.verifiedPhone,
    verifiedAddress: row.verifiedAddress,
    escalationRequired: row.escalationRequired,
    escalationDate: day(row.escalationDate),
    cooperationStatus: row.cooperationStatus,
    lossReason: row.lossReason ?? null,
    paymentReceived: row.paymentReceived,
    paymentReceivedDate: day(row.paymentReceivedDate),
    reminderCycleActive: row.reminderCycleActive,
    earlyBadDebtorFlag: row.earlyBadDebtorFlag,
    totalCostIncurred: row.totalCostIncurred,
    totalMerchantFee: row.totalMerchantFee,
    assigneeUserId: row.assigneeUserId,
    assigneeName: row.assigneeName,
    assignedAt: iso(row.assignedAt),
    currency: row.currency,
    reopenCount: row.reopenCount,
    lastSyncedAt: iso(row.lastSyncedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toCollectionInvoiceDto(row: CollectionCaseInvoice): CollectionInvoiceDto {
  return {
    id: row.id,
    caseId: row.caseId,
    cmpInvoiceId: row.cmpInvoiceId,
    invoiceNumber: row.invoiceNumber,
    cmpStage: row.cmpStage,
    status: row.status,
    periodFrom: day(row.periodFrom),
    periodTo: day(row.periodTo),
    periodLabel: row.periodLabel,
    totalAmount: row.totalAmount,
    totalPaid: row.totalPaid,
    remainingAmount: row.remainingAmount,
    totalMerchantFee: row.totalMerchantFee,
    dueDate: day(row.dueDate),
    cmpCreateDate: day(row.cmpCreateDate),
    paymentDay: row.paymentDay,
    invoiceNotes: row.invoiceNotes,
    zohoDealId: row.zohoDealId,
  };
}

const EMPTY_AGGREGATES: CollectionCaseAggregates = {
  open: 0,
  closed: 0,
  remainingDebt: '0',
  byStage: {},
};

/** Exported so the leakage test can assert the WHERE shape without hitting Postgres. */
export function buildCaseWhere(filter: CollectionCaseListFilter): SQL | undefined {
  const clauses: SQL[] = [];
  if (filter.status) clauses.push(eq(collectionCases.status, filter.status));
  if (filter.stage) clauses.push(eq(collectionCases.collectionStage, filter.stage));
  if (filter.closedReason) clauses.push(eq(collectionCases.closedReason, filter.closedReason));
  if (filter.minRemaining !== undefined) {
    clauses.push(gte(collectionCases.totalDebtAmount, String(filter.minRemaining)));
  }
  // NOT EXISTS rather than a LEFT JOIN … IS NULL: the join would multiply the case row by its
  // whole feed before discarding it, and this runs against the full book on every saved-view click.
  if (filter.assigneeUserId !== undefined) {
    clauses.push(
      filter.assigneeUserId === null
        ? isNull(collectionCases.assigneeUserId)
        : eq(collectionCases.assigneeUserId, filter.assigneeUserId),
    );
  }
  if (filter.currentAgency) clauses.push(eq(collectionCases.currentAgency, filter.currentAgency));
  if (filter.neverContacted) {
    clauses.push(
      notExists(
        db
          .select({ one: sql`1` })
          .from(collectionActivity)
          .where(
            and(
              eq(collectionActivity.caseId, collectionCases.id),
              eq(collectionActivity.kind, 'contact'),
            ),
          ),
      ),
    );
  }
  const q = filter.search?.trim();
  if (q) {
    const like = `%${q}%`;
    const search = or(
      ilike(collectionCases.displayName, like),
      ilike(collectionCases.debtorCompanyName, like),
      ilike(collectionCases.debtorFullName, like),
      ilike(collectionCases.carrierId, like),
      ilike(collectionCases.debtorMcDot, like),
      ilike(collectionCases.zohoDealId, like),
    );
    if (search) clauses.push(search);
  }
  return clauses.length ? and(...clauses) : undefined;
}

export function buildCaseListQuery(filter: CollectionCaseListFilter) {
  const { limit, offset } = normalizePagination(filter, COLLECTION_CASES_MAX_LIMIT);
  const where = buildCaseWhere(filter);
  return db
    .select()
    .from(collectionCases)
    .where(where)
    .orderBy(desc(collectionCases.updatedAt), desc(collectionCases.id))
    .limit(limit)
    .offset(offset);
}

function emptyList(): CollectionCaseListResult {
  return { items: [], total: 0, aggregates: EMPTY_AGGREGATES };
}

export const collectionCaseRepo = {
  async list(ctx: TenantContext, filter: CollectionCaseListFilter = {}): Promise<CollectionCaseListResult> {
    if (!canReadCollectionSnapshot(ctx)) return emptyList();
    const where = buildCaseWhere(filter);
    const [rows, counts, book, stages] = await Promise.all([
      buildCaseListQuery(filter),
      db.select({ count: sql<number>`count(*)::int` }).from(collectionCases).where(where),
      db
        .select({
          open: sql<number>`count(*) FILTER (WHERE ${collectionCases.status} = 'open')::int`,
          closed: sql<number>`count(*) FILTER (WHERE ${collectionCases.status} = 'closed')::int`,
          remainingDebt: sql<string>`coalesce(sum(${collectionCases.totalDebtAmount}) FILTER (WHERE ${collectionCases.status} = 'open'), 0)::text`,
        })
        .from(collectionCases),
      db
        .select({
          stage: collectionCases.collectionStage,
          n: sql<number>`count(*)::int`,
        })
        .from(collectionCases)
        .groupBy(collectionCases.collectionStage),
    ]);
    const byStage: Record<string, number> = {};
    for (const row of stages) byStage[row.stage] = row.n;
    const totals = book[0];
    return {
      items: rows.map(toCollectionCaseDto),
      total: counts[0]?.count ?? 0,
      aggregates: {
        open: totals?.open ?? 0,
        closed: totals?.closed ?? 0,
        remainingDebt: totals?.remainingDebt ?? '0',
        byStage,
      },
    };
  },

  async findById(ctx: TenantContext, id: string): Promise<CollectionCaseDto | undefined> {
    if (!canReadCollectionSnapshot(ctx)) return undefined;
    const row = firstOrUndefined(
      await db.select().from(collectionCases).where(eq(collectionCases.id, id)).limit(1),
    );
    return row ? toCollectionCaseDto(row) : undefined;
  },

  /**
   * Move a case to another stage.
   *
   * ⚠ `collection_cases` IS FINDER-OWNED. Every other column here is written by the upsert job,
   * and a future finder run can overwrite what the desk sets. Three columns are written by this
   * desk — `collection_stage`, `status`/`closed_*`, `placement_date` — because they are the ones
   * a human decides and the whole UI reads, and there is no second place to put them that the
   * board, the list and the spine would all agree on. Every one of these writes also lands in
   * `collection_activity`, so if the finder does clobber a stage the record of who moved it and
   * when survives. Confirm the finder's write set before this goes to prod.
   */
  async setStage(id: string, stage: CollectionStage): Promise<CollectionCaseDto | undefined> {
    const rows = await db
      .update(collectionCases)
      .set({ collectionStage: stage, updatedAt: new Date() })
      .where(eq(collectionCases.id, id))
      .returning();
    const row = rows[0];
    return row ? toCollectionCaseDto(row) : undefined;
  },

  /** Close a case with a reason from the real enum. Never deletes — reopening must stay possible. */
  async close(
    id: string,
    input: { reason: CollectionClosedReason; stage: CollectionStage },
  ): Promise<CollectionCaseDto | undefined> {
    const rows = await db
      .update(collectionCases)
      .set({
        status: 'closed',
        closedReason: input.reason,
        collectionStage: input.stage,
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(collectionCases.id, id))
      .returning();
    const row = rows[0];
    return row ? toCollectionCaseDto(row) : undefined;
  },

  /** Reopen. `reopen_count` is the finder's own column and is incremented, not reset. */
  async reopen(id: string): Promise<CollectionCaseDto | undefined> {
    const rows = await db
      .update(collectionCases)
      .set({
        status: 'open',
        closedReason: null,
        closedAt: null,
        reopenCount: sql`${collectionCases.reopenCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(collectionCases.id, id))
      .returning();
    const row = rows[0];
    return row ? toCollectionCaseDto(row) : undefined;
  },

  /**
   * Record a placement with an agency. Sets the stage too — the two are one decision.
   *
   * RE-PLACEMENT IS A REAL MOVE, not an error. The Blueprint has an explicit self-edge on With
   * Agency — "120 days · no payment → pick next agency" — so a case can go out to a second
   * agency, and this used to overwrite `first_collection_agency` and lose which agency had it
   * originally. `current_agency` is who holds it now; `first_` and `second_` are the history,
   * and `first_` is only ever written once.
   */
  async markPlaced(
    id: string,
    input: { placementDate: string; agency: string; tier?: string | null },
  ): Promise<CollectionCaseDto | undefined> {
    const existing = await db
      .select({
        first: collectionCases.firstCollectionAgency,
        current: collectionCases.currentAgency,
      })
      .from(collectionCases)
      .where(eq(collectionCases.id, id))
      .limit(1);
    const prior = existing[0];
    if (!prior) return undefined;

    const rows = await db
      .update(collectionCases)
      .set({
        placementDate: input.placementDate,
        agencyTransferDate: input.placementDate,
        currentAgency: input.agency,
        ...(prior.first ? {} : { firstCollectionAgency: input.agency }),
        // Only when it is genuinely a different agency taking over from a different first one.
        ...(prior.first && prior.first !== input.agency
          ? { secondCollectionAgency: input.agency }
          : {}),
        // The tier only means anything for Caine & Weiner, and it must not stick to the next
        // agency when the case moves on.
        caineWeinerTier: input.agency === 'Caine & Weiner' ? (input.tier ?? null) : null,
        agencyResponseStatus: 'Pending',
        collectionStage: 'with_agency',
        updatedAt: new Date(),
      })
      .where(eq(collectionCases.id, id))
      .returning();
    const row = rows[0];
    return row ? toCollectionCaseDto(row) : undefined;
  },

  async listInvoices(
    ctx: TenantContext,
    caseId: string,
    page?: { limit?: number | undefined; offset?: number | undefined },
  ): Promise<{ items: CollectionInvoiceDto[]; total: number }> {
    if (!canReadCollectionSnapshot(ctx)) return { items: [], total: 0 };
    const owned = await this.findById(ctx, caseId);
    if (!owned) return { items: [], total: 0 };
    const { limit, offset } = normalizePagination(page, 200);
    const where = eq(collectionCaseInvoices.caseId, caseId);
    const [rows, counts] = await Promise.all([
      db
        .select()
        .from(collectionCaseInvoices)
        .where(where)
        .orderBy(desc(collectionCaseInvoices.remainingAmount), desc(collectionCaseInvoices.id))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(collectionCaseInvoices).where(where),
    ]);
    return { items: rows.map(toCollectionInvoiceDto), total: counts[0]?.count ?? 0 };
  },
};
