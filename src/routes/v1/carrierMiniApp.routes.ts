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
import { env, isProduction } from '../../config/env.js';
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import { db } from '../../db/client.js';
import { listDwhCards } from '../../integrations/dwhCards.js';
import { searchDwhClients } from '../../integrations/dwhClients.js';
import { searchDwhOperators } from '../../integrations/dwhOperators.js';
import { serverCrmGet, ServerCrmHttpError } from '../../integrations/serverCrm.js';
import { executeZohoFunctionWithFallback } from '../../integrations/zohoFunctions.js';
import { carrierInvitationRepo } from '../../repos/carrierInvitationRepo.js';
import { registeredMiniAppCompanyRepo } from '../../repos/registeredMiniAppCompanyRepo.js';
import { buildInviteUrl, createCarrierInvite } from '../../modules/carrier/inviteService.js';
import {
  parseInitDataUser,
  signTelegramInitData,
  verifyTelegramInitData,
  type TelegramWebAppUser,
} from '../../integrations/telegramCarrierBot.js';
import type { RegisteredMiniAppCompany } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { RBACError } from '../../lib/errors.js';
import { requireContext } from './helpers.js';

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

function sameRegistrationSubject(
  existing: Pick<RegisteredMiniAppCompany, 'profile' | 'carrierId' | 'applicationId' | 'cardId'>,
  invite: Pick<RegisteredMiniAppCompany, 'profile' | 'carrierId' | 'applicationId' | 'cardId'>,
): boolean {
  const same = (a: string | null, b: string | null) => a === b;
  return (
    existing.profile === invite.profile &&
    same(existing.carrierId, invite.carrierId) &&
    same(existing.applicationId, invite.applicationId) &&
    same(existing.cardId, invite.cardId)
  );
}

function zohoUserIdFromContext(ctx: TenantContext): string | undefined {
  return ctx.userId.startsWith('zoho:') ? ctx.userId.slice('zoho:'.length) : undefined;
}

function inviteAgentFromContext(ctx: TenantContext): {
  agentName?: string;
  agentZohoUserId?: string;
} {
  const agentName = ctx.userName?.trim();
  const agentZohoUserId = zohoUserIdFromContext(ctx)?.trim();
  return {
    ...(agentName ? { agentName } : {}),
    ...(agentZohoUserId ? { agentZohoUserId } : {}),
  };
}

async function resolveRegistrationAgent(
  row: Pick<RegisteredMiniAppCompany, 'invitationId' | 'agentName' | 'agentZohoUserId'>,
): Promise<{ agentName: string | null; agentZohoUserId: string | null }> {
  if (row.agentName || row.agentZohoUserId) {
    return {
      agentName: row.agentName ?? null,
      agentZohoUserId: row.agentZohoUserId ?? null,
    };
  }
  const invite = await carrierInvitationRepo.findById(lookupCtx(), row.invitationId);
  return {
    agentName: invite?.agentName ?? null,
    agentZohoUserId: invite?.agentZohoUserId ?? null,
  };
}

const redeemSchema = z.object({
  // Raw Telegram WebApp.initData string — verified server-side, never trusted at face value.
  initData: z.string().min(1),
});

const miniAppSessionSchema = z.object({ initData: z.string().min(1) });
const ownerFleetSchema = z.object({ initData: z.string().min(1) });
const ownerDriverInviteSchema = z.object({
  initData: z.string().min(1),
  cardId: z.string().min(1).max(120),
  driverName: z.string().min(1).max(200),
});

// ── Self-service reads (any registered user — owner or driver; carrier-level data both may see) ─
const selfServiceSchema = z.object({ initData: z.string().min(1) });
const rangeSchema = z.object({
  initData: z.string().min(1),
  range: z.string().max(20).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});
const invoicesSchema = z.object({
  initData: z.string().min(1),
  range: z.string().max(20).optional(),
  status: z.string().max(40).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});
const invoiceSignedUrlSchema = z.object({
  initData: z.string().min(1),
  invoiceId: z.string().min(1).max(120),
});

function verifyTelegramUser(initData: string): { tgUser: TelegramWebAppUser; telegramUserId: string } {
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
  return { tgUser, telegramUserId: String(tgUser.id) };
}

/**
 * Resolve the current Telegram user to an existing mini-app registration. This is the returning
 * user's login path once onboarding is complete: Telegram proves identity; no password is involved.
 */
async function requireRegisteredMiniAppUser(
  initData: string,
): Promise<{ ctx: TenantContext; registration: RegisteredMiniAppCompany; tgUser: TelegramWebAppUser; telegramUserId: string }> {
  const { tgUser, telegramUserId } = verifyTelegramUser(initData);
  const lookup = lookupCtx();
  const registration = await registeredMiniAppCompanyRepo.findByTelegramUserId(lookup, telegramUserId);
  if (!registration) {
    throw new AppError('This Telegram account is not registered yet. Open your Octane registration link to finish setup.', {
      statusCode: 404,
      code: 'MINI_APP_NOT_REGISTERED',
      expose: true,
    });
  }
  if (registration.status === 'revoked') {
    throw new AppError('Your access has been revoked. Contact your Octane rep to reconnect.', {
      statusCode: 403,
      code: 'MINI_APP_REVOKED',
      expose: true,
    });
  }
  return {
    ctx: telegramCtx(registration.profile, telegramUserId),
    registration,
    tgUser,
    telegramUserId,
  };
}

/**
 * Verify initData and resolve the caller to a REGISTERED OWNER with a carrier — the auth gate for
 * the owner-only fleet endpoints. A driver, an unregistered user, or an owner with no carrier id
 * is rejected. The verified Telegram identity, not the request body, is trusted.
 */
async function requireRegisteredOwner(
  initData: string,
): Promise<{ ctx: TenantContext; registration: RegisteredMiniAppCompany; carrierId: string; tgUser: TelegramWebAppUser }> {
  const { registration, tgUser, telegramUserId } = await requireRegisteredMiniAppUser(initData);
  if (
    !registration ||
    registration.profile !== 'owner' ||
    registration.companyType !== 'fleet-manager' ||
    !registration.carrierId
  ) {
    throw new AppError('Only a fleet company owner can manage drivers', {
      statusCode: 403,
      code: 'NOT_A_REGISTERED_OWNER',
      expose: true,
    });
  }
  return {
    ctx: telegramCtx('owner', telegramUserId),
    registration,
    carrierId: registration.carrierId,
    tgUser,
  };
}

/**
 * Verify initData and resolve the caller to ANY registered carrier user (owner or driver) with a
 * carrier id — the auth gate for the self-service reads (balance, status, transactions, invoices,
 * payment info, last-used, tracking). Unlike requireRegisteredOwner, a driver is allowed: these are
 * carrier-level views the driver catalog also lists (e.g. "Check available balance").
 */
async function requireRegisteredCarrierUser(
  initData: string,
): Promise<{ registration: RegisteredMiniAppCompany; carrierId: string }> {
  const { registration } = await requireRegisteredMiniAppUser(initData);
  if (!registration.carrierId) {
    throw new AppError('This registration has no linked carrier yet', {
      statusCode: 404,
      code: 'NO_CARRIER_ID',
      expose: true,
    });
  }
  return { registration, carrierId: registration.carrierId };
}

/**
 * Thin servercrm GET proxy for the self-service reads below — mirrors dispatchTouchpoint's error
 * mapping (src/modules/touchpoints/dispatcher.ts) since that function itself enforces sales-agent
 * ownership scoping (assertCarrierOwned), which doesn't apply here: the mini-app's carrierId is
 * already trust-verified via requireRegisteredCarrierUser, not a sales agent's client roster.
 */
/** servercrm error bodies are JSON ({success:false, message:'...'}) — surface the message, not the raw blob. */
function extractUpstreamMessage(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { message?: string; error?: string };
    return parsed.message ?? parsed.error ?? bodyText;
  } catch {
    return bodyText;
  }
}

async function crmGet<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  try {
    return await serverCrmGet<T>(path, query);
  } catch (err) {
    if (err instanceof ServerCrmHttpError && [400, 404, 409, 422].includes(err.status)) {
      throw new AppError(
        err.bodyText ? extractUpstreamMessage(err.bodyText) : `servercrm rejected the request (${err.status})`,
        {
          statusCode: err.status,
          code: 'SERVER_CRM_REJECTED',
          expose: true,
          cause: err,
        },
      );
    }
    throw new AppError('servercrm request failed', {
      statusCode: 502,
      code: 'SERVER_CRM_ERROR',
      expose: true,
      cause: err,
    });
  }
}

const createInviteSchema = z.object({
  profile: z.enum(['owner', 'driver']).default('owner'),
  carrier_id: z.union([z.string().max(120), z.number()]).transform(String).optional(),
  application_id: z.union([z.string().max(120), z.number()]).transform(String).optional(),
  company_name: z.string().max(300).optional(),
  card_id: z.union([z.string().max(120), z.number()]).transform(String).optional(),
  driver_name: z.string().max(200).optional(),
  // Accepted so createCarrierInvite's existing agent-attribution support (see inviteService.ts)
  // isn't silently dropped by zod for any caller that sends it — the admin panel's CarrierUserForm
  // has no picker for this today, but the Zoho sales self-service flow inviteService.ts's docstring
  // anticipates does.
  agent_name: z.string().max(200).optional(),
  agent_zoho_user_id: z.string().max(120).optional(),
  /** Admin-picked invite lifetime — falls through to createCarrierInvite's own 7-day default when unset. */
  ttl_hours: z.coerce.number().int().positive().max(24 * 30).optional(),
});

export async function carrierMiniAppRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /**
   * Admin-gated: generate a carrier registration link (owner or driver). This is the seed for the
   * mini-app — an admin sends an owner the link; the owner then hands out per-card driver links
   * from inside the app.
   */
  app.post('/carrier-invitations', guard, async (request, reply) => {
    const ctx = requireContext(request);
    if (ctx.role !== 'admin' && !ctx.bypassRbac) {
      throw new RBACError('Generating carrier invites requires admin access');
    }
    const body = createInviteSchema.parse(request.body);
    const fallbackAgent = inviteAgentFromContext(ctx);
    const { invite, inviteUrl } = await createCarrierInvite(ctx, {
      profile: body.profile,
      ...(body.carrier_id ? { carrierId: body.carrier_id } : {}),
      ...(body.application_id ? { applicationId: body.application_id } : {}),
      ...(body.company_name ? { companyName: body.company_name } : {}),
      ...(body.card_id ? { cardId: body.card_id } : {}),
      ...(body.driver_name ? { driverName: body.driver_name } : {}),
      ...(body.agent_name ? { agentName: body.agent_name } : fallbackAgent.agentName ? { agentName: fallbackAgent.agentName } : {}),
      ...(body.agent_zoho_user_id
        ? { agentZohoUserId: body.agent_zoho_user_id }
        : fallbackAgent.agentZohoUserId
          ? { agentZohoUserId: fallbackAgent.agentZohoUserId }
          : {}),
      ...(body.ttl_hours !== undefined ? { ttlHours: body.ttl_hours } : {}),
    });
    await auditFromContext(ctx, {
      action: 'admin.carrier_invitation.create',
      status: 'ok',
      resourceType: 'carrier_invitation',
      resourceId: invite.id,
      detail: {
        ...(invite.carrierId ? { carrierId: invite.carrierId } : {}),
        ...(invite.applicationId ? { applicationId: invite.applicationId } : {}),
      },
    });
    return reply.code(201).send({ invite, inviteUrl });
  });

  const requireAdmin = (request: Parameters<typeof requireContext>[0]) => {
    const ctx = requireContext(request);
    if (ctx.role !== 'admin' && !ctx.bypassRbac) {
      throw new RBACError('Carrier onboarding requires admin access');
    }
    return ctx;
  };

  /**
   * DWH operator logins (servercrm) — admin looks up a carrier's existing operator when seeding an
   * owner invite. Searchable by carrier id (prefix) or company name.
   */
  app.get('/carrier-users/dwh-operators', guard, async (request) => {
    requireAdmin(request);
    if (!env.DWH_DATABASE_URL) {
      throw new AppError('The data warehouse is not configured (DWH_DATABASE_URL)', {
        statusCode: 503,
        code: 'DWH_UNCONFIGURED',
        expose: true,
      });
    }
    const q = z
      .object({ q: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).optional() })
      .parse(request.query);
    try {
      const operators = await searchDwhOperators({ q: q.q, limit: q.limit });
      return { operators };
    } catch (err) {
      throw new AppError('Data warehouse query failed', {
        statusCode: 502,
        code: 'DWH_ERROR',
        cause: err,
        expose: true,
      });
    }
  });

  /**
   * The carrier's active fuel cards (octane.stg_cmp_card, current rows) — what the admin picks a
   * driver's card_id FROM when generating a driver link. No driver identity lives on the card.
   */
  app.get('/carrier-users/dwh-cards', guard, async (request) => {
    requireAdmin(request);
    if (!env.DWH_DATABASE_URL) {
      throw new AppError('The data warehouse is not configured (DWH_DATABASE_URL)', {
        statusCode: 503,
        code: 'DWH_UNCONFIGURED',
        expose: true,
      });
    }
    const q = z
      .object({ carrier_id: z.string().min(1).max(120), limit: z.coerce.number().int().min(1).max(200).optional() })
      .parse(request.query);
    try {
      const cards = await listDwhCards(q.carrier_id, q.limit);
      return { cards };
    } catch (err) {
      throw new AppError('Data warehouse query failed', {
        statusCode: 502,
        code: 'DWH_ERROR',
        cause: err,
        expose: true,
      });
    }
  });

  /**
   * Companies/drivers that actually FINISHED sign-in in the mini-app (registered_mini_app_companies)
   * — distinct from carrier_invitations (a sent link, maybe never opened). This is what the admin's
   * Carrier User Management tree renders.
   */
  app.get('/carrier-registrations', guard, async (request) => {
    const ctx = requireAdmin(request);
    const registrations = await registeredMiniAppCompanyRepo.list(ctx);
    return { registrations };
  });

  /** Soft-disable a registered owner/driver — the row (and its history) stays, access doesn't. A
   * revoked driver's card frees up for reassignment (registeredMiniAppCompanyRepo.listDriversByCarrier
   * excludes revoked rows). */
  app.post('/carrier-registrations/:id/revoke', guard, async (request) => {
    const ctx = requireAdmin(request);
    const { id } = request.params as { id: string };
    const registration = await registeredMiniAppCompanyRepo.revoke(ctx, id);
    if (!registration) throw new NotFoundError('Registration not found');
    await auditFromContext(ctx, {
      action: 'admin.carrier_registration.revoke',
      status: 'ok',
      resourceType: 'registered_mini_app_company',
      resourceId: id,
      detail: { profile: registration.profile, ...(registration.carrierId ? { carrierId: registration.carrierId } : {}) },
    });
    return { registration };
  });

  /**
   * Every invite (pending/redeemed/cancelled) for this tenant — the admin's "pending invitations"
   * table, distinct from /carrier-registrations (who actually finished signing in).
   */
  app.get('/carrier-invitations', guard, async (request) => {
    const ctx = requireAdmin(request);
    const invitations = await carrierInvitationRepo.list(ctx);
    return { invitations: invitations.map((inv) => ({ ...inv, inviteUrl: buildInviteUrl(inv.id) })) };
  });

  /** Cancel a still-pending invite — a no-op 404 if it's already redeemed/cancelled. */
  app.post('/carrier-invitations/:id/cancel', guard, async (request) => {
    const ctx = requireAdmin(request);
    const { id } = request.params as { id: string };
    const invite = await carrierInvitationRepo.cancel(ctx, id);
    if (!invite) throw new NotFoundError('Invite not found or no longer pending');
    await auditFromContext(ctx, {
      action: 'admin.carrier_invitation.cancel',
      status: 'ok',
      resourceType: 'carrier_invitation',
      resourceId: id,
      detail: { ...(invite.carrierId ? { carrierId: invite.carrierId } : {}) },
    });
    return { invite };
  });

  /**
   * The DWH client directory (octane.intm_zoho_deals) — what the admin provisions an invite FROM.
   * Searchable by company name, carrier id, or application id. (Lives here, not in the legacy
   * carrierUsers.routes.ts, since that file's login/password CRUD was retired — this is the one
   * route from it still in use, by CarrierUserForm.tsx and the sales CarrierPicker.)
   */
  app.get('/carrier-clients', guard, async (request) => {
    requireAdmin(request);
    if (!env.DWH_DATABASE_URL) {
      throw new AppError('The data warehouse is not configured (DWH_DATABASE_URL)', {
        statusCode: 503,
        code: 'DWH_UNCONFIGURED',
        expose: true,
      });
    }
    const q = z
      .object({ q: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).optional() })
      .parse(request.query);
    try {
      const clients = await searchDwhClients({ q: q.q, limit: q.limit });
      return { clients };
    } catch (err) {
      throw new AppError('Data warehouse query failed', {
        statusCode: 502,
        code: 'DWH_ERROR',
        cause: err,
        expose: true,
      });
    }
  });

  /**
   * DEV ONLY — mint a validly-signed Telegram initData for a fake user, so the mini-app's full flow
   * (confirm → redeem → fleet) can be clicked through in a local browser without the real Telegram
   * client. Gated on an EXPLICIT opt-in flag, not just `!isProduction` — NODE_ENV defaults to
   * 'development' when unset, so a misconfigured staging/preview deploy sharing the real prod bot
   * token could otherwise expose an endpoint that mints a validly-signed identity for ANY Telegram
   * user id. FF_DEV_MOCK_TELEGRAM_ENABLED must be deliberately set to '1' (local .env only).
   */
  if (!isProduction && env.FF_DEV_MOCK_TELEGRAM_ENABLED) {
    app.get('/carrier-invitations/dev/mock-init-data', async (request) => {
      if (!env.TELEGRAM_CARRIER_BOT_TOKEN) {
        throw new AppError('Bot token not set — cannot sign a dev initData', {
          statusCode: 503,
          code: 'BOT_UNCONFIGURED',
          expose: true,
        });
      }
      const q = z
        .object({
          id: z.coerce.number().int().optional(),
          username: z.string().max(60).optional(),
          first_name: z.string().max(60).optional(),
          last_name: z.string().max(60).optional(),
          language_code: z.string().max(10).optional(),
        })
        .parse(request.query);
      const user = {
        id: q.id ?? 990000001,
        first_name: q.first_name ?? 'Local',
        last_name: q.last_name ?? 'Tester',
        username: q.username ?? 'local_tester',
        ...(q.language_code ? { language_code: q.language_code } : {}),
      };
      const initData = signTelegramInitData({
        auth_date: String(Math.floor(Date.now() / 1000)),
        query_id: 'AAE_devmock',
        user: JSON.stringify(user),
      });
      return { initData, user };
    });
  }

  /** Invite preview — what the mini-app shows on the Confirm screen before the user acts. */
  app.get('/carrier-invitations/:id/public', async (request) => {
    const { id } = request.params as { id: string };
    const invite = await carrierInvitationRepo.findById(lookupCtx(), id);
    if (!invite) throw new NotFoundError('This invite link is not valid');
    if (invite.status === 'redeemed') {
      return {
        invite: null,
        status: 'redeemed' as const,
        companyName: invite.companyName,
        agentName: invite.agentName,
      };
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
        agentName: invite.agentName,
        // Drives the "This link expires in 23h 40m" pill on the confirm screen.
        expiresAt: invite.expiresAt.toISOString(),
      },
      status: 'pending' as const,
    };
  });

  /**
   * Returning-user bootstrap: open the mini-app without an invite and restore the session from the
   * verified Telegram identity alone. The invite is onboarding-only; after registration Telegram is
   * the login.
   */
  app.post('/carrier/mini-app/session', async (request) => {
    const body = miniAppSessionSchema.parse(request.body);
    const { registration } = await requireRegisteredMiniAppUser(body.initData);
    const support = await resolveRegistrationAgent(registration);
    return { registration: toRegistrationView({ ...registration, ...support }) };
  });

  /**
   * Redeem: verify the Telegram identity, atomically burn the invite, then record the
   * registration. For a fleet-manager owner, returns AGGREGATE counts only (total cards + how many
   * drivers have registered) — never the card numbers or the driver list, since whoever holds the
   * link redeems it, so the response must not become a data-exfiltration channel for a leaked link.
   */
  app.post('/carrier-invitations/:id/redeem', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = redeemSchema.parse(request.body);
    const { tgUser, telegramUserId } = verifyTelegramUser(body.initData);

    const ctx = lookupCtx();
    const txResult = await db.transaction(async (tx) => {
      const invite = await carrierInvitationRepo.findById(ctx, id, tx);
      if (!invite) throw new NotFoundError('This invite link is not valid');

      const existing = await registeredMiniAppCompanyRepo.findByTelegramUserId(ctx, telegramUserId, tx);
      if (existing && !sameRegistrationSubject(existing, invite)) {
        throw new ConflictError('This Telegram account is already registered to another carrier', {
          code: 'TELEGRAM_ALREADY_REGISTERED',
        });
      }
      const reopeningExisting = Boolean(existing);

      // Once an invite has been redeemed, or once the same Telegram user is already registered to
      // this exact subject, the invite is no longer the login credential. Returning access flows
      // through Telegram identity, so link expiry must not lock that user out later.
      if (invite.status === 'redeemed') {
        return { invite, existing, registration: null as RegisteredMiniAppCompany | null, burnedFresh: false };
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        if (reopeningExisting) {
          return { invite, existing, registration: null as RegisteredMiniAppCompany | null, burnedFresh: false };
        }
        throw new AppError('This invite has expired', {
          statusCode: 410,
          code: 'INVITE_EXPIRED',
          expose: true,
        });
      }

      // Burn + registration write live in the same transaction so a DB failure cannot consume the
      // link without persisting the registration.
      const burned = await carrierInvitationRepo.markRedeemed(
        ctx,
        invite.id,
        `telegram:${telegramUserId}`,
        tx,
      );
      if (!burned) {
        return { invite, existing, registration: null as RegisteredMiniAppCompany | null, burnedFresh: false };
      }

      const registration = await registeredMiniAppCompanyRepo.upsert(
        ctx,
        {
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
          ...(invite.agentName ? { agentName: invite.agentName } : {}),
          ...(invite.agentZohoUserId ? { agentZohoUserId: invite.agentZohoUserId } : {}),
          ...(invite.cardId ? { cardId: invite.cardId } : {}),
          ...(invite.driverName ? { driverName: invite.driverName } : {}),
          ...(invite.companyType ? { companyType: invite.companyType } : {}),
          ...(invite.cardCount !== null ? { cardCount: invite.cardCount } : {}),
        },
        tx,
      );
      return { invite, existing, registration, burnedFresh: true };
    });

    const invite = txResult.invite;
    const actor = telegramCtx(invite.profile, telegramUserId);
    if (!txResult.burnedFresh) {
      if (txResult.existing) {
        return reply.send({
          alreadyRegistered: true,
          registration: toRegistrationView(txResult.existing),
        });
      }
      throw new ConflictError('This invite was already used by someone else');
    }

    const registration = txResult.registration!;
    await auditFromContext(actor, {
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
    const support = await resolveRegistrationAgent(registration);

    const { invite, inviteUrl } = await createCarrierInvite(ctx, {
      profile: 'driver',
      carrierId,
      ...(registration.applicationId ? { applicationId: registration.applicationId } : {}),
      ...(registration.companyName ? { companyName: registration.companyName } : {}),
      ...(support.agentName ? { agentName: support.agentName } : {}),
      ...(support.agentZohoUserId ? { agentZohoUserId: support.agentZohoUserId } : {}),
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

  // ── Self-service reads — real servercrm/DWH data behind the mini-app's demo action sheets ────

  app.post('/carrier/mini-app/balance', async (request) => {
    const body = selfServiceSchema.parse(request.body);
    const { carrierId } = await requireRegisteredCarrierUser(body.initData);
    return crmGet(`/api/agent/dwh/carrier-balance/${encodeURIComponent(carrierId)}`);
  });

  app.post('/carrier/mini-app/status', async (request) => {
    const body = selfServiceSchema.parse(request.body);
    const { carrierId } = await requireRegisteredCarrierUser(body.initData);
    const [overview, cards] = await Promise.all([
      crmGet(`/api/agent/dwh/carrier-overview/${encodeURIComponent(carrierId)}`),
      crmGet(`/api/agent/dwh/cards/${encodeURIComponent(carrierId)}`),
    ]);
    return { overview, cards };
  });

  app.post('/carrier/mini-app/transactions', async (request) => {
    const body = rangeSchema.parse(request.body);
    const { carrierId } = await requireRegisteredCarrierUser(body.initData);
    return crmGet(`/api/agent/dwh/transactions/${encodeURIComponent(carrierId)}`, {
      range: body.from && body.to ? 'custom' : (body.range ?? 'month'),
      ...(body.from ? { from: body.from } : {}),
      ...(body.to ? { to: body.to } : {}),
      limit: 100,
    });
  });

  app.post('/carrier/mini-app/last-used', async (request) => {
    const body = rangeSchema.parse(request.body);
    const { carrierId } = await requireRegisteredCarrierUser(body.initData);
    return crmGet(`/api/agent/dwh/cards/${encodeURIComponent(carrierId)}/last-used`, {
      range: body.range ?? 'all_time',
    });
  });

  app.post('/carrier/mini-app/payment-info', async (request) => {
    const body = selfServiceSchema.parse(request.body);
    const { carrierId } = await requireRegisteredCarrierUser(body.initData);
    return crmGet(`/api/agent/dwh/payment-info/${encodeURIComponent(carrierId)}`, { days: 90 });
  });

  app.post('/carrier/mini-app/invoices', async (request) => {
    const body = invoicesSchema.parse(request.body);
    const { carrierId } = await requireRegisteredCarrierUser(body.initData);
    return crmGet('/api/salesMytrion/fetchInvoices', {
      carrierId,
      range: body.from && body.to ? 'custom' : (body.range ?? 'last_30'),
      ...(body.status ? { status: body.status } : {}),
      ...(body.from ? { from: body.from } : {}),
      ...(body.to ? { to: body.to } : {}),
    });
  });

  // A signed URL isn't itself carrier-scoped upstream, so re-check the invoice belongs to THIS
  // caller's carrier before minting one — otherwise any registered user could probe arbitrary
  // invoiceIds.
  app.post('/carrier/mini-app/invoices/signed-url', async (request) => {
    const body = invoiceSignedUrlSchema.parse(request.body);
    const { carrierId } = await requireRegisteredCarrierUser(body.initData);
    const list = await crmGet<{ data?: Array<Record<string, unknown>> }>('/api/salesMytrion/fetchInvoices', {
      carrierId,
      range: 'all_time',
    });
    const owned = (list.data ?? []).some((inv) => String(inv['invoice_id'] ?? inv['id'] ?? '') === body.invoiceId);
    if (!owned) {
      throw new AppError('That invoice does not belong to this carrier', {
        statusCode: 403,
        code: 'INVOICE_NOT_OWNED',
        expose: true,
      });
    }
    return crmGet(`/api/salesMytrion/invoices/${encodeURIComponent(body.invoiceId)}/signed-url`, { type: 'pdf' });
  });

  app.post('/carrier/mini-app/tracking', async (request) => {
    const body = selfServiceSchema.parse(request.body);
    const { carrierId } = await requireRegisteredCarrierUser(body.initData);
    try {
      return await executeZohoFunctionWithFallback(['mytriontruckingnumberrequest'], { carrierId }, { unwrap: 'status' });
    } catch (err) {
      throw new AppError('Tracking lookup failed', { statusCode: 502, code: 'TRACKING_ERROR', expose: true, cause: err });
    }
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
  agentName: string | null;
}) {
  return {
    id: row.id,
    profile: row.profile,
    companyName: row.companyName,
    carrierId: row.carrierId,
    companyType: row.companyType,
    cardCount: row.cardCount,
    cardId: row.cardId,
    agentName: row.agentName,
  };
}
