import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  registeredMiniAppCompanies,
  type CarrierCompanyType,
  type NewRegisteredMiniAppCompany,
  type RegisteredMiniAppCompany,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

type TransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbClient = typeof db | TransactionClient;

export interface RegisteredMiniAppCompanyDto {
  id: string;
  profile: 'owner' | 'driver';
  carrierId: string | null;
  applicationId: string | null;
  companyName: string | null;
  agentName: string | null;
  agentZohoUserId: string | null;
  cardId: string | null;
  driverName: string | null;
  companyType: CarrierCompanyType | null;
  cardCount: number | null;
  telegramUserId: string;
  telegramUsername: string | null;
  status: 'active' | 'revoked';
  revokedAt: string | null;
  createdAt: string;
}

export interface UpsertRegisteredMiniAppCompanyInput {
  invitationId: string;
  profile: 'owner' | 'driver';
  telegramUserId: string;
  telegramChatId?: string | undefined;
  telegramUsername?: string | undefined;
  carrierId?: string | undefined;
  applicationId?: string | undefined;
  companyName?: string | undefined;
  agentName?: string | undefined;
  agentZohoUserId?: string | undefined;
  cardId?: string | undefined;
  driverName?: string | undefined;
  companyType?: CarrierCompanyType | undefined;
  cardCount?: number | undefined;
}

function toDto(row: RegisteredMiniAppCompany): RegisteredMiniAppCompanyDto {
  return {
    id: row.id,
    profile: row.profile,
    carrierId: row.carrierId,
    applicationId: row.applicationId,
    companyName: row.companyName,
    agentName: row.agentName,
    agentZohoUserId: row.agentZohoUserId,
    cardId: row.cardId,
    driverName: row.driverName,
    companyType: row.companyType,
    cardCount: row.cardCount,
    telegramUserId: row.telegramUserId,
    telegramUsername: row.telegramUsername,
    status: row.status,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const registeredMiniAppCompanyRepo = {
  async findByTelegramUserId(
    ctx: TenantContext,
    telegramUserId: string,
    client: DbClient = db,
  ): Promise<RegisteredMiniAppCompany | undefined> {
    const rows = await client
      .select()
      .from(registeredMiniAppCompanies)
      .where(eq(registeredMiniAppCompanies.telegramUserId, telegramUserId))
      .limit(1);
    return rows.find((r) => r.tenantId === ctx.tenantId);
  },

  /** Every registration for this tenant, newest first — the admin tree groups these by carrierId. */
  async list(ctx: TenantContext): Promise<RegisteredMiniAppCompanyDto[]> {
    const rows = await db
      .select()
      .from(registeredMiniAppCompanies)
      .where(eq(registeredMiniAppCompanies.tenantId, ctx.tenantId))
      .orderBy(desc(registeredMiniAppCompanies.createdAt));
    return rows.map(toDto);
  },

  /**
   * ACTIVE registered drivers of one carrier — the owner's fleet roster, and the source of truth
   * for "is this card already taken" (assertDriverCardAvailable). Revoked drivers are excluded on
   * purpose: that's what frees their card up for reassignment.
   */
  async listDriversByCarrier(
    ctx: TenantContext,
    carrierId: string,
  ): Promise<RegisteredMiniAppCompanyDto[]> {
    const rows = await db
      .select()
      .from(registeredMiniAppCompanies)
      .where(
        and(
          eq(registeredMiniAppCompanies.tenantId, ctx.tenantId),
          eq(registeredMiniAppCompanies.carrierId, carrierId),
          eq(registeredMiniAppCompanies.profile, 'driver'),
          eq(registeredMiniAppCompanies.status, 'active'),
        ),
      );
    return rows.map(toDto);
  },

  /**
   * Rename the ACTIVE driver holding one card — the owner correcting their fleet roster.
   *
   * Keyed by (tenant, carrier, card), never by a client-supplied row id: an id would let one owner
   * name-edit another carrier's driver by guessing, since the ids are opaque but enumerable in a
   * response. The carrier here comes from the caller's own registration, so the where-clause IS the
   * authorization.
   */
  async renameDriverByCard(
    ctx: TenantContext,
    carrierId: string,
    cardId: string,
    driverName: string,
  ): Promise<RegisteredMiniAppCompanyDto | undefined> {
    const rows = await db
      .update(registeredMiniAppCompanies)
      .set({ driverName, updatedAt: new Date() })
      .where(
        and(
          eq(registeredMiniAppCompanies.tenantId, ctx.tenantId),
          eq(registeredMiniAppCompanies.carrierId, carrierId),
          eq(registeredMiniAppCompanies.cardId, cardId),
          eq(registeredMiniAppCompanies.profile, 'driver'),
          eq(registeredMiniAppCompanies.status, 'active'),
        ),
      )
      .returning();
    return rows[0] ? toDto(rows[0]) : undefined;
  },

  /** Soft-disable: revokes access without deleting the row, preserving registration history. */
  async revoke(ctx: TenantContext, id: string): Promise<RegisteredMiniAppCompanyDto | undefined> {
    const rows = await db
      .update(registeredMiniAppCompanies)
      .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(registeredMiniAppCompanies.id, id), eq(registeredMiniAppCompanies.tenantId, ctx.tenantId)))
      .returning();
    return rows[0] ? toDto(rows[0]) : undefined;
  },

  /** Re-opening the same invite link just confirms the existing registration (upsert on telegram_user_id). */
  async upsert(
    ctx: TenantContext,
    input: UpsertRegisteredMiniAppCompanyInput,
    client: DbClient = db,
  ): Promise<RegisteredMiniAppCompany> {
    const values: NewRegisteredMiniAppCompany = {
      tenantId: ctx.tenantId,
      invitationId: input.invitationId,
      profile: input.profile,
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId ?? null,
      telegramUsername: input.telegramUsername ?? null,
      carrierId: input.carrierId ?? null,
      applicationId: input.applicationId ?? null,
      companyName: input.companyName ?? null,
      agentName: input.agentName ?? null,
      agentZohoUserId: input.agentZohoUserId ?? null,
      cardId: input.cardId ?? null,
      driverName: input.driverName ?? null,
      companyType: input.companyType ?? null,
      cardCount: input.cardCount ?? null,
    };
    const rows = await client
      .insert(registeredMiniAppCompanies)
      .values(values)
      .onConflictDoUpdate({
        target: [registeredMiniAppCompanies.tenantId, registeredMiniAppCompanies.telegramUserId],
        set: {
          invitationId: input.invitationId,
          profile: input.profile,
          telegramChatId: input.telegramChatId ?? null,
          telegramUsername: input.telegramUsername ?? null,
          carrierId: input.carrierId ?? null,
          applicationId: input.applicationId ?? null,
          companyName: input.companyName ?? null,
          agentName: input.agentName ?? null,
          agentZohoUserId: input.agentZohoUserId ?? null,
          cardId: input.cardId ?? null,
          driverName: input.driverName ?? null,
          companyType: input.companyType ?? null,
          cardCount: input.cardCount ?? null,
          // Redeeming a valid invite IS the grant of access, so it must clear a previous revoke.
          // Without these the row kept status='revoked' through a successful redeem: the call
          // returned 201 with a registration, and every subsequent request 403'd MINI_APP_REVOKED
          // — a re-registration that silently reported success and granted nothing.
          status: 'active',
          revokedAt: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    // returning() on an upsert always yields exactly the affected row.
    return rows[0]!;
  },
};
