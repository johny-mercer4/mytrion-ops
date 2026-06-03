import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthError } from '../lib/errors.js';
import { authService } from '../modules/auth/authService.js';
import { setCurrentContext } from './requestContext.js';

/**
 * Decorates `app.authenticate`, an onRequest/preHandler guard that verifies the
 * Bearer access token and attaches the derived TenantContext to request.ctx.
 */
export function authPlugin(app: FastifyInstance): void {
  app.decorate(
    'authenticate',
    async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
      const header = request.headers.authorization;
      if (!header || !header.startsWith('Bearer ')) {
        throw new AuthError('Missing or malformed Authorization header');
      }
      const token = header.slice('Bearer '.length).trim();
      if (!token) throw new AuthError('Empty bearer token');

      const ctx = await authService.contextFromAccessToken(token, request.requestId);
      request.ctx = ctx;
      setCurrentContext(ctx);
    },
  );
}
