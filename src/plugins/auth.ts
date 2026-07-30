import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env, isDev } from '../config/env.js';
import { safeEqual } from '../lib/crypto.js';
import { AuthError } from '../lib/errors.js';
import { authService, systemContext } from '../modules/auth/authService.js';
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
        // The local Vite dev mock deliberately has no OAuth session and sends the configured
        // x-api-key instead. Keep that escape hatch development-only; production HR routes remain
        // Bearer-session-only.
        const devKey = request.headers['x-api-key'];
        if (
          isDev &&
          env.API_KEY &&
          typeof devKey === 'string' &&
          safeEqual(devKey, env.API_KEY)
        ) {
          const ctx = systemContext(request.requestId);
          request.ctx = ctx;
          setCurrentContext(ctx);
          return;
        }
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
