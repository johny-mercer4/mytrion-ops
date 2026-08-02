import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env, isProduction } from '../config/env.js';
import { safeEqual } from '../lib/crypto.js';
import { AppError, AuthError, RBACError } from '../lib/errors.js';
import { systemContext } from '../modules/auth/authService.js';
import { takeToken } from '../modules/security/rateBucket.js';
import { setCurrentContext } from './requestContext.js';

function requestKey(request: FastifyRequest): string | null {
  const value = request.headers['x-support-bot-key'];
  if (typeof value === 'string' && value.length > 0) return value;
  // Local rolling-upgrade compatibility for an already-running gateway process. Production never
  // accepts the broad bearer API_KEY on these routes.
  const authorization = request.headers.authorization;
  if (!isProduction && !env.SUPPORT_BOT_GATEWAY_API_KEY && authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim() || null;
  }
  return null;
}

function configuredKey(): string {
  // Keep local gateways working while developers roll the new variable out. Production never
  // falls back because API_KEY grants a much wider machine identity.
  return env.SUPPORT_BOT_GATEWAY_API_KEY || (!isProduction ? env.API_KEY : '');
}

/** A credential scoped to the Telegram gateway routes; it is never accepted by apiKeyAuth. */
export function supportBotGatewayAuthPlugin(app: FastifyInstance): void {
  app.decorate(
    'supportBotGatewayAuth',
    async function supportBotGatewayAuth(
      request: FastifyRequest,
      _reply: FastifyReply,
    ): Promise<void> {
      const expected = configuredKey();
      if (!expected) {
        throw new AppError('Support-bot gateway key is not configured', {
          statusCode: 503,
          code: 'SERVER_MISCONFIGURED',
        });
      }
      const key = requestKey(request);
      if (!key || !safeEqual(key, expected)) {
        throw new AuthError('Invalid or missing support-bot gateway key');
      }
      if (!takeToken('support-bot-gateway:global', env.SUPPORT_BOT_GATEWAY_RATE_PER_MIN)) {
        throw new AppError('Support-bot gateway rate limit exceeded', {
          statusCode: 429,
          code: 'SUPPORT_BOT_GATEWAY_RATE_LIMITED',
          expose: true,
        });
      }
      const ctx = { ...systemContext(request.requestId), userId: 'support-bot-gateway' };
      request.ctx = ctx;
      setCurrentContext(ctx);
    },
  );

  app.decorate(
    'supportBotGatewayOrAdmin',
    async function supportBotGatewayOrAdmin(
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> {
      if (requestKey(request)) {
        await app.supportBotGatewayAuth(request, reply);
        return;
      }
      await app.sessionOrApiKey(request, reply);
      if (request.ctx?.role !== 'admin' && request.ctx?.bypassRbac !== true) {
        throw new RBACError('Support-bot chat mapping requires admin access');
      }
    },
  );
}
