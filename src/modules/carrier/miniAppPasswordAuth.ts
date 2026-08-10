/**
 * Mini-app password auth — invite verifies company/manager/driver; password unlocks a 1-day Bearer.
 * Telegram shell still proves which person is at the device; the password is what opens the session.
 */
import { AppError, AuthError, ConflictError } from '../../lib/errors.js';
import type { CarrierUser, RegisteredMiniAppCompany } from '../../db/schema/index.js';
import { carrierUserRepo } from '../../repos/carrierUserRepo.js';
import { registeredMiniAppCompanyRepo } from '../../repos/registeredMiniAppCompanyRepo.js';
import { miniAppPasswordResetRepo } from '../../repos/miniAppPasswordResetRepo.js';
import { salesAgentMiniAppRepo } from '../../repos/salesAgentMiniAppRepo.js';
import { createInboxMessage } from '../inbox/service.js';
import { sendPlainReply } from '../../integrations/telegramCarrierBot.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signAccessToken, type ClientIdentity, type TokenClaims } from '../auth/jwt.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { lookupCtx } from './miniAppAuth.js';

/** Client access tokens live one day — re-login after expiry (no refresh for mini-app clients). */
export const MINI_APP_ACCESS_TTL = '1d';

export interface LoginHints {
  profile: 'owner' | 'manager' | 'driver';
  /** Display label on set-password / login — company name for every profile. */
  primaryLabel: string;
  /** Driver only: last 6 digits of the card number (login key; still shown read-only). */
  cardLast6: string | null;
  companyName: string | null;
  hasPassword: boolean;
}

/** Normalize a human login key — case-insensitive, collapsed whitespace. */
export function normalizeLogin(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function cardLast6(cardId: string | null | undefined): string | null {
  if (!cardId) return null;
  const digits = cardId.replace(/\D/g, '');
  if (digits.length < 6) return digits || null;
  return digits.slice(-6);
}

export function loginForRegistration(reg: {
  profile: 'owner' | 'manager' | 'driver';
  companyName: string | null;
  driverName: string | null;
  cardId: string | null;
}): string {
  if (reg.profile === 'owner') {
    const company = reg.companyName?.trim();
    if (!company) {
      throw new AppError('Owner login needs a company name', {
        statusCode: 400,
        code: 'LOGIN_NEEDS_COMPANY',
        expose: true,
      });
    }
    return normalizeLogin(company);
  }
  if (reg.profile === 'manager') {
    const name = reg.driverName?.trim();
    if (!name) {
      throw new AppError('Manager login needs a manager name', {
        statusCode: 400,
        code: 'LOGIN_NEEDS_MANAGER_NAME',
        expose: true,
      });
    }
    return normalizeLogin(name);
  }
  const last6 = cardLast6(reg.cardId);
  if (!last6) {
    throw new AppError('Driver login needs a card number', {
      statusCode: 400,
      code: 'LOGIN_NEEDS_CARD',
      expose: true,
    });
  }
  return normalizeLogin(last6);
}

export function loginHintsFor(
  reg: Pick<RegisteredMiniAppCompany, 'profile' | 'companyName' | 'driverName' | 'cardId'>,
  hasPassword: boolean,
): LoginHints {
  const profile = reg.profile;
  const company = reg.companyName?.trim() || 'Company';
  // UI shows company for owner / manager / driver. Login keys stay profile-specific
  // (company name / manager name / card last 6) via loginForRegistration.
  if (profile === 'owner' || profile === 'manager') {
    return {
      profile,
      primaryLabel: company,
      cardLast6: null,
      companyName: reg.companyName,
      hasPassword,
    };
  }
  return {
    profile,
    primaryLabel: company,
    cardLast6: cardLast6(reg.cardId),
    companyName: reg.companyName,
    hasPassword,
  };
}

/**
 * Manager login uniqueness at invite time. Blocks active password accounts and active
 * manager registrations. A pending invite for the same name is NOT a conflict — invite
 * creation supersedes it (cancel old, mint new) so Sales can regenerate a link.
 */
export async function assertLoginAvailable(
  ctx: TenantContext,
  login: string,
  opts?: { exceptRegistrationId?: string },
): Promise<void> {
  const normalized = normalizeLogin(login);
  if (!normalized) {
    throw new AppError('Name is required', { statusCode: 400, code: 'LOGIN_EMPTY', expose: true });
  }
  if (await carrierUserRepo.loginTaken(ctx, normalized)) {
    throw new ConflictError('That name is already in use — pick a different manager name');
  }
  const registered = await registeredMiniAppCompanyRepo.findActiveManagerByLogin(
    ctx,
    normalized,
    opts?.exceptRegistrationId,
  );
  if (registered) {
    throw new ConflictError('That manager name is already registered');
  }
}

export async function assertOwnerCompanyLoginAvailable(
  ctx: TenantContext,
  companyName: string,
): Promise<void> {
  const login = normalizeLogin(companyName);
  if (await carrierUserRepo.loginTaken(ctx, login)) {
    throw new ConflictError('A login for this company name already exists');
  }
}

function clientClaims(user: CarrierUser): TokenClaims {
  // Managers share owner-equivalent fleet access in JWT RBAC.
  const clientProfile = user.profile === 'driver' ? 'driver' : 'owner';
  const client: ClientIdentity = {
    carrierUserId: user.id,
    clientProfile,
    ...(user.carrierId ? { carrierId: user.carrierId } : {}),
    ...(user.applicationId ? { applicationId: user.applicationId } : {}),
    ...(user.cardId ? { cardId: user.cardId } : {}),
    ...(user.parentUserId ? { parentUserId: user.parentUserId } : {}),
    login: user.login,
  };
  return {
    userId: `client:${user.id}`,
    tenantId: user.tenantId,
    audience: 'customer',
    role: 'viewer',
    client,
  };
}

export async function issueMiniAppClientToken(user: CarrierUser): Promise<{
  accessToken: string;
  expiresIn: string;
  tokenType: 'Bearer';
}> {
  const accessToken = await signAccessToken(clientClaims(user), MINI_APP_ACCESS_TTL);
  return { accessToken, expiresIn: MINI_APP_ACCESS_TTL, tokenType: 'Bearer' };
}

/** Keep light for carrier operators on Telegram — complexity rules live elsewhere if needed later. */
const MIN_PASSWORD_LEN = 4;

export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LEN) {
    throw new AppError(`Password must be at least ${MIN_PASSWORD_LEN} characters`, {
      statusCode: 400,
      code: 'PASSWORD_TOO_SHORT',
      expose: true,
    });
  }
  if (password.length > 200) {
    throw new AppError('Password is too long', {
      statusCode: 400,
      code: 'PASSWORD_TOO_LONG',
      expose: true,
    });
  }
}

export async function setPasswordForRegistration(
  reg: RegisteredMiniAppCompany,
  password: string,
): Promise<{ user: CarrierUser; tokens: Awaited<ReturnType<typeof issueMiniAppClientToken>> }> {
  assertPasswordPolicy(password);
  const ctx = lookupCtx();
  const login = loginForRegistration(reg);
  if (reg.profile === 'manager' || reg.profile === 'owner') {
    // Include disabled rows so re-invite after Remove can reuse / rename without false conflicts.
    const existing = await carrierUserRepo.findAnyByTelegramUserId(ctx, reg.telegramUserId);
    if (!existing || existing.login !== login) {
      if (await carrierUserRepo.loginTaken(ctx, login, existing?.id)) {
        throw new ConflictError('That login name is already in use');
      }
    }
  }
  const passwordHash = await hashPassword(password);
  const user = await carrierUserRepo.upsertForTelegram(ctx, {
    profile: reg.profile,
    login,
    passwordHash,
    ...(reg.carrierId ? { carrierId: reg.carrierId } : {}),
    ...(reg.applicationId ? { applicationId: reg.applicationId } : {}),
    ...(reg.cardId ? { cardId: reg.cardId } : {}),
    ...(reg.companyName ? { companyName: reg.companyName } : {}),
    registrationId: reg.id,
    telegramUserId: reg.telegramUserId,
    ...(reg.agentName ? { agentName: reg.agentName } : {}),
    ...(reg.agentZohoUserId ? { agentZohoUserId: reg.agentZohoUserId } : {}),
  });
  await carrierUserRepo.touchLastLogin(ctx, user.id);
  const tokens = await issueMiniAppClientToken(user);
  return { user, tokens };
}

export async function loginWithPassword(
  reg: RegisteredMiniAppCompany,
  password: string,
): Promise<{ user: CarrierUser; tokens: Awaited<ReturnType<typeof issueMiniAppClientToken>> }> {
  const ctx = lookupCtx();
  const user = await carrierUserRepo.findByTelegramUserId(ctx, reg.telegramUserId);
  if (!user || user.status !== 'active') {
    throw new AuthError('Set a password first — open your registration link again');
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new AuthError('Incorrect password');
  await carrierUserRepo.touchLastLogin(ctx, user.id);
  return { user, tokens: await issueMiniAppClientToken(user) };
}

export async function updateOwnPassword(
  user: CarrierUser,
  currentPassword: string,
  nextPassword: string,
): Promise<void> {
  assertPasswordPolicy(nextPassword);
  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) throw new AuthError('Current password is incorrect');
  const passwordHash = await hashPassword(nextPassword);
  await carrierUserRepo.updatePasswordHash(lookupCtx(), user.id, passwordHash);
}

export async function salesSetPassword(
  ctx: TenantContext,
  carrierUserId: string,
  nextPassword: string,
  resetRequestId?: string,
): Promise<void> {
  assertPasswordPolicy(nextPassword);
  const user = await carrierUserRepo.findById(ctx, carrierUserId);
  if (!user || user.status !== 'active') {
    throw new AppError('User not found', { statusCode: 404, code: 'USER_NOT_FOUND', expose: true });
  }
  const passwordHash = await hashPassword(nextPassword);
  await carrierUserRepo.updatePasswordHash(ctx, user.id, passwordHash);
  if (resetRequestId) {
    const zoho = ctx.userId.startsWith('zoho:') ? ctx.userId.slice('zoho:'.length) : ctx.userId;
    await miniAppPasswordResetRepo.resolve(ctx, resetRequestId, zoho);
  }
}

/**
 * Forget-password: queue for Sales Manage + Sales Inbox + Telegram DM to the agent (when bound).
 */
export async function requestPasswordReset(
  reg: RegisteredMiniAppCompany,
  note?: string,
): Promise<{ resetId: string }> {
  const ctx = lookupCtx();
  const user = await carrierUserRepo.findByTelegramUserId(ctx, reg.telegramUserId);
  if (!user) {
    throw new AppError('No password account yet — finish registration first', {
      statusCode: 400,
      code: 'NO_PASSWORD_ACCOUNT',
      expose: true,
    });
  }
  const existing = await miniAppPasswordResetRepo.findPendingByCarrierUser(ctx, user.id);
  if (existing) return { resetId: existing.id };

  const reset = await miniAppPasswordResetRepo.create(ctx, {
    carrierUserId: user.id,
    registrationId: reg.id,
    carrierId: reg.carrierId,
    companyName: reg.companyName,
    login: user.login,
    profile: reg.profile,
    agentZohoUserId: reg.agentZohoUserId,
    agentName: reg.agentName,
    note: note?.trim() || null,
  });

  const subject = `Password reset requested — ${reg.companyName ?? user.login}`;
  const content = [
    `${reg.profile} "${user.login}" asked to reset their mini-app password.`,
    reg.companyName ? `Company: ${reg.companyName}` : null,
    reg.carrierId ? `Carrier: ${reg.carrierId}` : null,
    note?.trim() ? `Note: ${note.trim()}` : null,
    'Open Data Center → Clients → Manage → Pending password resets to set a new password.',
  ]
    .filter(Boolean)
    .join('\n');

  if (reg.agentZohoUserId) {
    try {
      await createInboxMessage(ctx, {
        ownerZohoUserId: reg.agentZohoUserId,
        subject,
        content,
        type: 'Task',
        priority: 'high',
        tag: 'mini-app-password-reset',
        name: reg.companyName ?? user.login,
        ownerName: reg.agentName,
      });
    } catch {
      /* inbox must not block the client request */
    }

    try {
      const principal = await salesAgentMiniAppRepo.findPrincipalByZohoUserId(
        ctx,
        reg.agentZohoUserId,
      );
      if (principal?.telegramUserId && principal.status === 'active') {
        await sendPlainReply(
          principal.telegramUserId,
          `🔐 ${subject}\n\n${content}`,
        );
      }
    } catch {
      /* agent may never have started the bot */
    }
  }

  return { resetId: reset.id };
}
