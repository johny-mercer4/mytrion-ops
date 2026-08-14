/**
 * Mini-app password auth routes — set password after invite, daily login, update/forgot password.
 * Telegram initData still identifies the person; the password mints a 1-day Bearer.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import type { RegisteredMiniAppCompany } from '../../db/schema/index.js';
import {
  accessTokenFromAuthHeader,
  lookupCtx,
  requireRegisteredMiniAppUser,
  toRegistrationView,
  verifyTelegramUser,
  type MiniAppActorRegistration,
} from '../../modules/carrier/miniAppAuth.js';
import { auditMiniAppLogin } from '../../modules/carrier/miniAppLoginAudit.js';
import {
  loginHintsFor,
  loginWithPassword,
  requestPasswordReset,
  salesSetPassword,
  setPasswordForRegistration,
  updateOwnPassword,
} from '../../modules/carrier/miniAppPasswordAuth.js';
import { carrierUserRepo } from '../../repos/carrierUserRepo.js';
import { registeredMiniAppCompanyRepo } from '../../repos/registeredMiniAppCompanyRepo.js';
import { miniAppPasswordResetRepo } from '../../repos/miniAppPasswordResetRepo.js';
import { assertCarrierOwned } from '../../modules/tools/serverCrmScope.js';
import { NotFoundError, RBACError } from '../../lib/errors.js';
import { requireDepartment, requireMytrionWrite } from './helpers.js';
import { buildCallerContext } from './callerIdentity.js';

function asCustomerRegistration(registration: MiniAppActorRegistration): RegisteredMiniAppCompany {
  if (registration.profile === 'sales_agent') {
    throw new RBACError('Sales agents do not use password login');
  }
  return registration as RegisteredMiniAppCompany;
}

const initDataBody = z.object({
  initData: z.string().min(1),
});

const passwordBody = initDataBody.extend({
  password: z.string().min(1).max(200),
});

const updatePasswordBody = initDataBody.extend({
  currentPassword: z.string().min(1).max(200),
  nextPassword: z.string().min(1).max(200),
});

const forgotBody = initDataBody.extend({
  note: z.string().max(500).optional(),
});

export async function carrierMiniAppAuthRoutes(app: FastifyInstance): Promise<void> {
  const salesGuard = { onRequest: [app.sessionOrApiKey] };

  /** Bootstrap: set-password, login, authenticated, revoked, or unregistered.
   * `unregistered` is ONLY for Telegram accounts that never redeemed an invite — that is the
   * sole case that may show the Driver/Company chooser. Anyone who already verified via invite
   * must never fall back to that first-time screen (revoked → explicit revoked status). */
  app.post('/carrier/mini-app/auth/state', async (request) => {
    const body = initDataBody.parse(request.body);
    const { telegramUserId } = verifyTelegramUser(body.initData);
    const ctx = lookupCtx();
    const registration = await registeredMiniAppCompanyRepo.findByTelegramUserId(ctx, telegramUserId);
    if (!registration) {
      return { status: 'unregistered' as const };
    }
    const passwordUser = await carrierUserRepo.findByTelegramUserId(ctx, telegramUserId);
    const hints = loginHintsFor(registration, Boolean(passwordUser));
    const view = toRegistrationView(registration);
    if (registration.status !== 'active') {
      return {
        status: 'revoked' as const,
        authMode: registration.authMode === 'password' ? ('password' as const) : ('telegram' as const),
        registration: view,
        loginHints: hints,
      };
    }
    // Legacy telegram-mode: initData is enough — never force password.
    if (registration.authMode !== 'password') {
      // THE carrier sign-in event for these accounts: they never hit /auth/login, so this bootstrap
      // resolving to `authenticated` is the only moment "this carrier logged in" is observable.
      await auditMiniAppLogin(registration, telegramUserId, 'telegram');
      return {
        status: 'authenticated' as const,
        authMode: 'telegram' as const,
        registration: view,
        loginHints: hints,
      };
    }
    if (!passwordUser) {
      return {
        status: 'needs_password' as const,
        authMode: 'password' as const,
        registration: view,
        loginHints: hints,
      };
    }
    const token = accessTokenFromAuthHeader(request.headers.authorization);
    if (token) {
      try {
        await requireRegisteredMiniAppUser(body.initData, { accessToken: token });
        // A live password session resuming still counts as "this carrier is in the app now".
        await auditMiniAppLogin(registration, telegramUserId, 'password');
        return {
          status: 'authenticated' as const,
          authMode: 'password' as const,
          registration: view,
          loginHints: hints,
        };
      } catch {
        /* fall through */
      }
    }
    return {
      status: 'needs_login' as const,
      authMode: 'password' as const,
      registration: view,
      loginHints: hints,
    };
  });

  app.post('/carrier/mini-app/auth/set-password', async (request, reply) => {
    const body = passwordBody.parse(request.body);
    const { registration: actor, ctx } = await requireRegisteredMiniAppUser(body.initData, {
      allowWithoutPasswordSession: true,
    });
    const registration = asCustomerRegistration(actor);
    const { tokens } = await setPasswordForRegistration(registration, body.password);
    await auditFromContext(ctx, {
      action: 'mini_app.auth.set_password',
      status: 'ok',
      resourceType: 'registered_mini_app_company',
      resourceId: registration.id,
      detail: { profile: registration.profile },
    });
    return reply.code(201).send({
      ...tokens,
      registration: toRegistrationView(registration),
      loginHints: loginHintsFor(registration, true),
    });
  });

  app.post('/carrier/mini-app/auth/login', async (request) => {
    const body = passwordBody.parse(request.body);
    const { registration: actor, ctx } = await requireRegisteredMiniAppUser(body.initData, {
      allowWithoutPasswordSession: true,
    });
    const registration = asCustomerRegistration(actor);
    const { tokens } = await loginWithPassword(registration, body.password);
    // Same action as the telegram-mode bootstrap so the Logins view is ONE list of carrier
    // sign-ins; `detail.method` distinguishes them. Never collapsed — this is an explicit act.
    await auditMiniAppLogin(registration, registration.telegramUserId, 'password', {
      collapse: false,
    });
    return {
      ...tokens,
      registration: toRegistrationView(registration),
      loginHints: loginHintsFor(registration, true),
    };
  });

  app.post('/carrier/mini-app/auth/logout', async (request) => {
    const body = initDataBody.parse(request.body);
    const { registration, ctx } = await requireRegisteredMiniAppUser(body.initData, {
      allowWithoutPasswordSession: true,
    });
    await auditFromContext(ctx, {
      action: 'mini_app.auth.logout',
      status: 'ok',
      resourceType: 'registered_mini_app_company',
      resourceId: registration.id,
    });
    return { ok: true };
  });

  app.post('/carrier/mini-app/auth/update-password', async (request) => {
    const body = updatePasswordBody.parse(request.body);
    const rawAuth = request.headers.authorization;
    const token = accessTokenFromAuthHeader(typeof rawAuth === 'string' ? rawAuth : undefined);
    const { ctx, telegramUserId } = await requireRegisteredMiniAppUser(body.initData, {
      accessToken: token,
    });
    const user = await carrierUserRepo.findByTelegramUserId(lookupCtx(), telegramUserId);
    if (!user) throw new NotFoundError('No password account');
    await updateOwnPassword(user, body.currentPassword, body.nextPassword);
    await auditFromContext(ctx, {
      action: 'mini_app.auth.update_password',
      status: 'ok',
      resourceType: 'carrier_user',
      resourceId: user.id,
    });
    return { ok: true };
  });

  app.post('/carrier/mini-app/auth/forgot-password', async (request, reply) => {
    const body = forgotBody.parse(request.body);
    const { registration: actor, ctx } = await requireRegisteredMiniAppUser(body.initData, {
      allowWithoutPasswordSession: true,
    });
    const registration = asCustomerRegistration(actor);
    const { resetId } = await requestPasswordReset(registration, body.note);
    await auditFromContext(ctx, {
      action: 'mini_app.auth.forgot_password',
      status: 'ok',
      resourceType: 'mini_app_password_reset',
      resourceId: resetId,
    });
    return reply.code(201).send({
      ok: true,
      resetId,
      message: 'Your sales rep has been notified. They will set a new password for you.',
    });
  });

  app.get('/carrier/mini-app/password-resets', salesGuard, async (request) => {
    request.ctx = await buildCallerContext(request, {});
    const ctx = requireDepartment(request, 'sales', 'Mini-app password resets');
    const q = z.object({ carrier_id: z.string().min(1).optional() }).parse(request.query ?? {});
    if (q.carrier_id) {
      if (ctx.role !== 'admin') await assertCarrierOwned(ctx, q.carrier_id);
      return { resets: await miniAppPasswordResetRepo.listPendingForCarrier(ctx, q.carrier_id) };
    }
    // Admin Carrier User Management sees the full tenant queue; agents see only their clients.
    if (ctx.role === 'admin') {
      return { resets: await miniAppPasswordResetRepo.listPending(ctx) };
    }
    const zoho = ctx.userId.startsWith('zoho:') ? ctx.userId.slice('zoho:'.length) : null;
    if (!zoho) return { resets: [] };
    return { resets: await miniAppPasswordResetRepo.listPendingForAgent(ctx, zoho) };
  });

  app.post('/carrier/mini-app/password-resets/:id/resolve', salesGuard, async (request) => {
    request.ctx = await buildCallerContext(request, {});
    const ctx = requireMytrionWrite(request, 'sales', 'Mini-app password reset');
    const { id } = request.params as { id: string };
    const body = z.object({ password: z.string().min(1).max(200) }).parse(request.body);
    const reset = await miniAppPasswordResetRepo.findById(ctx, id);
    if (!reset || reset.status !== 'pending') throw new NotFoundError('Reset request not found');
    if (reset.carrierId && ctx.role !== 'admin') await assertCarrierOwned(ctx, reset.carrierId);
    await salesSetPassword(ctx, reset.carrierUserId, body.password, reset.id);
    await auditFromContext(ctx, {
      action: 'sales.mini_app.password_reset.resolve',
      status: 'ok',
      resourceType: 'mini_app_password_reset',
      resourceId: id,
    });
    return { ok: true };
  });
}
