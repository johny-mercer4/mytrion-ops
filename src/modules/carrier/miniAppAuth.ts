/**
 * Shared auth/scoping helpers for the Telegram carrier mini-app routes.
 *
 * Extracted verbatim from routes/v1/carrierMiniApp.routes.ts so the write-action routes
 * (carrierMiniAppActions.routes.ts) reuse the SAME gates instead of re-implementing them —
 * the security boundary (Telegram initData HMAC → registration lookup → role check) must
 * exist in exactly one place.
 */
import { createId } from '@paralleldrive/cuid2';
import { AppError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import { findDwhCardById } from '../../integrations/dwhCards.js';
import { searchDwhOperators } from '../../integrations/dwhOperators.js';
import { registeredMiniAppCompanyRepo } from '../../repos/registeredMiniAppCompanyRepo.js';
import {
  parseInitDataUser,
  verifyTelegramInitData,
  type TelegramWebAppUser,
} from '../../integrations/telegramCarrierBot.js';
import type { RegisteredMiniAppCompany } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';

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

/** The actual actor once a Telegram user is verified — customer audience, deny-by-default. */
export function telegramCtx(profile: 'owner' | 'driver', telegramUserId: string): TenantContext {
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
 * Resolve the current Telegram user to an existing mini-app registration. This is the returning
 * user's login path once onboarding is complete: Telegram proves identity; no password is involved.
 */
export async function requireRegisteredMiniAppUser(
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
export async function requireRegisteredOwner(
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
export async function requireRegisteredCarrierUser(
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
 * account. The only thing excluded here is a driver.
 */
export async function requireRegisteredOwnerUser(
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
 * The driver's own card number — the scope key for every row-level driver filter.
 *
 * FAIL-CLOSED BY DESIGN: resolveDriverCardNumber is best-effort and returns null when the DWH is
 * unconfigured/down or the card is gone. Every other caller treats that null as "degrade to the
 * masked cardId", but here a null must NEVER fall through to the carrier-wide rows — that is
 * exactly the leak this scoping exists to prevent. So: no card number → no data, 503.
 */
export async function requireDriverCardNumber(registration: RegisteredMiniAppCompany): Promise<string> {
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
    // Exact lookup — listDwhCards caps at 100 while real carriers run to 510 active cards, so a
    // membership scan over the listing would miss cards that sort past the cap.
    return (await findDwhCardById(carrierId, cardId))?.cardNumber ?? null;
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
  reg: Pick<RegisteredMiniAppCompany, 'profile' | 'carrierId' | 'cardId' | 'companyName'>,
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
