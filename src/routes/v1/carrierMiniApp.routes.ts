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
import { listDwhCards } from '../../integrations/dwhCards.js';
import { carrierInvitationRepo } from '../../repos/carrierInvitationRepo.js';
import { registeredMiniAppCompanyRepo } from '../../repos/registeredMiniAppCompanyRepo.js';
import { buildInviteUrl, createCarrierInvite } from '../../modules/carrier/inviteService.js';
import { parseInitDataUser, verifyTelegramInitData, type TelegramWebAppUser } from '../../integrations/telegramCarrierBot.js';
import type { RegisteredMiniAppCompany } from '../../db/schema/index.js';
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

const ownerFleetSchema = z.object({ initData: z.string().min(1) });
const ownerDriverInviteSchema = z.object({
  initData: z.string().min(1),
  cardId: z.string().min(1).max(120),
  driverName: z.string().min(1).max(200),
});

/**
 * Verify initData and resolve the caller to a REGISTERED OWNER (fleet manager) with a carrier —
 * the auth gate for the owner-only fleet endpoints. A driver, an unregistered user, or an owner
 * with no carrier id is rejected. The verified Telegram identity, not the request body, is trusted.
 */
async function requireRegisteredOwner(
  initData: string,
): Promise<{ ctx: TenantContext; registration: RegisteredMiniAppCompany; carrierId: string; tgUser: TelegramWebAppUser }> {
  if (!env.TELEGRAM_CARRIER_BOT_TOKEN) {
    throw new AppError('The carrier bot is not configured', {
      statusCode: 503,
      code: 'BOT_UNCONFIGURED',
      expose: true,
    });
  }
  const verified = verifyTelegramInitData(initData);
  if (!verified.ok) {
    throw new AppError('Could not verify your Telegram identity', {
      statusCode: 401,
      code: 'TELEGRAM_VERIFY_FAILED',
      expose: true,
    });
  }
  const tgUser = parseInitDataUser(verified.fields);
  if (!tgUser) {
    throw new AppError('Missing Telegram user in verified payload', {
      statusCode: 400,
      code: 'TELEGRAM_USER_MISSING',
      expose: true,
    });
  }
  const lookup = lookupCtx();
  const registration = await registeredMiniAppCompanyRepo.findByTelegramUserId(lookup, String(tgUser.id));
  if (!registration || registration.profile !== 'owner' || !registration.carrierId) {
    throw new AppError('Only a registered company owner can manage drivers', {
      statusCode: 403,
      code: 'NOT_A_REGISTERED_OWNER',
      expose: true,
    });
  }
  return {
    ctx: telegramCtx('owner', String(tgUser.id)),
    registration,
    carrierId: registration.carrierId,
    tgUser,
  };
}

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
        // Drives the "This link expires in 23h 40m" pill on the confirm screen.
        expiresAt: invite.expiresAt.toISOString(),
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

  /**
   * Owner's fleet — the carrier's active fuel cards (from the DWH) with each card's driver status:
   * 'registered' (a driver signed in), 'pending' (an invite is out), or 'open' (no driver yet).
   * Owner-authenticated (their verified Telegram identity must be a registered owner). This is the
   * data the owner needs to hand out per-card driver links.
   */
  app.post('/carrier/mini-app/fleet', async (request) => {
    const body = ownerFleetSchema.parse(request.body);
    const { ctx, carrierId, registration } = await requireRegisteredOwner(body.initData);

    const [cards, drivers, pending] = await Promise.all([
      env.DWH_DATABASE_URL ? listDwhCards(carrierId).catch(() => []) : Promise.resolve([]),
      registeredMiniAppCompanyRepo.listDriversByCarrier(ctx, carrierId),
      carrierInvitationRepo.listPendingDriverInvitesByCarrier(ctx, carrierId),
    ]);
    const registeredByCard = new Map(drivers.map((d) => [d.cardId, d]));
    // Freshest pending invite per card — after a regenerate the expired one must not shadow it.
    const pendingByCard = new Map<string | null, (typeof pending)[number]>();
    for (const p of pending) {
      const existing = pendingByCard.get(p.cardId);
      if (!existing || p.expiresAt > existing.expiresAt) pendingByCard.set(p.cardId, p);
    }

    const fleet = cards.map((card) => {
      const reg = card.cardId ? registeredByCard.get(card.cardId) : undefined;
      const pend = card.cardId ? pendingByCard.get(card.cardId) : undefined;
      return {
        cardId: card.cardId,
        cardNumber: card.cardNumber,
        cardType: card.cardType,
        driverName: reg?.driverName ?? pend?.driverName ?? null,
        status: reg ? ('registered' as const) : pend ? ('pending' as const) : ('open' as const),
        // Pending only: the link + its deadline, so the owner can re-copy it and the UI can show
        // the live countdown or the "Link expired" state (derived client-side from expiresAt).
        link: !reg && pend ? buildInviteUrl(pend.id) : null,
        expiresAt: !reg && pend ? pend.expiresAt : null,
      };
    });
    return {
      company: { companyName: registration.companyName, carrierId, companyType: registration.companyType },
      fleet,
    };
  });

  /**
   * Owner issues a driver registration link for one of their active cards (with the driver's name).
   * All the rules — card must be active, one driver per card — are enforced in createCarrierInvite.
   */
  app.post('/carrier/mini-app/driver-invites', async (request, reply) => {
    const body = ownerDriverInviteSchema.parse(request.body);
    const { ctx, carrierId, registration } = await requireRegisteredOwner(body.initData);

    const { invite, inviteUrl } = await createCarrierInvite(ctx, {
      profile: 'driver',
      carrierId,
      ...(registration.applicationId ? { applicationId: registration.applicationId } : {}),
      ...(registration.companyName ? { companyName: registration.companyName } : {}),
      cardId: body.cardId,
      driverName: body.driverName,
      // Owner-issued links are short-lived by design: 24 hours, then "Link expired" -> regenerate.
      ttlHours: 24,
    });
    await auditFromContext(ctx, {
      action: 'mini_app.driver_invite.create',
      status: 'ok',
      resourceType: 'carrier_invitation',
      resourceId: invite.id,
      detail: { carrierId, cardId: body.cardId, driverName: body.driverName },
    });
    return reply.code(201).send({
      invite: { id: invite.id, cardId: invite.cardId, driverName: invite.driverName },
      inviteUrl,
      expiresAt: invite.expiresAt,
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
