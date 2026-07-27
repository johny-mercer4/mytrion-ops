import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionRejectionReports,
  type MytrionRejectionReport,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined, isUniqueViolation, normalizePagination } from './util.js';

/** Caller-supplied fields for one rejection report; tenant + defaults are set by the repo. */
export interface CreateRejectionReportInput {
  /** Zoho Desk ticket id — the idempotency key for Deluge retries. */
  zohoTicketId?: string | null;
  errorCode: string;
  errorDescription?: string | null;
  carrierId: string;
  applicationId?: string | null;
  companyName?: string | null;
  cardNumber?: string | null;
  driverName?: string | null;
  driverId?: string | null;
  unitNumber?: string | null;
  locationName?: string | null;
  locationCity?: string | null;
  locationState?: string | null;
  stationName?: string | null;
  isNetwork?: boolean;
  isFraud?: boolean;
  paymentType?: string | null;
  automatedResponse?: string | null;
  agentZohoUserId?: string | null;
  agentName?: string | null;
  ownerSource?: 'dim_company' | 'zoho_deal' | 'unresolved';
  occurredAt?: Date | null;
}

/** Last 4 of a card number, for display without reading the full value. */
function last4(card: string | null | undefined): string | null {
  const digits = (card ?? '').replace(/\D+/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * mytrion_rejection_reports — card declines captured from the Zoho Desk Deluge automation.
 *
 * Every read/write is tenant-scoped (`ctx.tenantId`); there are no DB FKs, so isolation lives here.
 *
 * Reads match an agent on id-OR-name. That is not belt-and-braces: a worker's session Zoho id and
 * `dim_company.agent_zoho_user_id` carry different org prefixes, which is why the roster's
 * `buildOwnedCte` matches on the last 12 digits and falls back to the display name. Matching on the
 * stored id alone would return zero rows for agents whose ids differ, so `listForAgent` accepts both
 * and compares the id by its 12-digit suffix.
 */
export const rejectionReportRepo = {
  /** One row by its Zoho ticket id (idempotency lookup). Tenant-scoped. */
  async findByTicketId(
    ctx: TenantContext,
    zohoTicketId: string,
  ): Promise<MytrionRejectionReport | undefined> {
    const rows = await db
      .select()
      .from(mytrionRejectionReports)
      .where(
        and(
          eq(mytrionRejectionReports.tenantId, ctx.tenantId),
          eq(mytrionRejectionReports.zohoTicketId, zohoTicketId),
        ),
      )
      .limit(1);
    return firstOrUndefined(rows);
  },

  /**
   * Insert one report. On a unique violation (the partial index on tenant+ticket) the Deluge is
   * simply retrying, so re-read and return the winning row rather than erroring — the webhook must
   * be idempotent.
   */
  async create(
    ctx: TenantContext,
    input: CreateRejectionReportInput,
  ): Promise<MytrionRejectionReport> {
    try {
      const rows = await db
        .insert(mytrionRejectionReports)
        .values({
          tenantId: ctx.tenantId,
          zohoTicketId: input.zohoTicketId ?? null,
          errorCode: input.errorCode,
          errorDescription: input.errorDescription ?? null,
          carrierId: input.carrierId,
          applicationId: input.applicationId ?? null,
          companyName: input.companyName ?? null,
          cardNumber: input.cardNumber ?? null,
          cardLast4: last4(input.cardNumber),
          driverName: input.driverName ?? null,
          driverId: input.driverId ?? null,
          unitNumber: input.unitNumber ?? null,
          locationName: input.locationName ?? null,
          locationCity: input.locationCity ?? null,
          locationState: input.locationState ?? null,
          stationName: input.stationName ?? null,
          isNetwork: input.isNetwork ?? false,
          isFraud: input.isFraud ?? false,
          paymentType: input.paymentType ?? null,
          automatedResponse: input.automatedResponse ?? null,
          agentZohoUserId: input.agentZohoUserId ?? null,
          agentName: input.agentName ?? null,
          ownerSource: input.ownerSource ?? 'unresolved',
          occurredAt: input.occurredAt ?? null,
        })
        .returning();
      return firstOrThrow(rows, 'Failed to insert rejection report');
    } catch (err) {
      if (isUniqueViolation(err) && input.zohoTicketId) {
        const existing = await this.findByTicketId(ctx, input.zohoTicketId);
        if (existing) return existing;
      }
      throw err;
    }
  },

  /**
   * One agent's reports, newest first. `agentZohoUserId` is compared by its last 12 digits (the
   * org-prefix-tolerant match the DWH roster uses) and `agentName` is an equal-weight alternative,
   * because either identifier alone misses rows. Admins call {@link listAll} instead.
   */
  async listForAgent(
    ctx: TenantContext,
    opts: {
      agentZohoUserId?: string | null;
      agentName?: string | null;
      limit?: number;
      offset?: number;
    },
  ): Promise<MytrionRejectionReport[]> {
    const { limit, offset } = normalizePagination(opts);
    const id = opts.agentZohoUserId?.trim();
    const name = opts.agentName?.trim();
    const arms = [];
    if (id) {
      arms.push(
        sql`lpad(right(regexp_replace(${mytrionRejectionReports.agentZohoUserId}, '\\D', '', 'g'), 12), 12, '0')
            = lpad(right(regexp_replace(${id}, '\\D', '', 'g'), 12), 12, '0')`,
      );
    }
    if (name) {
      arms.push(sql`lower(${mytrionRejectionReports.agentName}) = lower(${name})`);
    }
    // No identifier at all → return nothing rather than the whole tenant's feed.
    if (arms.length === 0) return [];
    return db
      .select()
      .from(mytrionRejectionReports)
      .where(and(eq(mytrionRejectionReports.tenantId, ctx.tenantId), or(...arms)))
      .orderBy(desc(mytrionRejectionReports.occurredAt), desc(mytrionRejectionReports.createdAt))
      .limit(limit)
      .offset(offset);
  },

  /** Every report for the tenant, newest first (admin / all-department view). */
  async listAll(
    ctx: TenantContext,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<MytrionRejectionReport[]> {
    const { limit, offset } = normalizePagination(opts);
    return db
      .select()
      .from(mytrionRejectionReports)
      .where(eq(mytrionRejectionReports.tenantId, ctx.tenantId))
      .orderBy(desc(mytrionRejectionReports.occurredAt), desc(mytrionRejectionReports.createdAt))
      .limit(limit)
      .offset(offset);
  },

  /** Reports the owner resolver could not attribute — surfaced so they are triaged, not lost. */
  async listUnassigned(
    ctx: TenantContext,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<MytrionRejectionReport[]> {
    const { limit, offset } = normalizePagination(opts);
    return db
      .select()
      .from(mytrionRejectionReports)
      .where(
        and(
          eq(mytrionRejectionReports.tenantId, ctx.tenantId),
          isNull(mytrionRejectionReports.agentZohoUserId),
          isNull(mytrionRejectionReports.agentName),
        ),
      )
      .orderBy(desc(mytrionRejectionReports.createdAt))
      .limit(limit)
      .offset(offset);
  },
};
