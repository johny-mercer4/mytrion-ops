/**
 * Public endpoints for the Telegram carrier mini-app (apps/mini-app). Unauthenticated by design —
 * the caller is a Telegram WebApp, not a Zoho worker or an existing carrier_users login. The
 * invite id in the URL is the capability (opaque cuid2, unguessable); the ACTUAL identity proof is
 * the Telegram `initData` HMAC verified in the redeem step (verifyTelegramInitData).
 */
import { createId } from '@paralleldrive/cuid2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { env } from '../../config/env.js';
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import { carrierInvitationRepo } from '../../repos/carrierInvitationRepo.js';
import { registeredMiniAppCompanyRepo } from '../../repos/registeredMiniAppCompanyRepo.js';
import { parseInitDataUser, verifyTelegramInitData } from '../../integrations/telegramCarrierBot.js';
import type { TenantContext } from '../../types/tenantContext.js';

/** Tenant-scoping only — no admin authority. Repos key off ctx.tenantId; audit reads the rest. */
function lookupCtx(): TenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: 'system:mini-app',
    audience: 'internal',
    role: 'viewer',
    scopes: [],
    departments: [],
    allDepartmentAccess: false,
    requestId: `mini-app-${createId()}`,
  };
}

/** The actual actor once a Telegram user is verified — customer audience, deny-by-default. */
function telegramCtx(profile: 'owner' | 'driver', telegramUserId: string): TenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: `telegram:${telegramUserId}`,
    audience: 'customer',
    role: profile === 'owner' ? 'fleet_manager' : 'driver',
    scopes: [],
    departments: [],
    allDepartmentAccess: false,
    requestId: `mini-app-${createId()}`,
  };
}

const redeemSchema = z.object({
  // Raw Telegram WebApp.initData string — verified server-side, never trusted at face value.
  initData: z.string().min(1),
});

export async function carrierMiniAppRoutes(app: FastifyInstance): Promise<void> {
  /** Invite preview — what the mini-app shows on the Confirm screen before the user acts. */
  app.get('/carrier-invitations/:id/public', async (request) => {
    const { id } = request.params as { id: string };
    const invite = await carrierInvitationRepo.findById(lookupCtx(), id);
    if (!invite) throw new NotFoundError('This invite link is not valid');
    if (invite.status === 'redeemed') {
      return { invite: null, status: 'redeemed' as const, companyName: invite.companyName };
    }
    if (invite.status === 'expired' || invite.expiresAt.getTime() < Date.now()) {
      throw new AppError('This invite has expired', {
        statusCode: 410,
        code: 'INVITE_EXPIRED',
        expose: true,
      });
    }
    return {
      invite: {
        id: invite.id,
        profile: invite.profile,
        companyName: invite.companyName,
        companyType: invite.companyType,
        cardCount: invite.cardCount,
      },
      status: 'pending' as const,
    };
  });

  /**
   * Redeem: verify the Telegram identity, atomically burn the invite, then record the
   * registration. For a fleet-manager owner, returns AGGREGATE counts only (total cards + how many
   * drivers have registered) — never the card numbers or the driver list, since whoever holds the
   * link redeems it, so the response must not become a data-exfiltration channel for a leaked link.
   */
  app.post('/carrier-invitations/:id/redeem', async (request, reply) => {
    if (!env.TELEGRAM_CARRIER_BOT_TOKEN) {
      throw new AppError('The carrier bot is not configured', {
        statusCode: 503,
        code: 'BOT_UNCONFIGURED',
        expose: true,
      });
    }
    const { id } = request.params as { id: string };
    const body = redeemSchema.parse(request.body);

    const verified = verifyTelegramInitData(body.initData);
    if (!verified.ok) throw new AppError('Could not verify your Telegram identity', {
      statusCode: 401,
      code: 'TELEGRAM_VERIFY_FAILED',
      expose: true,
    });
    const tgUser = parseInitDataUser(verified.fields);
    if (!tgUser) throw new AppError('Missing Telegram user in verified payload', {
      statusCode: 400,
      code: 'TELEGRAM_USER_MISSING',
      expose: true,
    });
    const telegramUserId = String(tgUser.id);

    const ctx = lookupCtx();
    const invite = await carrierInvitationRepo.findById(ctx, id);
    if (!invite) throw new NotFoundError('This invite link is not valid');
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new AppError('This invite has expired', {
        statusCode: 410,
        code: 'INVITE_EXPIRED',
        expose: true,
      });
    }

    // Burn FIRST — the atomic pending→redeemed flip (UPDATE ... WHERE status='pending') is the
    // single-use serialization point. Only the caller that wins it may write a registration, so a
    // race between two link-holders can't double-bind the same invite to two carriers.
    const burned = await carrierInvitationRepo.markRedeemed(ctx, invite.id, `telegram:${telegramUserId}`);
    if (!burned) {
      // Lost the race, or the link was already used. Re-opening as the SAME Telegram user just
      // reconfirms the existing registration (idempotent); a different user gets a conflict.
      const existing = await registeredMiniAppCompanyRepo.findByTelegramUserId(ctx, telegramUserId);
      if (existing) {
        return reply.send({ alreadyRegistered: true, registration: toRegistrationView(existing) });
      }
      throw new ConflictError('This invite was already used by someone else');
    }

    const actorCtx = telegramCtx(invite.profile, telegramUserId);
    const registration = await registeredMiniAppCompanyRepo.upsert(ctx, {
      invitationId: invite.id,
      profile: invite.profile,
      telegramUserId,
      ...(request.headers['x-telegram-chat-id']
        ? { telegramChatId: String(request.headers['x-telegram-chat-id']) }
        : {}),
      ...(tgUser.username ? { telegramUsername: tgUser.username } : {}),
      ...(invite.carrierId ? { carrierId: invite.carrierId } : {}),
      ...(invite.applicationId ? { applicationId: invite.applicationId } : {}),
      ...(invite.companyName ? { companyName: invite.companyName } : {}),
      ...(invite.cardId ? { cardId: invite.cardId } : {}),
      ...(invite.companyType ? { companyType: invite.companyType } : {}),
      ...(invite.cardCount !== null ? { cardCount: invite.cardCount } : {}),
    });
    await auditFromContext(actorCtx, {
      action: 'mini_app.carrier_registration.redeem',
      status: 'ok',
      resourceType: 'registered_mini_app_company',
      resourceId: registration.id,
      detail: {
        profile: invite.profile,
        telegramUserId,
        ...(invite.carrierId ? { carrierId: invite.carrierId } : {}),
        ...(invite.applicationId ? { applicationId: invite.applicationId } : {}),
      },
    });

    // Aggregate-only fleet summary (counts, no card numbers / no driver identities).
    let fleet: { cardCount: number | null; registeredDrivers: number } | undefined;
    if (invite.profile === 'owner' && invite.companyType === 'fleet-manager' && invite.carrierId) {
      const roster = await registeredMiniAppCompanyRepo.list(ctx);
      const registeredDrivers = roster.filter(
        (r) => r.profile === 'driver' && r.carrierId === invite.carrierId,
      ).length;
      fleet = { cardCount: invite.cardCount, registeredDrivers };
    }

    return reply.code(201).send({
      registration: toRegistrationView(registration),
      ...(fleet ? { fleet } : {}),
    });
  });
}

function toRegistrationView(row: {
  id: string;
  profile: 'owner' | 'driver';
  companyName: string | null;
  carrierId: string | null;
  companyType: 'owner-operator' | 'fleet-manager' | null;
  cardCount: number | null;
  cardId: string | null;
}) {
  return {
    id: row.id,
    profile: row.profile,
    companyName: row.companyName,
    carrierId: row.carrierId,
    companyType: row.companyType,
    cardCount: row.cardCount,
    cardId: row.cardId,
  };
}
