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
import { FLEET_CARD_LIMIT, getDwhCompanyDetails, listDwhCards, findDwhCardById, findDwhCardByNumber } from '../../integrations/dwhCards.js';
import { listDwhTransactions, resolveDwhTxnRange } from '../../integrations/dwhTransactions.js';
import { searchDwhClients } from '../../integrations/dwhClients.js';
import { searchDwhOperators } from '../../integrations/dwhOperators.js';
import { serverCrmWrapper } from '../../wrappers/serverCrmWrapper.js';
import {
  TXN_FETCH_LIMIT,
  cardDigits,
  clampToWindow,
  scopeRowsToCard,
  scopeTransactionsToCard,
} from '../../modules/carrier/driverCardScope.js';
import { executeZohoFunctionWithFallback } from '../../integrations/zohoFunctions.js';
import {
  fileServiceRequest,
  serviceRequestAllows,
  serviceRequestSpec,
  SERVICE_REQUEST_KEYS,
} from '../../modules/carrier/serviceRequest.js';
import { carrierInvitationRepo } from '../../repos/carrierInvitationRepo.js';
import { registeredMiniAppCompanyRepo } from '../../repos/registeredMiniAppCompanyRepo.js';
import { buildInviteUrl, createCarrierInvite } from '../../modules/carrier/inviteService.js';
import {
  parseInitDataUser,
  escapeTelegramHtml,
  sendDocument,
  signTelegramInitData,
  TelegramChatUnreachableError,
  verifyTelegramInitData,
  type TelegramWebAppUser,
} from '../../integrations/telegramCarrierBot.js';
import { buildTxnReport } from '../../modules/carrier/txnReport.js';
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
/** Same 200-char cap as the invite form and the driver's own sign-in — one column, one bound. */
const ownerDriverRenameSchema = z.object({
  initData: z.string().min(1),
  cardId: z.string().min(1).max(120),
  driverName: z.string().trim().min(1).max(200),
});

// ── Self-service reads (any registered user — owner or driver; carrier-level data both may see) ─
const selfServiceSchema = z.object({ initData: z.string().min(1) });
const rangeSchema = z.object({
  initData: z.string().min(1),
  range: z.string().max(20).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});
/**
 * `live` drives the mini-app's two-phase transactions read:
 *   false (default) — DWH mart only, ~200ms. Paints immediately, but misses anything newer than
 *                     the mart's last refresh (~3h).
 *   true            — servercrm's endpoint: the same mart rows PLUS a live EFS gap-fill, which
 *                     costs 3–24s. The caller fires this second and swaps the list in.
 * Default false so a caller that never heard of `live` gets the fast path, not the slow one.
 */
const txnRangeSchema = rangeSchema.extend({ live: z.boolean().optional().default(false) });
const txnExportSchema = rangeSchema.extend({ format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx') });
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
/** `service` is an enum, not free text: it selects a spec from a server-side map (subject, Desk
 *  department, allowed roles), so a caller cannot invent a request type or route one to an arbitrary
 *  queue. `comment` is the only free text and lands in the ticket body as content. */
const serviceRequestSchema = z.object({
  initData: z.string().min(1),
  service: z.enum(SERVICE_REQUEST_KEYS),
  comment: z.string().max(2000).optional(),
});
const driverSelfRegisterSchema = z.object({
  initData: z.string().min(1),
  cardNumber: z.string().trim().min(4).max(40),
  /** The driver's own name, typed on the card-number sign-in screen. Optional so an older client
   *  keeps working; when absent the Telegram profile name is used, as before. Same 200-char cap the
   *  owner's driver-invite form uses — it lands in the same column. */
  driverName: z.string().trim().min(1).max(200).optional(),
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
 * Verify initData and resolve the caller to ANY registered OWNER with a carrier — the gate for the
 * money views a driver must never see: invoices and payment info.
 *
 * Distinct from `requireRegisteredOwner`, which additionally demands `fleet-manager` because it
 * guards driver management; an owner-operator has no fleet to manage but is still the owner of the
 * account, and the docx's "For Fleet Owners" category covers both. The only thing excluded here is
 * a driver.
 *
 * These reads were open to any registered carrier user, so a driver's initData could fetch the
 * whole carrier's invoices directly — the UI simply never offered them the button. Both the docx
 * (invoices/payment sit under Fleet Owners; the driver list has neither) and
 * OCTANE_MINIAPP_SERVICES_SPEC §2 ("no carrier balance, invoices, payment info, account status")
 * agree, so this is the code catching up with them.
 */
async function requireRegisteredOwnerUser(
  initData: string,
): Promise<{ registration: RegisteredMiniAppCompany; carrierId: string }> {
  const { registration } = await requireRegisteredMiniAppUser(initData);
  if (registration.profile !== 'owner' || !registration.carrierId) {
    throw new AppError('This view is only available to the company owner', {
      statusCode: 403,
      code: 'NOT_A_REGISTERED_OWNER_USER',
      expose: true,
    });
  }
  return { registration, carrierId: registration.carrierId };
}

/**
 * The driver's own card number — the scope key for every row-level driver filter below.
 *
 * FAIL-CLOSED BY DESIGN: resolveDriverCardNumber is best-effort and returns null when the DWH is
 * unconfigured/down or the card is gone. Every other caller treats that null as "degrade to the
 * masked cardId", but here a null must NEVER fall through to the carrier-wide rows — that is
 * exactly the leak this scoping exists to prevent. So: no card number → no data, 503.
 */
async function requireDriverCardNumber(registration: RegisteredMiniAppCompany): Promise<string> {
  const cardNumber = await resolveDriverCardNumber(registration.carrierId, registration.cardId);
  if (!cardNumber) {
    throw new AppError("We couldn't confirm which card is yours right now. Please try again shortly.", {
      statusCode: 503,
      code: 'DRIVER_CARD_UNRESOLVED',
      expose: true,
    });
  }
  return cardNumber;
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
    const extras = await resolveDriverExtras(registration);
    return { registration: toRegistrationView({ ...registration, ...support, ...extras }) };
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
      // A REVOKED registration no longer owns this Telegram account, so it must not veto a new one.
      // findByTelegramUserId returns revoked rows too, so without this check revoke was a dead end:
      // the user could neither use their access (403 MINI_APP_REVOKED) nor be re-registered anywhere
      // — the account was bricked. This does not weaken the guard: an ACTIVE registration still
      // blocks a rebind, which is what stops a leaked link from moving someone's account.
      const bindingExists = Boolean(existing) && existing?.status !== 'revoked';
      if (bindingExists && existing && !sameRegistrationSubject(existing, invite)) {
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
        const existing = txResult.existing;
        const extras = await resolveDriverExtras(existing);
        return reply.send({
          alreadyRegistered: true,
          registration: toRegistrationView({ ...existing, ...extras }),
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

    const extras = await resolveDriverExtras(registration);
    return reply.code(201).send({
      registration: toRegistrationView({ ...registration, ...extras }),
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
      // The owner's whole fleet, not the default 100. The screen's filter counts and search run over
      // this array client-side, so a short list doesn't just hide cards — it misreports the totals
      // beside the chips. Measured: the largest real carrier has 510 active cards, so an owner of it
      // was seeing 100 and being told that was all of them.
      env.DWH_DATABASE_URL ? listDwhCards(carrierId, FLEET_CARD_LIMIT).catch(() => []) : Promise.resolve([]),
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
   * Owner corrects the driver name on one of their cards.
   *
   * Renames whichever the fleet row is showing: an active registration if the driver signed in, else
   * the still-pending invite (the roster shows that name before the link is ever opened). Only the
   * label changes — not who holds the card, so this is not a reassignment path.
   *
   * The carrier comes from the caller's own registration and the repos filter on (tenant, carrier,
   * card), so an owner cannot reach another carrier's row by sending a cardId that isn't theirs:
   * the update simply matches nothing and 404s.
   */
  app.post('/carrier/mini-app/driver-name', async (request) => {
    const body = ownerDriverRenameSchema.parse(request.body);
    const { ctx, carrierId } = await requireRegisteredOwner(body.initData);

    const renamed = await registeredMiniAppCompanyRepo.renameDriverByCard(ctx, carrierId, body.cardId, body.driverName);
    const target = renamed ?? (await carrierInvitationRepo.renameDriverByCard(ctx, carrierId, body.cardId, body.driverName));
    if (!target) {
      throw new NotFoundError('That card has no driver to rename');
    }
    await auditFromContext(ctx, {
      action: 'carrier.mini_app.driver_rename',
      status: 'ok',
      resourceType: renamed ? 'registered_mini_app_company' : 'carrier_invitation',
      resourceId: target.id,
      detail: { carrierId, cardId: body.cardId },
    });
    return { cardId: body.cardId, driverName: body.driverName };
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
    return serverCrmWrapper.getCarrierBalance(carrierId);
  });

  /**
   * The carrier's company profile (id, contact, address) for the owner's profile sheet.
   *
   * Owner-only: this is company-level contact and address data, an account holder's view — a driver
   * asking about their card has no need for the company's email and mailing address. carrierId is
   * always returned (it is the caller's own), even when the DWH has no dim_company row.
   */
  app.post('/carrier/mini-app/company', async (request) => {
    const body = selfServiceSchema.parse(request.body);
    const { carrierId } = await requireRegisteredOwnerUser(body.initData);
    const details = env.DWH_DATABASE_URL ? await getDwhCompanyDetails(carrierId).catch(() => null) : null;
    return details ?? { carrierId, companyName: null, email: null, phone: null, address: null, city: null, state: null, zip: null };
  });

  // The card list is carrier-wide upstream; a driver only ever sees their own card in it. `overview`
  // stays carrier-level (it is the account standing the driver catalog's "Check card status" shows).
  app.post('/carrier/mini-app/status', async (request) => {
    const body = selfServiceSchema.parse(request.body);
    const { registration, carrierId } = await requireRegisteredCarrierUser(body.initData);
    const [overview, cards] = await Promise.all([
      serverCrmWrapper.getCarrierOverview(carrierId),
      serverCrmWrapper.getCards(carrierId),
    ]);
    if (registration.profile !== 'driver') return { overview, cards };
    const cardNumber = await requireDriverCardNumber(registration);
    const rows = scopeRowsToCard(cards.data ?? [], cardNumber);
    return { overview, cards: { ...cards, data: rows, count: rows.length, active_count: rows.length } };
  });

  /**
   * Transactions, in two phases (see `txnRangeSchema.live`). The FAST phase reads the DWH mart
   * directly — it skips servercrm's live EFS gap-fill, which is what makes the merged read cost
   * 3–24s. The SLOW phase delegates to servercrm so the EFS merge/de-dup logic stays in exactly one
   * place (and the zoho-octane widgets' endpoint is untouched).
   *
   * A driver is scoped to their own card in BOTH phases — at the SQL level on the fast path, and by
   * filtering servercrm's carrier-wide payload on the merged path.
   */
  app.post('/carrier/mini-app/transactions', async (request) => {
    const body = txnRangeSchema.parse(request.body);
    const { registration, carrierId } = await requireRegisteredCarrierUser(body.initData);
    const opts = { range: body.range, from: body.from, to: body.to };
    const isDriver = registration.profile === 'driver';
    const cardNumber = isDriver ? await requireDriverCardNumber(registration) : null;

    if (!body.live) {
      const result = await listDwhTransactions({
        carrierId,
        ...(cardNumber ? { cardNumber } : {}),
        ...opts,
        limit: TXN_FETCH_LIMIT,
      });
      // Tell the client the EFS tail is still missing, so it knows to fire the live phase.
      return { ...result, live: { merged: 0, pending: true } };
    }

    const merged = await serverCrmWrapper.getTransactions(carrierId, { ...opts, limit: TXN_FETCH_LIMIT });
    const scoped = cardNumber ? scopeTransactionsToCard(merged, cardNumber) : merged;
    return clampToWindow(scoped, resolveDwhTxnRange(body.range, body.from, body.to));
  });

  /**
   * Build the transactions report and deliver it to the caller's Telegram chat as a document.
   *
   * Delivery is via the bot, not an HTTP download, because a Telegram WebApp has no dependable way
   * to save a file — the report lands in the bot chat instead, where it persists and can be shared.
   *
   * Reads the FAST DWH path deliberately: a report is a record of the window, not a live view, so
   * it isn't worth the EFS gap-fill's seconds. Drivers get their own card only.
   */
  app.post('/carrier/mini-app/transactions/export', async (request) => {
    const body = txnExportSchema.parse(request.body);
    const { registration, carrierId } = await requireRegisteredCarrierUser(body.initData);
    const { telegramUserId } = verifyTelegramUser(body.initData);
    const isDriver = registration.profile === 'driver';
    const cardNumber = isDriver ? await requireDriverCardNumber(registration) : null;

    const result = await listDwhTransactions({
      carrierId,
      ...(cardNumber ? { cardNumber } : {}),
      range: body.range,
      from: body.from,
      to: body.to,
      limit: TXN_FETCH_LIMIT,
    });
    if (result.data.length === 0) {
      throw new AppError('There are no transactions in that period to export.', {
        statusCode: 404,
        code: 'TXN_EXPORT_EMPTY',
        expose: true,
      });
    }

    const rangeLabel = result.range.from ? `${result.range.from} → ${result.range.to}` : String(result.range.preset);
    const report = await buildTxnReport(result.data, body.format, {
      company: registration.companyName ?? 'Octane',
      range: rangeLabel,
      cardLast4: cardNumber ? cardNumber.slice(-4) : String(carrierId),
      scopedToCard: Boolean(cardNumber),
    });

    // A private chat's id IS the user's id; telegramChatId is only populated when the redeem call
    // happened to carry the header, so it can't be relied on alone.
    const chatId = registration.telegramChatId ?? telegramUserId;
    // The caption is the message the carrier actually reads in the chat — the file is an
    // attachment to it, not the other way round. It leads with the same figures the mini-app's
    // sheet just showed, so the two agree. Company name is escaped: it is data, and a stray '&'
    // would make Telegram reject the send outright.
    const money = (v: unknown) => `$${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const scope = cardNumber ? `Card •••• ${cardNumber.slice(-4)}` : 'All cards';
    const caption = [
      `<b>Octane · Transaction Report</b>`,
      `${escapeTelegramHtml(registration.companyName ?? 'Octane')} · ${scope}`,
      `${rangeLabel}`,
      ``,
      `${result.data.length} line items · <b>${money(result.totals['funded_total'])}</b> spent · ${money(result.totals['discount_amount'])} saved`,
    ].join('\n');
    try {
      await sendDocument({
        chatId,
        fileName: report.fileName,
        contentType: report.contentType,
        bytes: report.bytes,
        caption,
        parseMode: 'HTML',
      });
    } catch (err) {
      if (err instanceof TelegramChatUnreachableError) {
        throw new AppError('Open a chat with the Octane bot first, then try the export again.', {
          statusCode: 409,
          code: 'TELEGRAM_CHAT_UNREACHABLE',
          expose: true,
          cause: err,
        });
      }
      throw new AppError("Couldn't send the report to your Telegram. Please try again.", {
        statusCode: 502,
        code: 'TXN_EXPORT_SEND_FAILED',
        expose: true,
        cause: err,
      });
    }

    await auditFromContext(telegramCtx(registration.profile, telegramUserId), {
      action: 'carrier.mini_app.transactions_export',
      status: 'ok',
      resourceType: 'carrier_transactions_report',
      resourceId: String(carrierId),
      detail: {
        format: body.format,
        range: rangeLabel,
        rows: result.data.length,
        scopedToCard: Boolean(cardNumber),
      },
    });

    return { sent: true, fileName: report.fileName, rows: result.data.length };
  });

  app.post('/carrier/mini-app/last-used', async (request) => {
    const body = rangeSchema.parse(request.body);
    const { registration, carrierId } = await requireRegisteredCarrierUser(body.initData);
    const result = await serverCrmWrapper.getLastUsed(carrierId, body.range);
    if (registration.profile !== 'driver') return result;
    const cardNumber = await requireDriverCardNumber(registration);
    const rows = scopeRowsToCard(result.data ?? [], cardNumber);
    return { ...result, data: rows, count: rows.length };
  });

  app.post('/carrier/mini-app/payment-info', async (request) => {
    const body = selfServiceSchema.parse(request.body);
    const { carrierId } = await requireRegisteredOwnerUser(body.initData);
    return serverCrmWrapper.getPaymentInfo(carrierId);
  });

  app.post('/carrier/mini-app/invoices', async (request) => {
    const body = invoicesSchema.parse(request.body);
    const { carrierId } = await requireRegisteredOwnerUser(body.initData);
    return serverCrmWrapper.getInvoices(carrierId, { range: body.range, status: body.status, from: body.from, to: body.to });
  });

  // A signed URL isn't itself carrier-scoped upstream, so re-check the invoice belongs to THIS
  // caller's carrier before minting one — otherwise any registered user could probe arbitrary
  // invoiceIds.
  /** Resolve an invoice to a signed URL, but only after proving it is THIS carrier's. The upstream
   *  signed-url endpoint takes an invoiceId and nothing else — the ids are enumerable integers, so
   *  without this check any owner could mint a URL for anyone's invoice. */
  async function ownedInvoiceUrl(
    initData: string,
    invoiceId: string,
  ): Promise<{ url: string; carrierId: string; invoice: Record<string, unknown>; registration: RegisteredMiniAppCompany }> {
    const { carrierId, registration } = await requireRegisteredOwnerUser(initData);
    const list = await serverCrmWrapper.getInvoices(carrierId, { range: 'all_time' });
    const invoice = (list.data ?? []).find((inv) => String(inv['invoice_id'] ?? inv['id'] ?? '') === invoiceId);
    if (!invoice) {
      throw new AppError('That invoice does not belong to this carrier', {
        statusCode: 403,
        code: 'INVOICE_NOT_OWNED',
        expose: true,
      });
    }
    const { url } = (await serverCrmWrapper.getInvoiceSignedUrl(invoiceId)) as { url?: string };
    if (!url) {
      throw new AppError('That invoice has no document to download', {
        statusCode: 404,
        code: 'INVOICE_NO_DOCUMENT',
        expose: true,
      });
    }
    return { url, carrierId, invoice, registration };
  }

  app.post('/carrier/mini-app/invoices/signed-url', async (request) => {
    const body = invoiceSignedUrlSchema.parse(request.body);
    const { url } = await ownedInvoiceUrl(body.initData, body.invoiceId);
    return { url };
  });

  /**
   * Deliver one invoice PDF to the caller's Telegram chat.
   *
   * Same reason the transaction report goes this way: a Telegram WebApp cannot reliably save a file
   * — an in-app WebView download either silently no-ops or escapes to an external browser, and the
   * signed URL expires. In the chat the document persists and can be forwarded to a bookkeeper.
   *
   * The bytes are pulled through the SIGNED URL rather than servercrm's client, which parses JSON
   * and would mangle a PDF.
   */
  app.post('/carrier/mini-app/invoices/send', async (request) => {
    const body = invoiceSignedUrlSchema.parse(request.body);
    // One registration lookup, not two: ownedInvoiceUrl already resolves the owner. verifyTelegramUser
    // is just the HMAC — no DB — so it stays.
    const { telegramUserId } = verifyTelegramUser(body.initData);
    const { url, carrierId, invoice, registration } = await ownedInvoiceUrl(body.initData, body.invoiceId);

    const res = await fetch(url);
    if (!res.ok) {
      throw new AppError("Couldn't fetch that invoice document. Please try again.", {
        statusCode: 502,
        code: 'INVOICE_FETCH_FAILED',
        expose: true,
      });
    }
    const bytes = Buffer.from(await res.arrayBuffer());

    const money = (v: unknown) => `$${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const status = String(invoice['status'] ?? '').replace(/_/g, ' ');
    const caption = [
      `<b>Octane · Invoice #${escapeTelegramHtml(body.invoiceId)}</b>`,
      escapeTelegramHtml(registration.companyName ?? 'Octane'),
      ``,
      `${money(invoice['total_amount'])} · ${escapeTelegramHtml(status)}`,
    ].join('\n');

    try {
      await sendDocument({
        chatId: registration.telegramChatId ?? telegramUserId,
        fileName: `Octane_Invoice_${body.invoiceId}.pdf`,
        contentType: 'application/pdf',
        bytes,
        caption,
        parseMode: 'HTML',
      });
    } catch (err) {
      if (err instanceof TelegramChatUnreachableError) {
        throw new AppError('Open a chat with the Octane bot first, then try again.', {
          statusCode: 409,
          code: 'TELEGRAM_CHAT_UNREACHABLE',
          expose: true,
          cause: err,
        });
      }
      throw new AppError("Couldn't send the invoice to your Telegram. Please try again.", {
        statusCode: 502,
        code: 'INVOICE_SEND_FAILED',
        expose: true,
        cause: err,
      });
    }

    await auditFromContext(telegramCtx(registration.profile, telegramUserId), {
      action: 'carrier.mini_app.invoice_send',
      status: 'ok',
      resourceType: 'carrier_invoice',
      resourceId: body.invoiceId,
      detail: { carrierId, bytes: bytes.length },
    });

    return { sent: true, fileName: `Octane_Invoice_${body.invoiceId}.pdf` };
  });

  /**
   * File a service request as a real Zoho Desk ticket.
   *
   * The card is NEVER taken from the request body. A driver's card is resolved from their own
   * registration server-side, so a driver cannot file an override against a colleague's card by
   * editing the payload — the same reason the read endpoints scope rows rather than trusting a
   * client-side filter.
   */
  app.post('/carrier/mini-app/service-request', async (request) => {
    const body = serviceRequestSchema.parse(request.body);
    const { registration, carrierId } = await requireRegisteredCarrierUser(body.initData);
    const profile = registration.profile;
    if (!serviceRequestAllows(body.service, profile)) {
      throw new RBACError('This request is not available for your account.');
    }
    const cardNumber = profile === 'driver' ? await requireDriverCardNumber(registration) : null;
    const ctx = telegramCtx(profile, registration.telegramUserId);
    try {
      const ticketId = await fileServiceRequest({
        key: body.service,
        profile,
        carrierId,
        cardNumber,
        requesterName: registration.driverName ?? registration.companyName ?? 'Octane customer',
        telegramUserId: registration.telegramUserId,
        telegramUsername: registration.telegramUsername,
        companyName: registration.companyName,
        comment: body.comment?.trim() || null,
      });
      await auditFromContext(ctx, {
        action: 'carrier.mini_app.service_request',
        status: 'ok',
        resourceType: 'desk_ticket',
        resourceId: ticketId,
        detail: { service: body.service, carrierId, profile },
      });
      return { ticketId, subject: serviceRequestSpec(body.service).subject };
    } catch (err) {
      await auditFromContext(ctx, {
        action: 'carrier.mini_app.service_request',
        status: 'error',
        resourceType: 'desk_ticket',
        detail: { service: body.service, carrierId, profile },
      });
      // The mini-app must not report "sent" on a ticket that does not exist — that is exactly the
      // fake this endpoint replaces.
      throw new AppError("We couldn't send your request. Please try again shortly.", {
        statusCode: 502,
        code: 'SERVICE_REQUEST_FAILED',
        expose: true,
        cause: err,
      });
    }
  });

  // Owner-only, unlike the other self-service reads. Every driver-reachable endpoint scopes its rows
  // to the caller's own card (see scopeRowsToCard) — this one CANNOT: the upstream response is a
  // shipment record ({ trackingNumber, startDate, cardsOrdered }) with no card identity in it at
  // all, so there is nothing to filter on. It describes a carrier's bulk card order, not any one
  // driver's card. Under requireRegisteredCarrierUser a driver's initData was accepted and got the
  // whole fleet's shipments back; no catalog entry pointed here, but the route was open to a direct
  // call. Answering "where is my card" for a driver needs an upstream that returns per-card rows.
  app.post('/carrier/mini-app/tracking', async (request) => {
    const body = selfServiceSchema.parse(request.body);
    const { carrierId } = await requireRegisteredOwnerUser(body.initData);
    try {
      return await executeZohoFunctionWithFallback(['mytriontruckingnumberrequest'], { carrierId }, { unwrap: 'status' });
    } catch (err) {
      throw new AppError('Tracking lookup failed', { statusCode: 502, code: 'TRACKING_ERROR', expose: true, cause: err });
    }
  });

  /**
   * Driver self-registration by fuel-card NUMBER (no invite link). The number is printed on the
   * physical card, so possession identifies the carrier + card; the Telegram initData HMAC proves
   * identity. Only DRIVERS may self-register — company/owner accounts stay invite-only.
   * Reuses createCarrierInvite's validation (card active + one-driver-per-card) by minting a real
   * invite for the resolved card, then redeeming it for this Telegram user.
   */
  app.post('/carrier/mini-app/driver-self-register', async (request, reply) => {
    const body = driverSelfRegisterSchema.parse(request.body);
    const { tgUser, telegramUserId } = verifyTelegramUser(body.initData);
    // Digits only. The lookup is an exact `card_number = $1` against a column of bare 19-digit
    // strings, and the number is PRINTED on the card in groups of four — the mini-app's own input
    // even re-groups it as you type. Trimming alone left the backend depending on the client to
    // strip the spaces back out: any caller forwarding what the driver actually sees got a 404 for
    // a card that exists. Same normalization the row scoping uses, so both agree on what a card
    // number is.
    const card = await findDwhCardByNumber(cardDigits(body.cardNumber));
    if (!card) {
      throw new AppError('No active fuel card matches that number', {
        statusCode: 404,
        code: 'CARD_NOT_FOUND',
        expose: true,
      });
    }
    const ctx = lookupCtx();
    /**
     * The name the driver typed wins over their Telegram profile name.
     *
     * This string is not cosmetic: it is what the OWNER sees in their fleet roster next to a card,
     * and what support reads on a ticket. A Telegram display name is whatever the person set it to
     * — a nickname, emoji, or the phone's default — so deriving it silently put "🔥Sasha🔥" against
     * a truck. The profile name stays as the fallback for clients that don't send one.
     */
    const driverName =
      body.driverName ||
      [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ').trim() ||
      tgUser.username ||
      'Driver';

    // Idempotency + cross-carrier guard before minting any invite (avoids orphan pending invites).
    //
    // A REVOKED registration no longer owns this Telegram account, so it must not veto a new one —
    // the same rule the redeem path already applies. findByTelegramUserId returns revoked rows too,
    // so without this filter revoke was a dead end for card-number sign-in specifically: redeeming
    // an invite worked, signing in with the card 409'd TELEGRAM_ALREADY_REGISTERED forever. The
    // upsert below clears status/revokedAt, so proceeding is what actually restores access.
    const found = await registeredMiniAppCompanyRepo.findByTelegramUserId(ctx, telegramUserId);
    const existing = found && found.status !== 'revoked' ? found : undefined;
    if (existing) {
      const sameCard = existing.profile === 'driver' && existing.carrierId === card.carrierId && existing.cardId === card.cardId;
      if (!sameCard) {
        throw new ConflictError('This Telegram account is already registered to another carrier', {
          code: 'TELEGRAM_ALREADY_REGISTERED',
        });
      }
      const extras = await resolveDriverExtras(existing);
      return reply.send({ registration: toRegistrationView({ ...existing, ...extras }) });
    }

    // Mint the invite (validates the card is active + not already taken by another driver), then
    // redeem it for this Telegram user in one transaction.
    const { invite } = await createCarrierInvite(ctx, {
      profile: 'driver',
      carrierId: card.carrierId,
      cardId: card.cardId,
      driverName,
    });
    const registration = await db.transaction(async (tx) => {
      await carrierInvitationRepo.markRedeemed(ctx, invite.id, `telegram:${telegramUserId}`, tx);
      return registeredMiniAppCompanyRepo.upsert(
        ctx,
        {
          invitationId: invite.id,
          profile: 'driver',
          telegramUserId,
          ...(tgUser.username ? { telegramUsername: tgUser.username } : {}),
          carrierId: card.carrierId,
          cardId: card.cardId,
          driverName,
        },
        tx,
      );
    });
    await auditFromContext(telegramCtx('driver', telegramUserId), {
      action: 'mini_app.driver_self_register',
      status: 'ok',
      resourceType: 'registered_mini_app_company',
      resourceId: registration.id,
      detail: { carrierId: card.carrierId, cardId: card.cardId },
    });
    const extras = await resolveDriverExtras(registration);
    return reply.code(201).send({ registration: toRegistrationView({ ...registration, ...extras }) });
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
  cardNumber?: string | null;
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
    cardNumber: row.cardNumber ?? null,
  };
}

/**
 * The driver's real fuel-card number (octane.stg_cmp_card.card_number), looked up by cardId from the
 * DWH replica — the mini-app session only carries cardId, so this is what lets the driver hero show
 * the real PAN instead of a fabricated one. Best-effort: null (not an error) if the DWH is
 * unconfigured, the lookup fails, or no card matches — the UI falls back to the masked cardId.
 */
async function resolveDriverCardNumber(carrierId: string | null, cardId: string | null): Promise<string | null> {
  if (!carrierId || !cardId || !env.DWH_DATABASE_URL) return null;
  try {
    // Exact lookup. This used to `.find()` inside listDwhCards, which caps at 100 — so on a carrier
    // with 230 (or 510) active cards a driver whose card sorted past the cap resolved to null, and
    // requireDriverCardNumber turned that into a permanent 503: every read they had, dead.
    return (await findDwhCardById(carrierId, cardId))?.cardNumber ?? null;
  } catch {
    return null;
  }
}

/**
 * The carrier's company name from the DWH — used to fill a driver registration's card label when the
 * invite didn't capture a companyName (older invites). Best-effort, never blocks.
 */
async function resolveCarrierCompanyName(carrierId: string | null): Promise<string | null> {
  if (!carrierId || !env.DWH_DATABASE_URL) return null;
  try {
    const operators = await searchDwhOperators({ q: carrierId, limit: 10 });
    return operators.find((o) => o.carrierId === carrierId)?.companyName ?? null;
  } catch {
    return null;
  }
}

/** DWH-resolved extras for a DRIVER registration (real card number + company name fallback). */
async function resolveDriverExtras(
  reg: Pick<RegisteredMiniAppCompany, 'profile' | 'carrierId' | 'cardId' | 'companyName'>,
): Promise<{ cardNumber: string | null; companyName?: string }> {
  if (reg.profile !== 'driver') return { cardNumber: null };
  const [cardNumber, resolvedCompany] = await Promise.all([
    resolveDriverCardNumber(reg.carrierId, reg.cardId),
    reg.companyName ? Promise.resolve(reg.companyName) : resolveCarrierCompanyName(reg.carrierId),
  ]);
  return { cardNumber, ...(resolvedCompany ? { companyName: resolvedCompany } : {}) };
}
