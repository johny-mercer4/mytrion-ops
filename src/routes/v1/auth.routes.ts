import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { audit } from '../../modules/audit/auditLogger.js';
import { authService, toPublicUser } from '../../modules/auth/authService.js';
import { clientAuthService } from '../../modules/auth/clientAuthService.js';
import { zohoAuthService } from '../../modules/auth/zohoAuthService.js';
import { userRepo } from '../../repos/userRepo.js';
import { requireContext } from './helpers.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(100).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

const clientLoginSchema = z.object({
  login: z.string().min(1).max(120),
  password: z.string().min(1).max(200),
});

const zohoCallbackSchema = z.object({
  code: z.string().min(1).max(2000),
  state: z.string().min(1).max(4000),
});

function requireZohoOauth(): void {
  if (!env.FF_ZOHO_OAUTH_ENABLED) {
    throw new AppError('Zoho OAuth login is disabled (set FF_ZOHO_OAUTH_ENABLED).', {
      statusCode: 503,
      code: 'FEATURE_DISABLED',
    });
  }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (request) => {
    const body = loginSchema.parse(request.body);
    const tenantId = body.tenantId ?? DEFAULT_TENANT_ID;
    try {
      const result = await authService.login(body.email, body.password, tenantId);
      await audit({
        tenantId: result.user.tenantId,
        audience: result.user.audience,
        userId: result.user.id,
        userName: result.user.fullName ?? result.user.email,
        role: result.user.role,
        action: 'auth.login',
        status: 'ok',
        requestId: request.requestId,
        ip: request.ip,
      });
      return result;
    } catch (err) {
      await audit({
        tenantId,
        action: 'auth.login',
        status: 'denied',
        requestId: request.requestId,
        ip: request.ip,
        detail: { email: body.email },
      });
      throw err;
    }
  });

  app.post('/auth/refresh', async (request) => {
    const body = refreshSchema.parse(request.body);
    return authService.refresh(body.refreshToken);
  });

  // ── Carrier-client sign-in (carrier_users accounts; Telegram mini-app / the /client page) ────
  app.post('/auth/client/login', async (request) => {
    if (!env.FF_CLIENT_LOGIN_ENABLED) {
      throw new AppError('Client login is disabled (set FF_CLIENT_LOGIN_ENABLED).', {
        statusCode: 503,
        code: 'FEATURE_DISABLED',
      });
    }
    const body = clientLoginSchema.parse(request.body);
    try {
      const result = await clientAuthService.login(body.login, body.password);
      await audit({
        tenantId: DEFAULT_TENANT_ID,
        audience: 'customer',
        userId: `client:${result.client.carrierUserId}`,
        userName: result.client.login ?? body.login,
        role: 'viewer',
        company: [result.client.carrierId, result.client.applicationId]
          .filter(Boolean)
          .join(', '),
        profile: result.client.clientProfile === 'driver' ? 'Driver' : 'Owner',
        action: 'auth.client_login',
        status: 'ok',
        requestId: request.requestId,
        ip: request.ip,
        detail: { carrierId: result.client.carrierId },
      });
      return result;
    } catch (err) {
      await audit({
        tenantId: DEFAULT_TENANT_ID,
        action: 'auth.client_login',
        status: 'denied',
        requestId: request.requestId,
        ip: request.ip,
        detail: { login: body.login },
      });
      throw err;
    }
  });

  // ── Zoho OAuth worker sign-in (authorization-code) ───────────────────────────────────────────
  // Step 1: the SPA fetches the authorize URL + state, stashes state, and redirects the browser.
  app.get('/auth/zoho/login', async () => {
    requireZohoOauth();
    return zohoAuthService.startLogin();
  });

  // Step 2: Zoho redirects back to the SPA with ?code&state; the SPA relays them here. We verify
  // state, exchange the code, read the worker's Zoho identity, and return a Bearer session.
  app.post('/auth/zoho/callback', async (request) => {
    requireZohoOauth();
    const body = zohoCallbackSchema.parse(request.body);
    try {
      const session = await zohoAuthService.completeLogin(body.code, body.state);
      await audit({
        tenantId: DEFAULT_TENANT_ID,
        audience: 'internal',
        userId: `zoho:${session.worker.zohoUserId}`,
        ...(session.worker.userName ? { userName: session.worker.userName } : {}),
        ...(session.worker.profile ? { profile: session.worker.profile } : {}),
        ...(session.worker.role ? { callerRole: session.worker.role } : {}),
        action: 'auth.zoho.login',
        status: 'ok',
        requestId: request.requestId,
        ip: request.ip,
        detail: { profile: session.worker.profile, role: session.worker.role },
      });
      return session;
    } catch (err) {
      await audit({
        tenantId: DEFAULT_TENANT_ID,
        action: 'auth.zoho.login',
        status: 'denied',
        requestId: request.requestId,
        ip: request.ip,
      });
      throw err;
    }
  });

  // Current identity for a session. Worker (Zoho) sessions return the verified Zoho identity from
  // the context; the dormant email/password path returns the users-table record.
  app.get('/auth/me', { onRequest: [app.authenticate] }, async (request) => {
    const ctx = requireContext(request);
    if (ctx.sessionVerified) {
      return {
        worker: {
          zohoUserId: ctx.userId.replace(/^zoho:/, ''),
          userName: ctx.userName ?? null,
          profile: ctx.profiles?.[0] ?? null,
          role: ctx.callerRole ?? null,
          allDepartmentAccess: ctx.allDepartmentAccess,
        },
      };
    }
    const user = await userRepo.findById(ctx, ctx.userId);
    if (!user) throw new NotFoundError('User not found');
    return { user: toPublicUser(user) };
  });
}
