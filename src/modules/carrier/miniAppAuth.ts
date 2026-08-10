/**
 * Shared auth/scoping helpers for the Telegram carrier mini-app routes.
 *
 * Extracted verbatim from routes/v1/carrierMiniApp.routes.ts so the write-action routes
 * (carrierMiniAppActions.routes.ts) reuse the SAME gates instead of re-implementing them —
 * the security boundary (Telegram initData HMAC → registration lookup → role check) must
 * exist in exactly one place.
 */
import { createId } from '@paralleldrive/cuid2';
import { AppError, AuthError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import { findDwhCardByIdAnyStatus } from '../../integrations/dwhCards.js';
import { searchDwhOperators } from '../../integrations/dwhOperators.js';
import { registeredMiniAppCompanyRepo } from '../../repos/registeredMiniAppCompanyRepo.js';
import { carrierUserRepo } from '../../repos/carrierUserRepo.js';
import {
  parseInitDataUser,
  verifyTelegramInitData,
  type TelegramWebAppUser,
} from '../../integrations/telegramCarrierBot.js';
import type { RegisteredMiniAppCompany } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { getCurrentContext } from '../../plugins/requestContext.js';
import { verifyToken } from '../auth/jwt.js';
import {
  assertMiniAppCapability,
  type MiniAppActorProfile,
  type MiniAppCapability,
} from './miniAppCapabilities.js';

export interface MiniAppAuthOpts {
  /** Bearer from Authorization — required when the registration has a password account. */
  accessToken?: string | undefined;
  /** Login / set-password / forgot / session bootstrap may use initData alone. */
  allowWithoutPasswordSession?: boolean | undefined;
}

/** Pull a Bearer token out of the standard Authorization header. */
export function accessTokenFromAuthHeader(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith('Bearer ')) return undefined;
  const token = authorization.slice('Bearer '.length).trim();
  return token || undefined;
}

export type MiniAppActorRegistration = Omit<RegisteredMiniAppCompany, 'profile'> & {
  profile: MiniAppActorProfile;
};

/** Tenant-scoping only — no admin authority. Repos key off ctx.tenantId; audit reads the rest. */
export function lookupCtx(): TenantContext {
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

/** owner + manager share every capability gate — manager is a company-access colleague, not a
 *  driver. This is the single predicate every owner-only check keys off, so "manager == owner"
 *  lives in exactly one place. */
export function isOwnerLike(profile: MiniAppActorProfile): boolean {
  return profile === 'owner' || profile === 'manager';
}

/** Sales agents may enter selected-company read gates, but remain distinct from customer owners. */
function isOwnerOrSalesAgent(profile: MiniAppActorProfile): boolean {
  return isOwnerLike(profile) || profile === 'sales_agent';
}

/** The actual actor once a Telegram user is verified — customer audience, deny-by-default. */
export function telegramCtx(profile: MiniAppActorProfile, telegramUserId: string): TenantContext {
  if (profile === 'sales_agent') {
    const current = getCurrentContext();
    if (
      current?.role !== 'sales_agent' ||
      current.miniAppAgent?.telegramUserId !== telegramUserId
    ) {
      throw new AppError('Sales agent mini-app context is unavailable', {
        statusCode: 401,
        code: 'SALES_AGENT_CONTEXT_MISSING',
        expose: true,
      });
    }
    return current;
  }
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: `telegram:${telegramUserId}`,
    audience: 'customer',
    role: isOwnerLike(profile) ? 'fleet_manager' : 'driver',
    scopes: [],
    departments: [],
    allDepartmentAccess: false,
    requestId: `mini-app-${createId()}`,
  };
}

export function verifyTelegramUser(initData: string): { tgUser: TelegramWebAppUser; telegramUserId: string } {
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
 * Resolve the current Telegram user to an existing mini-app registration.
 * Legacy (no password) accounts keep initData-only access. Password accounts must present a
 * 1-day Bearer from /carrier/mini-app/auth/login (unless allowWithoutPasswordSession).
 */
export async function requireRegisteredMiniAppUser(
  initData: string,
  opts: MiniAppAuthOpts = {},
): Promise<{ ctx: TenantContext; registration: MiniAppActorRegistration; tgUser: TelegramWebAppUser; telegramUserId: string }> {
  const { tgUser, telegramUserId } = verifyTelegramUser(initData);
  const agentCtx = getCurrentContext();
  if (
    agentCtx?.role === 'sales_agent' &&
    agentCtx.miniAppAgent?.telegramUserId === telegramUserId
  ) {
    const selected = agentCtx.miniAppAgent;
    const now = new Date();
    return {
      ctx: agentCtx,
      registration: {
        id: selected.principalId,
        tenantId: agentCtx.tenantId,
        invitationId: 'sales-agent-self-registration',
        profile: 'sales_agent',
        telegramUserId,
        telegramChatId: telegramUserId,
        telegramUsername: tgUser.username ?? null,
        languageCode: tgUser.language_code ?? null,
        carrierId: selected.selectedCarrierId,
        applicationId: null,
        companyName: selected.companyName,
        agentName: agentCtx.userName ?? null,
        agentZohoUserId: selected.zohoUserId,
        cardId: null,
        driverName: agentCtx.userName ?? null,
        companyType: selected.companyType,
        cardCount: selected.cardCount,
        authMode: 'telegram',
        status: 'active',
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      tgUser,
      telegramUserId,
    };
  }
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

  // Legacy telegram-mode registrations keep initData-only access. Password-mode accounts must
  // present a 1-day Bearer after set-password (unless the caller is the auth bootstrap itself).
  if (registration.authMode === 'password' && !opts.allowWithoutPasswordSession) {
    const passwordUser = await carrierUserRepo.findByTelegramUserId(lookup, telegramUserId);
    if (!passwordUser) {
      throw new AuthError('Set a password to finish registration', { code: 'PASSWORD_SETUP_REQUIRED' });
    }
    if (!opts.accessToken) {
      throw new AuthError('Password login required', { code: 'PASSWORD_LOGIN_REQUIRED' });
    }
    let claims;
    try {
      claims = await verifyToken(opts.accessToken, 'access');
    } catch {
      throw new AuthError('Session expired — log in again', { code: 'PASSWORD_SESSION_EXPIRED' });
    }
    if (!claims.client || claims.client.carrierUserId !== passwordUser.id) {
      throw new AuthError('Session does not match this account', { code: 'PASSWORD_SESSION_MISMATCH' });
    }
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
export async function requireRegisteredOwner(
  initData: string,
  capabilityOrOpts: MiniAppCapability | MiniAppAuthOpts = 'fleet:manage',
  maybeOpts: MiniAppAuthOpts = {},
): Promise<{ ctx: TenantContext; registration: MiniAppActorRegistration; carrierId: string; tgUser: TelegramWebAppUser }> {
  const capability =
    typeof capabilityOrOpts === 'string' ? capabilityOrOpts : 'fleet:manage';
  const opts = typeof capabilityOrOpts === 'string' ? maybeOpts : capabilityOrOpts;
  const { registration, tgUser, telegramUserId } = await requireRegisteredMiniAppUser(initData, opts);
  if (
    !registration ||
    !isOwnerOrSalesAgent(registration.profile) ||
    registration.companyType !== 'fleet-manager' ||
    !registration.carrierId
  ) {
    throw new AppError('Only a fleet company owner or manager can manage drivers', {
      statusCode: 403,
      code: 'NOT_A_REGISTERED_OWNER',
      expose: true,
    });
  }
  assertMiniAppCapability(registration.profile, capability);
  return {
    ctx: telegramCtx(registration.profile, telegramUserId),
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
export async function requireRegisteredCarrierUser(
  initData: string,
  capabilityOrOpts: MiniAppCapability | MiniAppAuthOpts = 'company:read',
  maybeOpts: MiniAppAuthOpts = {},
): Promise<{ registration: MiniAppActorRegistration; carrierId: string }> {
  const capability =
    typeof capabilityOrOpts === 'string' ? capabilityOrOpts : 'company:read';
  const opts = typeof capabilityOrOpts === 'string' ? maybeOpts : capabilityOrOpts;
  const { registration } = await requireRegisteredMiniAppUser(initData, opts);
  if (!registration.carrierId) {
    throw new AppError('This registration has no linked carrier yet', {
      statusCode: 404,
      code: 'NO_CARRIER_ID',
      expose: true,
    });
  }
  assertMiniAppCapability(registration.profile, capability);
  return { registration, carrierId: registration.carrierId };
}

/**
 * Verify initData and resolve the caller to ANY registered OWNER with a carrier — the gate for the
 * money views a driver must never see: invoices and payment info.
 *
 * Distinct from `requireRegisteredOwner`, which additionally demands `fleet-manager` because it
 * guards driver management; an owner-operator has no fleet to manage but is still the owner of the
 * account. The only thing excluded here is a driver.
 */
export async function requireRegisteredOwnerUser(
  initData: string,
  capabilityOrOpts: MiniAppCapability | MiniAppAuthOpts = 'financial:read',
  maybeOpts: MiniAppAuthOpts = {},
): Promise<{ registration: MiniAppActorRegistration; carrierId: string }> {
  const capability =
    typeof capabilityOrOpts === 'string' ? capabilityOrOpts : 'financial:read';
  const opts = typeof capabilityOrOpts === 'string' ? maybeOpts : capabilityOrOpts;
  const { registration } = await requireRegisteredMiniAppUser(initData, opts);
  if (!isOwnerOrSalesAgent(registration.profile) || !registration.carrierId) {
    throw new AppError('This view is only available to the company owner', {
      statusCode: 403,
      code: 'NOT_A_REGISTERED_OWNER_USER',
      expose: true,
    });
  }
  assertMiniAppCapability(registration.profile, capability);
  return { registration, carrierId: registration.carrierId };
}

/**
 * The driver's own card number — the scope key for every row-level driver filter.
 *
 * FAIL-CLOSED BY DESIGN: resolveDriverCardNumber is best-effort and returns null when the DWH is
 * unconfigured/down or the card is gone. Every other caller treats that null as "degrade to the
 * masked cardId", but here a null must NEVER fall through to the carrier-wide rows — that is
 * exactly the leak this scoping exists to prevent. So: no card number → no data, 503.
 */
export async function requireDriverCardNumber(registration: MiniAppActorRegistration): Promise<string> {
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

/**
 * The driver's real fuel-card number (octane.stg_cmp_card.card_number), looked up by cardId from the
 * DWH replica — the mini-app session only carries cardId, so this is what lets the driver hero show
 * the real PAN instead of a fabricated one. Best-effort: null (not an error) if the DWH is
 * unconfigured, the lookup fails, or no card matches — the UI falls back to the masked cardId.
 */
export async function resolveDriverCardNumber(carrierId: string | null, cardId: string | null): Promise<string | null> {
  if (!carrierId || !cardId || !env.DWH_DATABASE_URL) return null;
  try {
    // ANY-status lookup (not active-only): the card number is used to SCOPE the driver's own reads
    // (transactions, last-used, status). A deactivated/inactive card must still resolve so the driver
    // keeps seeing THEIR history — item: "show all transactions regardless of Active/Inactive." Still
    // their own cardId (from registration), so no cross-card leak; write gates enforce status
    // separately (override checks fraud-hold live via servercrm).
    return (await findDwhCardByIdAnyStatus(carrierId, cardId))?.cardNumber ?? null;
  } catch {
    return null;
  }
}

/**
 * The carrier's company name from the DWH — used to fill a driver registration's card label when the
 * invite didn't capture a companyName (older invites). Best-effort, never blocks.
 */
export async function resolveCarrierCompanyName(carrierId: string | null): Promise<string | null> {
  if (!carrierId || !env.DWH_DATABASE_URL) return null;
  try {
    const operators = await searchDwhOperators({ q: carrierId, limit: 10 });
    return operators.find((o) => o.carrierId === carrierId)?.companyName ?? null;
  } catch {
    return null;
  }
}

/** DWH-resolved extras for a DRIVER registration (real card number + company name fallback). */
export async function resolveDriverExtras(
  reg: Pick<MiniAppActorRegistration, 'profile' | 'carrierId' | 'cardId' | 'companyName'>,
): Promise<{ cardNumber: string | null; companyName?: string }> {
  if (reg.profile !== 'driver') return { cardNumber: null };
  const [cardNumber, resolvedCompany] = await Promise.all([
    resolveDriverCardNumber(reg.carrierId, reg.cardId),
    reg.companyName ? Promise.resolve(reg.companyName) : resolveCarrierCompanyName(reg.carrierId),
  ]);
  return { cardNumber, ...(resolvedCompany ? { companyName: resolvedCompany } : {}) };
}

export function toRegistrationView(row: {
  id: string;
  profile: MiniAppActorProfile;
  companyName: string | null;
  carrierId: string | null;
  companyType: 'owner-operator' | 'fleet-manager' | null;
  cardCount: number | null;
  cardId: string | null;
  agentName: string | null;
  cardNumber?: string | null;
  authMode?: 'password' | 'telegram' | null;
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
    authMode: row.authMode === 'password' ? ('password' as const) : ('telegram' as const),
  };
}
