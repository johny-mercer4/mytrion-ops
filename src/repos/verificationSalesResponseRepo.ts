import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  verificationSalesResponses,
  type VerificationSalesResponse,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

export interface CreateVerificationSalesResponseInput {
  requestId: string;
  dealId: string;
  externalEventId: string;
  ownerZohoUserId: string;
  responseValues: Record<string, string>;
  note: string | null;
  attachmentName: string | null;
  attachmentContentType: string | null;
  attachmentSizeBytes: number | null;
  zohoNoteId: string | null;
  syncWarning: string | null;
}

/** Tenant-isolated response history and idempotency for Sales → Verification requests. */
export const verificationSalesResponseRepo = {
  async findByEvent(
    ctx: TenantContext,
    requestId: string,
    externalEventId: string,
  ): Promise<VerificationSalesResponse | undefined> {
    const rows = await db
      .select()
      .from(verificationSalesResponses)
      .where(
        and(
          eq(verificationSalesResponses.tenantId, ctx.tenantId),
          eq(verificationSalesResponses.requestId, requestId),
          eq(verificationSalesResponses.externalEventId, externalEventId),
        ),
      )
      .limit(1);
    return rows[0];
  },

  async listForRequest(ctx: TenantContext, requestId: string): Promise<VerificationSalesResponse[]> {
    return db
      .select()
      .from(verificationSalesResponses)
      .where(
        and(
          eq(verificationSalesResponses.tenantId, ctx.tenantId),
          eq(verificationSalesResponses.requestId, requestId),
        ),
      )
      .orderBy(desc(verificationSalesResponses.createdAt));
  },

  async listForRequests(
    ctx: TenantContext,
    requestIds: string[],
  ): Promise<VerificationSalesResponse[]> {
    if (requestIds.length === 0) return [];
    return db
      .select()
      .from(verificationSalesResponses)
      .where(
        and(
          eq(verificationSalesResponses.tenantId, ctx.tenantId),
          inArray(verificationSalesResponses.requestId, requestIds),
        ),
      )
      .orderBy(desc(verificationSalesResponses.createdAt));
  },

  async create(
    ctx: TenantContext,
    input: CreateVerificationSalesResponseInput,
  ): Promise<VerificationSalesResponse> {
    const rows = await db
      .insert(verificationSalesResponses)
      .values({ tenantId: ctx.tenantId, ...input })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('verification sales response insert returned no row');
    return row;
  },
};
