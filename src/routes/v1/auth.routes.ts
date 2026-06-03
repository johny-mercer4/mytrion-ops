import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import { NotFoundError } from '../../lib/errors.js';
import { audit } from '../../modules/audit/auditLogger.js';
import { authService, toPublicUser } from '../../modules/auth/authService.js';
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

  app.get('/auth/me', { onRequest: [app.authenticate] }, async (request) => {
    const ctx = requireContext(request);
    const user = await userRepo.findById(ctx, ctx.userId);
    if (!user) throw new NotFoundError('User not found');
    return { user: toPublicUser(user) };
  });
}
