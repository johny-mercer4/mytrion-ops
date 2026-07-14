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

  /** Registered drivers of one carrier — the owner's fleet roster (who's actually signed in). */
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
        ),
      );
    return rows.map(toDto);
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
          updatedAt: new Date(),
        },
      })
      .returning();
    // returning() on an upsert always yields exactly the affected row.
    return rows[0]!;
  },
};
