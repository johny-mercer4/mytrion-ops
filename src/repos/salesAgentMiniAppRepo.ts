import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  salesAgentMiniAppInvitations,
  salesAgentMiniAppPrincipals,
  type SalesAgentMiniAppInvitation,
  type SalesAgentMiniAppPrincipal,
} from '../db/schema/index.js';
import { AppError, ConflictError, NotFoundError } from '../lib/errors.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

export interface CreateSalesAgentMiniAppInvitationInput {
  zohoUserId: string;
  agentName: string;
  requestedCarrierId?: string | undefined;
  ttlMinutes?: number | undefined;
}

export interface RedeemSalesAgentMiniAppInvitationInput {
  invitationId: string;
  telegramUserId: string;
  telegramUsername?: string | undefined;
  languageCode?: string | undefined;
}

const clean = (value: string | null | undefined): string | null => value?.trim() || null;

export const salesAgentMiniAppRepo = {
  async createInvitation(
    ctx: TenantContext,
    input: CreateSalesAgentMiniAppInvitationInput,
  ): Promise<SalesAgentMiniAppInvitation> {
    const ttlMs = (input.ttlMinutes ?? 30) * 60_000;
    const rows = await db
      .insert(salesAgentMiniAppInvitations)
      .values({
        tenantId: ctx.tenantId,
        zohoUserId: input.zohoUserId.trim(),
        agentName: input.agentName.trim(),
        requestedCarrierId: clean(input.requestedCarrierId),
        expiresAt: new Date(Date.now() + ttlMs),
      })
      .returning();
    return firstOrThrow(rows, 'Failed to create Sales agent mini-app invitation');
  },

  async findInvitation(
    ctx: TenantContext,
    id: string,
  ): Promise<SalesAgentMiniAppInvitation | undefined> {
    const rows = await db
      .select()
      .from(salesAgentMiniAppInvitations)
      .where(
        and(
          eq(salesAgentMiniAppInvitations.tenantId, ctx.tenantId),
          eq(salesAgentMiniAppInvitations.id, id),
        ),
      )
      .limit(1);
    return rows[0];
  },

  async findPrincipalByTelegramUserId(
    ctx: TenantContext,
    telegramUserId: string,
  ): Promise<SalesAgentMiniAppPrincipal | undefined> {
    const rows = await db
      .select()
      .from(salesAgentMiniAppPrincipals)
      .where(
        and(
          eq(salesAgentMiniAppPrincipals.tenantId, ctx.tenantId),
          eq(salesAgentMiniAppPrincipals.telegramUserId, telegramUserId),
        ),
      )
      .limit(1);
    return rows[0];
  },

  async findPrincipalByZohoUserId(
    ctx: TenantContext,
    zohoUserId: string,
  ): Promise<SalesAgentMiniAppPrincipal | undefined> {
    const rows = await db
      .select()
      .from(salesAgentMiniAppPrincipals)
      .where(
        and(
          eq(salesAgentMiniAppPrincipals.tenantId, ctx.tenantId),
          eq(salesAgentMiniAppPrincipals.zohoUserId, zohoUserId),
        ),
      )
      .limit(1);
    return rows[0];
  },

  /** Atomically burn the one-time link and bind exactly one Telegram identity to one Zoho agent. */
  async redeemInvitation(
    ctx: TenantContext,
    input: RedeemSalesAgentMiniAppInvitationInput,
  ): Promise<{ invitation: SalesAgentMiniAppInvitation; principal: SalesAgentMiniAppPrincipal }> {
    return db.transaction(async (tx) => {
      const inviteRows = await tx
        .select()
        .from(salesAgentMiniAppInvitations)
        .where(
          and(
            eq(salesAgentMiniAppInvitations.tenantId, ctx.tenantId),
            eq(salesAgentMiniAppInvitations.id, input.invitationId),
          ),
        )
        .limit(1);
      const invitation = inviteRows[0];
      if (!invitation) throw new NotFoundError('This Sales agent registration link is not valid');
      if (invitation.status === 'cancelled') {
        throw new AppError('This Sales agent registration link was cancelled', {
          statusCode: 410,
          code: 'SALES_AGENT_INVITE_CANCELLED',
          expose: true,
        });
      }
      if (invitation.expiresAt.getTime() < Date.now()) {
        throw new AppError('This Sales agent registration link has expired', {
          statusCode: 410,
          code: 'SALES_AGENT_INVITE_EXPIRED',
          expose: true,
        });
      }

      const telegramRows = await tx
        .select()
        .from(salesAgentMiniAppPrincipals)
        .where(
          and(
            eq(salesAgentMiniAppPrincipals.tenantId, ctx.tenantId),
            eq(salesAgentMiniAppPrincipals.telegramUserId, input.telegramUserId),
          ),
        )
        .limit(1);
      const zohoRows = await tx
        .select()
        .from(salesAgentMiniAppPrincipals)
        .where(
          and(
            eq(salesAgentMiniAppPrincipals.tenantId, ctx.tenantId),
            eq(salesAgentMiniAppPrincipals.zohoUserId, invitation.zohoUserId),
          ),
        )
        .limit(1);
      const byTelegram = telegramRows[0];
      const byZoho = zohoRows[0];
      if (byTelegram && byTelegram.zohoUserId !== invitation.zohoUserId) {
        throw new ConflictError('This Telegram account is already linked to another Sales agent', {
          code: 'TELEGRAM_ALREADY_REGISTERED',
        });
      }
      if (byZoho && byZoho.telegramUserId !== input.telegramUserId) {
        throw new ConflictError('This Sales agent is already linked to another Telegram account', {
          code: 'SALES_AGENT_ALREADY_REGISTERED',
        });
      }

      let principal = byTelegram ?? byZoho;
      if (principal) {
        const rows = await tx
          .update(salesAgentMiniAppPrincipals)
          .set({
            agentName: invitation.agentName,
            telegramUsername: clean(input.telegramUsername),
            languageCode: clean(input.languageCode),
            status: 'active',
            revokedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(salesAgentMiniAppPrincipals.tenantId, ctx.tenantId),
              eq(salesAgentMiniAppPrincipals.id, principal.id),
            ),
          )
          .returning();
        principal = firstOrThrow(rows, 'Failed to refresh Sales agent mini-app registration');
      } else {
        const rows = await tx
          .insert(salesAgentMiniAppPrincipals)
          .values({
            tenantId: ctx.tenantId,
            zohoUserId: invitation.zohoUserId,
            agentName: invitation.agentName,
            telegramUserId: input.telegramUserId,
            telegramUsername: clean(input.telegramUsername),
            languageCode: clean(input.languageCode),
          })
          .returning();
        principal = firstOrThrow(rows, 'Failed to register Sales agent mini-app identity');
      }

      if (invitation.status === 'pending') {
        const burned = await tx
          .update(salesAgentMiniAppInvitations)
          .set({
            status: 'redeemed',
            redeemedTelegramUserId: input.telegramUserId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(salesAgentMiniAppInvitations.tenantId, ctx.tenantId),
              eq(salesAgentMiniAppInvitations.id, invitation.id),
              eq(salesAgentMiniAppInvitations.status, 'pending'),
            ),
          )
          .returning();
        if (!burned[0]) {
          throw new ConflictError('This Sales agent registration link was already used');
        }
        return { invitation: burned[0], principal };
      }
      if (invitation.redeemedTelegramUserId !== input.telegramUserId) {
        throw new ConflictError('This Sales agent registration link was already used');
      }
      return { invitation, principal };
    });
  },
};
