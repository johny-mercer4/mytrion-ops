import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  carrierInvitations,
  type CarrierCompanyType,
  type CarrierInvitation,
  type NewCarrierInvitation,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

type TransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbClient = typeof db | TransactionClient;

export interface CarrierInvitationDto {
  id: string;
  profile: CarrierInvitation['profile'];
  carrierId: string | null;
  applicationId: string | null;
  companyName: string | null;
  cardId: string | null;
  driverName: string | null;
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
  /** Driver only. */
  driverName?: string | undefined;
  /** Owner only — pre-resolved by the caller (route layer talks to the DWH, not the repo). */
  companyType?: CarrierCompanyType | undefined;
  cardCount?: number | undefined;
  agentName?: string | undefined;
  agentZohoUserId?: string | undefined;
  /** Invite lifetime in days (default 7). */
  ttlDays?: number | undefined;
  /** Invite lifetime in hours — takes precedence over ttlDays (owner-issued driver links are 24h). */
  ttlHours?: number | undefined;
}

function toDto(row: CarrierInvitation): CarrierInvitationDto {
  return {
    id: row.id,
    profile: row.profile,
    carrierId: row.carrierId,
    applicationId: row.applicationId,
    companyName: row.companyName,
    cardId: row.cardId,
    driverName: row.driverName,
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
    client: DbClient = db,
  ): Promise<CarrierInvitationDto> {
    const ttlMs =
      input.ttlHours !== undefined
        ? input.ttlHours * 60 * 60 * 1000
        : (input.ttlDays ?? 7) * 24 * 60 * 60 * 1000;
    const values: NewCarrierInvitation = {
      tenantId: ctx.tenantId,
      profile: input.profile,
      carrierId: trimOrNull(input.carrierId),
      applicationId: trimOrNull(input.applicationId),
      companyName: trimOrNull(input.companyName),
      cardId: trimOrNull(input.cardId),
      driverName: trimOrNull(input.driverName),
      companyType: input.companyType ?? null,
      cardCount: input.cardCount ?? null,
      agentName: trimOrNull(input.agentName),
      agentZohoUserId: trimOrNull(input.agentZohoUserId),
      expiresAt: new Date(Date.now() + ttlMs),
    };
    const rows = await client.insert(carrierInvitations).values(values).returning();
    return toDto(firstOrThrow(rows, 'Failed to insert carrier invitation'));
  },

  /**
   * A still-live driver invite for this exact card (one-driver-per-card guard). "Live" = a pending
   * invite that hasn't expired; an expired/superseded one doesn't block re-issuing the card.
   */
  async findLiveDriverByCard(
    ctx: TenantContext,
    carrierId: string,
    cardId: string,
  ): Promise<CarrierInvitation | undefined> {
    const rows = await db
      .select()
      .from(carrierInvitations)
      .where(
        and(
          eq(carrierInvitations.tenantId, ctx.tenantId),
          eq(carrierInvitations.carrierId, carrierId),
          eq(carrierInvitations.cardId, cardId),
          eq(carrierInvitations.profile, 'driver'),
          eq(carrierInvitations.status, 'pending'),
        ),
      );
    return rows.find((r) => r.expiresAt.getTime() >= Date.now());
  },

  /**
   * All pending driver invites for a carrier, INCLUDING expired ones — the owner's fleet screen
   * shows expired links as their own state ("Link expired" -> regenerate). When one card has both
   * an expired and a fresh invite (after a regenerate), the freshest wins per card downstream.
   */
  async listPendingDriverInvitesByCarrier(
    ctx: TenantContext,
    carrierId: string,
  ): Promise<CarrierInvitationDto[]> {
    const rows = await db
      .select()
      .from(carrierInvitations)
      .where(
        and(
          eq(carrierInvitations.tenantId, ctx.tenantId),
          eq(carrierInvitations.carrierId, carrierId),
          eq(carrierInvitations.profile, 'driver'),
          eq(carrierInvitations.status, 'pending'),
        ),
      );
    return rows.map(toDto);
  },

  /** Every invitation for this tenant, newest first — the admin's "pending invitations" table. */
  async list(ctx: TenantContext): Promise<CarrierInvitationDto[]> {
    const rows = await db
      .select()
      .from(carrierInvitations)
      .where(eq(carrierInvitations.tenantId, ctx.tenantId))
      .orderBy(desc(carrierInvitations.createdAt));
    return rows.map(toDto);
  },

  /** Cancel a still-pending invite (one-shot, mirrors markRedeemed's guarded update). A no-op
   * (returns undefined) if it's already redeemed/cancelled — cancelling a used link makes no sense. */
  async cancel(ctx: TenantContext, id: string, client: DbClient = db): Promise<CarrierInvitationDto | undefined> {
    const rows = await client
      .update(carrierInvitations)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(carrierInvitations.id, id),
          eq(carrierInvitations.tenantId, ctx.tenantId),
          eq(carrierInvitations.status, 'pending'),
        ),
      )
      .returning();
    return rows[0] ? toDto(rows[0]) : undefined;
  },

  async findById(
    ctx: TenantContext,
    id: string,
    client: DbClient = db,
  ): Promise<CarrierInvitation | undefined> {
    const rows = await client
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
    client: DbClient = db,
  ): Promise<CarrierInvitation | undefined> {
    const rows = await client
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
