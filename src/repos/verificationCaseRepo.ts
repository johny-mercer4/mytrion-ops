import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  verificationCases,
  type NewVerificationCase,
  type VerificationCase,
  type VerificationCaseStatus,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined, isUniqueViolation } from './util.js';

export type VerificationOwnerScope = 'unclaimed' | 'mine' | 'others';

export interface VerificationCaseListFilter {
  status?: VerificationCaseStatus;
  query?: string;
  unmatched?: boolean;
  owner?: VerificationOwnerScope;
  viewer?: string;
  limit?: number;
  offset?: number;
}

export interface VerificationCaseAggregates {
  open: number;
  shared: number;
  inProgress: number;
  awaitingDecision: number;
  unmatched: number;
  total: number;
  new: number;
  approved: number;
  rejected: number;
  failed: number;
  unclaimed: number;
  mine: number;
  stale: number;
}

/** List/DTO columns only — never `zoho_raw` (large jsonb) or unused carrier/address fields. */
export const VERIFICATION_CASE_LIST_COLUMNS = {
  id: verificationCases.id,
  zohoDealId: verificationCases.zohoDealId,
  zohoApplicationId: verificationCases.zohoApplicationId,
  requestId: verificationCases.requestId,
  companyName: verificationCases.companyName,
  firstName: verificationCases.firstName,
  lastName: verificationCases.lastName,
  email: verificationCases.email,
  phone: verificationCases.phone,
  dot: verificationCases.dot,
  mc: verificationCases.mc,
  zohoStage: verificationCases.zohoStage,
  applicationStatus: verificationCases.applicationStatus,
  applicationDate: verificationCases.applicationDate,
  creditScore: verificationCases.creditScore,
  distributeType: verificationCases.distributeType,
  ownerZohoUserId: verificationCases.ownerZohoUserId,
  ownerName: verificationCases.ownerName,
  matchedSnapshotId: verificationCases.matchedSnapshotId,
  matchedVia: verificationCases.matchedVia,
  carrierOperatingStatus: verificationCases.carrierOperatingStatus,
  status: verificationCases.status,
  currentStage: verificationCases.currentStage,
  stagesDone: verificationCases.stagesDone,
  stagesTotal: verificationCases.stagesTotal,
  lastDecision: verificationCases.lastDecision,
  firstRunStatus: verificationCases.firstRunStatus,
  firstRunError: verificationCases.firstRunError,
  cpOwnerUsername: verificationCases.cpOwnerUsername,
  approvedLimit: verificationCases.approvedLimit,
  paymentType: verificationCases.paymentType,
  billingCycle: verificationCases.billingCycle,
  plaidStatus: verificationCases.plaidStatus,
  plaidLinkUrl: verificationCases.plaidLinkUrl,
  plaidMode: verificationCases.plaidMode,
  cpClaimedAt: verificationCases.cpClaimedAt,
  cpReviewUpdatedAt: verificationCases.cpReviewUpdatedAt,
  lastSyncedAt: verificationCases.lastSyncedAt,
  createdAt: verificationCases.createdAt,
} as const;

export type VerificationCaseListRow = {
  [K in keyof typeof VERIFICATION_CASE_LIST_COLUMNS]: VerificationCase[K];
};

function listWhere(
  ctx: TenantContext,
  filter: Pick<VerificationCaseListFilter, 'status' | 'query' | 'unmatched' | 'owner' | 'viewer'>,
) {
  const clauses = [eq(verificationCases.tenantId, ctx.tenantId)];
  if (filter.status) clauses.push(eq(verificationCases.status, filter.status));
  if (filter.unmatched) clauses.push(sql`${verificationCases.matchedSnapshotId} is null`);
  const viewer = (filter.viewer ?? '').trim().toLowerCase();
  if (filter.owner === 'unclaimed') {
    clauses.push(sql`coalesce(btrim(${verificationCases.cpOwnerUsername}), '') = ''`);
  } else if (filter.owner === 'mine') {
    clauses.push(
      viewer
        ? sql`lower(btrim(${verificationCases.cpOwnerUsername})) = ${viewer}`
        : sql`false`,
    );
  } else if (filter.owner === 'others') {
    clauses.push(sql`coalesce(btrim(${verificationCases.cpOwnerUsername}), '') <> ''`);
    if (viewer) clauses.push(sql`lower(btrim(${verificationCases.cpOwnerUsername})) <> ${viewer}`);
  }
  const q = filter.query?.trim();
  if (q) {
    const pattern = `%${q}%`;
    const match = or(
      ilike(verificationCases.companyName, pattern),
      ilike(verificationCases.dot, pattern),
      ilike(verificationCases.email, pattern),
      ilike(verificationCases.phone, pattern),
      ilike(verificationCases.zohoDealId, pattern),
      ilike(verificationCases.zohoApplicationId, pattern),
    );
    if (match) clauses.push(match);
  }
  return and(...clauses);
}

export const verificationCaseRepo = {
  async findByDealId(ctx: TenantContext, zohoDealId: string): Promise<VerificationCase | undefined> {
    const rows = await db
      .select()
      .from(verificationCases)
      .where(
        and(eq(verificationCases.tenantId, ctx.tenantId), eq(verificationCases.zohoDealId, zohoDealId)),
      )
      .limit(1);
    return firstOrUndefined(rows);
  },

  async findById(ctx: TenantContext, id: string): Promise<VerificationCase | undefined> {
    const rows = await db
      .select()
      .from(verificationCases)
      .where(and(eq(verificationCases.tenantId, ctx.tenantId), eq(verificationCases.id, id)))
      .limit(1);
    return firstOrUndefined(rows);
  },

  async insert(ctx: TenantContext, input: Omit<NewVerificationCase, 'tenantId'>): Promise<VerificationCase> {
    try {
      const rows = await db
        .insert(verificationCases)
        .values({ ...input, tenantId: ctx.tenantId })
        .returning();
      return firstOrThrow(rows, 'verification_cases insert returned no row');
    } catch (err) {
      if (isUniqueViolation(err) && input.zohoDealId) {
        const existing = await this.findByDealId(ctx, input.zohoDealId);
        if (existing) return existing;
      }
      throw err;
    }
  },

  /** Compare-and-set so two refresh/ingest callers cannot both enqueue the first inbox row. */
  async claimFirstRun(
    ctx: TenantContext,
    id: string,
    opts: { retry?: boolean } = {},
  ): Promise<VerificationCase | undefined> {
    const allowed = opts.retry
      ? or(eq(verificationCases.firstRunStatus, 'idle'), eq(verificationCases.firstRunStatus, 'error'))
      : eq(verificationCases.firstRunStatus, 'idle');
    const rows = await db
      .update(verificationCases)
      .set({
        firstRunStatus: 'in_flight',
        firstRunError: null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(verificationCases.tenantId, ctx.tenantId), eq(verificationCases.id, id), allowed),
      )
      .returning();
    return firstOrUndefined(rows);
  },

  async update(
    ctx: TenantContext,
    id: string,
    patch: Partial<Omit<NewVerificationCase, 'id' | 'tenantId' | 'zohoDealId'>>,
  ): Promise<VerificationCase | undefined> {
    const rows = await db
      .update(verificationCases)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(verificationCases.tenantId, ctx.tenantId), eq(verificationCases.id, id)))
      .returning();
    return firstOrUndefined(rows);
  },

  async list(
    ctx: TenantContext,
    filter: VerificationCaseListFilter = {},
  ): Promise<VerificationCaseListRow[]> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 2000);
    const offset = Math.max(filter.offset ?? 0, 0);
    return db
      .select(VERIFICATION_CASE_LIST_COLUMNS)
      .from(verificationCases)
      .where(listWhere(ctx, filter))
      .orderBy(desc(verificationCases.applicationDate), desc(verificationCases.createdAt))
      .limit(limit)
      .offset(offset);
  },

  /** Filtered row count for pagination — not `aggregates.total`, which is unfiltered. */
  async count(ctx: TenantContext, filter: VerificationCaseListFilter = {}): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(verificationCases)
      .where(listWhere(ctx, filter));
    return Number(rows[0]?.n) || 0;
  },

  async aggregates(
    ctx: TenantContext,
    opts: { viewer?: string } = {},
  ): Promise<VerificationCaseAggregates> {
    const viewer = (opts.viewer ?? '').trim().toLowerCase();
    const rows = await db
      .select({
        total: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where ${verificationCases.status} in ('new', 'in_progress', 'awaiting_decision'))::int`,
        shared: sql<number>`count(*) filter (where ${verificationCases.distributeType} = 'shared')::int`,
        inProgress: sql<number>`count(*) filter (where ${verificationCases.status} = 'in_progress')::int`,
        awaitingDecision: sql<number>`count(*) filter (where ${verificationCases.status} = 'awaiting_decision')::int`,
        unmatched: sql<number>`count(*) filter (where ${verificationCases.matchedSnapshotId} is null)::int`,
        newCount: sql<number>`count(*) filter (where ${verificationCases.status} = 'new')::int`,
        approved: sql<number>`count(*) filter (where ${verificationCases.status} = 'approved')::int`,
        rejected: sql<number>`count(*) filter (where ${verificationCases.status} = 'rejected')::int`,
        failed: sql<number>`count(*) filter (where ${verificationCases.status} = 'failed')::int`,
        unclaimed: sql<number>`count(*) filter (where coalesce(btrim(${verificationCases.cpOwnerUsername}), '') = '')::int`,
        mine: viewer
          ? sql<number>`count(*) filter (where lower(btrim(${verificationCases.cpOwnerUsername})) = ${viewer})::int`
          : sql<number>`0::int`,
        stale: sql<number>`count(*) filter (
          where coalesce(btrim(${verificationCases.cpOwnerUsername}), '') <> ''
            and coalesce(${verificationCases.cpReviewUpdatedAt}, ${verificationCases.cpClaimedAt}, ${verificationCases.lastSyncedAt}, ${verificationCases.createdAt})
              <= now() - interval '30 minutes'
        )::int`,
      })
      .from(verificationCases)
      .where(eq(verificationCases.tenantId, ctx.tenantId));
    const row = rows[0];
    return {
      total: Number(row?.total) || 0,
      open: Number(row?.open) || 0,
      shared: Number(row?.shared) || 0,
      inProgress: Number(row?.inProgress) || 0,
      awaitingDecision: Number(row?.awaitingDecision) || 0,
      unmatched: Number(row?.unmatched) || 0,
      new: Number(row?.newCount) || 0,
      approved: Number(row?.approved) || 0,
      rejected: Number(row?.rejected) || 0,
      failed: Number(row?.failed) || 0,
      unclaimed: Number(row?.unclaimed) || 0,
      mine: Number(row?.mine) || 0,
      stale: Number(row?.stale) || 0,
    };
  },
};
