import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { AuthError, RBACError } from '../lib/errors.js';
import { hasScope } from '../modules/auth/permissions.js';
import type { Audience, Role } from '../types/tenantContext.js';

function requireCtx(request: FastifyRequest) {
  const ctx = request.ctx;
  if (!ctx) throw new AuthError('Authentication required');
  return ctx;
}

/**
 * Route guards built on top of `authenticate`. Compose like:
 *   { onRequest: [app.authenticate], preHandler: [app.requireRole('admin')] }
 */
export function rbacPlugin(app: FastifyInstance): void {
  app.decorate('requireRole', (...roles: Role[]): preHandlerHookHandler => {
    return async (request) => {
      const ctx = requireCtx(request);
      if (!roles.includes(ctx.role)) {
        throw new RBACError(`Requires one of role(s): ${roles.join(', ')}`);
      }
    };
  });

  app.decorate('requireScope', (scope: string): preHandlerHookHandler => {
    return async (request) => {
      const ctx = requireCtx(request);
      if (!hasScope(ctx.scopes, scope)) {
        throw new RBACError(`Missing required scope: ${scope}`);
      }
    };
  });

  app.decorate('requireAudience', (...audiences: Audience[]): preHandlerHookHandler => {
    return async (request) => {
      const ctx = requireCtx(request);
      if (!audiences.includes(ctx.audience)) {
        throw new RBACError(`Not permitted for audience: ${ctx.audience}`);
      }
    };
  });
}
