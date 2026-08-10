import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  carrierUsers,
  type CarrierProfile,
  type CarrierUser,
  type NewCarrierUser,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

export interface UpsertCarrierUserPasswordInput {
  profile: CarrierProfile;
  login: string;
  passwordHash: string;
  carrierId?: string | undefined;
  applicationId?: string | undefined;
  parentUserId?: string | undefined;
  cardId?: string | undefined;
  companyName?: string | undefined;
  registrationId?: string | undefined;
  telegramUserId?: string | undefined;
  agentName?: string | undefined;
  agentZohoUserId?: string | undefined;
}

function clean(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

export const carrierUserRepo = {
  async findByLogin(ctx: TenantContext, login: string): Promise<CarrierUser | undefined> {
    const rows = await db
      .select()
      .from(carrierUsers)
      .where(and(eq(carrierUsers.tenantId, ctx.tenantId), eq(carrierUsers.login, login)))
      .limit(1);
    return rows[0];
  },

  async findByTelegramUserId(
    ctx: TenantContext,
    telegramUserId: string,
  ): Promise<CarrierUser | undefined> {
    const rows = await db
      .select()
      .from(carrierUsers)
      .where(
        and(
          eq(carrierUsers.tenantId, ctx.tenantId),
          eq(carrierUsers.telegramUserId, telegramUserId),
          eq(carrierUsers.status, 'active'),
        ),
      )
      .limit(1);
    return rows[0];
  },

  /** Any status — used when reactivating a revoked password account on set-password. */
  async findAnyByTelegramUserId(
    ctx: TenantContext,
    telegramUserId: string,
  ): Promise<CarrierUser | undefined> {
    const rows = await db
      .select()
      .from(carrierUsers)
      .where(
        and(
          eq(carrierUsers.tenantId, ctx.tenantId),
          eq(carrierUsers.telegramUserId, telegramUserId),
        ),
      )
      .limit(1);
    return rows[0];
  },

  async findById(ctx: TenantContext, id: string): Promise<CarrierUser | undefined> {
    const rows = await db
      .select()
      .from(carrierUsers)
      .where(and(eq(carrierUsers.tenantId, ctx.tenantId), eq(carrierUsers.id, id)))
      .limit(1);
    return rows[0];
  },

  async findByRegistrationId(
    ctx: TenantContext,
    registrationId: string,
  ): Promise<CarrierUser | undefined> {
    const rows = await db
      .select()
      .from(carrierUsers)
      .where(
        and(
          eq(carrierUsers.tenantId, ctx.tenantId),
          eq(carrierUsers.registrationId, registrationId),
          eq(carrierUsers.status, 'active'),
        ),
      )
      .limit(1);
    return rows[0];
  },

  async loginTaken(ctx: TenantContext, login: string, exceptId?: string): Promise<boolean> {
    const rows = await db
      .select({ id: carrierUsers.id })
      .from(carrierUsers)
      .where(
        and(
          eq(carrierUsers.tenantId, ctx.tenantId),
          eq(carrierUsers.login, login),
          eq(carrierUsers.status, 'active'),
          ...(exceptId ? [sql`${carrierUsers.id} <> ${exceptId}`] : []),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },

  /**
   * Create or replace the password account for a Telegram registration. Re-setting password on the
   * same telegram user updates the hash in place (invite re-open / sales reset). Also reactivates
   * a previously disabled row — findByTelegramUserId is active-only, so looking that up alone
   * would INSERT and hit carrier_users_tenant_telegram_uk (500 on set-password after Remove).
   */
  async upsertForTelegram(
    ctx: TenantContext,
    input: UpsertCarrierUserPasswordInput,
  ): Promise<CarrierUser> {
    const telegramUserId = clean(input.telegramUserId);
    if (!telegramUserId) {
      throw new Error('telegramUserId is required for mini-app password accounts');
    }
    const existing = await this.findAnyByTelegramUserId(ctx, telegramUserId);
    if (existing) {
      const rows = await db
        .update(carrierUsers)
        .set({
          profile: input.profile,
          login: input.login,
          passwordHash: input.passwordHash,
          carrierId: clean(input.carrierId),
          applicationId: clean(input.applicationId),
          parentUserId: clean(input.parentUserId),
          cardId: clean(input.cardId),
          companyName: clean(input.companyName),
          registrationId: clean(input.registrationId),
          agentName: clean(input.agentName),
          agentZohoUserId: clean(input.agentZohoUserId),
          status: 'active',
          updatedAt: new Date(),
        })
        .where(and(eq(carrierUsers.tenantId, ctx.tenantId), eq(carrierUsers.id, existing.id)))
        .returning();
      return firstOrThrow(rows, 'carrier_users update returned no row');
    }

    const values: NewCarrierUser = {
      tenantId: ctx.tenantId,
      profile: input.profile,
      login: input.login,
      passwordHash: input.passwordHash,
      carrierId: clean(input.carrierId),
      applicationId: clean(input.applicationId),
      parentUserId: clean(input.parentUserId),
      cardId: clean(input.cardId),
      companyName: clean(input.companyName),
      registrationId: clean(input.registrationId),
      telegramUserId,
      agentName: clean(input.agentName),
      agentZohoUserId: clean(input.agentZohoUserId),
    };
    const rows = await db.insert(carrierUsers).values(values).returning();
    return firstOrThrow(rows, 'carrier_users insert returned no row');
  },

  async updatePasswordHash(ctx: TenantContext, id: string, passwordHash: string): Promise<CarrierUser | undefined> {
    const rows = await db
      .update(carrierUsers)
      .set({ passwordHash, updatedAt: new Date() })
      .where(and(eq(carrierUsers.tenantId, ctx.tenantId), eq(carrierUsers.id, id)))
      .returning();
    return rows[0];
  },

  async touchLastLogin(ctx: TenantContext, id: string): Promise<void> {
    await db
      .update(carrierUsers)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(and(eq(carrierUsers.tenantId, ctx.tenantId), eq(carrierUsers.id, id)));
  },

  async disable(ctx: TenantContext, id: string): Promise<CarrierUser | undefined> {
    const existing = await this.findById(ctx, id);
    if (!existing) return undefined;
    // Login unique is status-agnostic — suffix so the company/manager name can be re-invited.
    const freedLogin = `${existing.login}__revoked__${existing.id.slice(-10)}`.slice(0, 200);
    const rows = await db
      .update(carrierUsers)
      .set({ status: 'disabled', login: freedLogin, updatedAt: new Date() })
      .where(and(eq(carrierUsers.tenantId, ctx.tenantId), eq(carrierUsers.id, id)))
      .returning();
    return rows[0];
  },

  async disableByRegistrationId(
    ctx: TenantContext,
    registrationId: string,
  ): Promise<CarrierUser | undefined> {
    const existing = await this.findByRegistrationId(ctx, registrationId);
    if (!existing) return undefined;
    return this.disable(ctx, existing.id);
  },
};
