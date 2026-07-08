import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  carrierInvitations,
  type CarrierCompanyType,
  type CarrierInvitation,
  type NewCarrierInvitation,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

export interface CarrierInvitationDto {
  id: string;
  profile: CarrierInvitation['profile'];
  carrierId: string | null;
  applicationId: string | null;
  companyName: string | null;
  cardId: string | null;
  companyType: CarrierCompanyType | null;
  cardCount: number | null;
  agentName: string | null;
  agentZohoUserId: string | null;
  status: CarrierInvitation['status'];
  expiresAt: string;
  createdAt: string;
}

export interface CreateCarrierInvitationInput {
  profile: CarrierInvitation['profile'];
  carrierId?: string | undefined;
  applicationId?: string | undefined;
  companyName?: string | undefined;
  /** Driver only. */
  cardId?: string | undefined;
  /** Owner only — pre-resolved by the caller (route layer talks to the DWH, not the repo). */
  companyType?: CarrierCompanyType | undefined;
  cardCount?: number | undefined;
  agentName?: string | undefined;
  agentZohoUserId?: string | undefined;
  /** Invite lifetime in days (default 7). */
  ttlDays?: number | undefined;
}

function toDto(row: CarrierInvitation): CarrierInvitationDto {
  return {
    id: row.id,
    profile: row.profile,
    carrierId: row.carrierId,
    applicationId: row.applicationId,
    companyName: row.companyName,
    cardId: row.cardId,
    companyType: row.companyType,
    cardCount: row.cardCount,
    agentName: row.agentName,
    agentZohoUserId: row.agentZohoUserId,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

const trimOrNull = (v: string | null | undefined): string | null => v?.trim() || null;

export const carrierInvitationRepo = {
  async create(
    ctx: TenantContext,
    input: CreateCarrierInvitationInput,
  ): Promise<CarrierInvitationDto> {
    const ttlDays = input.ttlDays ?? 7;
    const values: NewCarrierInvitation = {
      tenantId: ctx.tenantId,
      profile: input.profile,
      carrierId: trimOrNull(input.carrierId),
      applicationId: trimOrNull(input.applicationId),
      companyName: trimOrNull(input.companyName),
      cardId: trimOrNull(input.cardId),
      companyType: input.companyType ?? null,
      cardCount: input.cardCount ?? null,
      agentName: trimOrNull(input.agentName),
      agentZohoUserId: trimOrNull(input.agentZohoUserId),
      expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
    };
    const rows = await db.insert(carrierInvitations).values(values).returning();
    return toDto(firstOrThrow(rows, 'Failed to insert carrier invitation'));
  },

  async findById(ctx: TenantContext, id: string): Promise<CarrierInvitation | undefined> {
    const rows = await db
      .select()
      .from(carrierInvitations)
      .where(and(eq(carrierInvitations.id, id), eq(carrierInvitations.tenantId, ctx.tenantId)))
      .limit(1);
    return rows[0];
  },

  /** Redemption is one-shot: only flips a still-pending invite (avoids a double-redeem race). */
  async markRedeemed(
    ctx: TenantContext,
    id: string,
    redeemedCarrierUserId: string,
  ): Promise<CarrierInvitation | undefined> {
    const rows = await db
      .update(carrierInvitations)
      .set({ status: 'redeemed', redeemedCarrierUserId, updatedAt: new Date() })
      .where(
        and(
          eq(carrierInvitations.id, id),
          eq(carrierInvitations.tenantId, ctx.tenantId),
          eq(carrierInvitations.status, 'pending'),
        ),
      )
      .returning();
    return rows[0];
  },
};
