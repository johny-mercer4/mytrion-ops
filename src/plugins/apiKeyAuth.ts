import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { safeEqual } from '../lib/crypto.js';
import { AppError, AuthError } from '../lib/errors.js';
import { systemContext } from '../modules/auth/authService.js';
import { setCurrentContext } from './requestContext.js';

/**
 * Inbound auth for the single hardcoded engine (no users). Callers (Zoho widgets,
 * Telegram, mobile, …) present the static API_KEY and are granted the system context.
 * Accepts either `Authorization: Bearer <API_KEY>` or `x-api-key: <API_KEY>`.
 * Finer access (per-department RBAC) is layered on top via the request's department param.
 */
function extractKey(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const apiKeyHeader = request.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) return apiKeyHeader;
  return null;
}

export function apiKeyAuthPlugin(app: FastifyInstance): void {
  app.decorate(
    'apiKeyAuth',
    async function apiKeyAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
      if (!env.API_KEY) {
        throw new AppError('Server API key is not configured', { statusCode: 503, code: 'SERVER_MISCONFIGURED' });
      }
      const key = extractKey(request);
      if (!key || !safeEqual(key, env.API_KEY)) {
        throw new AuthError('Invalid or missing API key');
      }
      const ctx = systemContext(request.requestId);
      request.ctx = ctx;
      setCurrentContext(ctx);
    },
  );
}
