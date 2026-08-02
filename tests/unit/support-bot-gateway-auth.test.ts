import Fastify, { type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.js';
import { AuthError } from '../../src/lib/errors.js';
import { errorHandlerPlugin } from '../../src/plugins/errorHandler.js';
import { requestContextPlugin } from '../../src/plugins/requestContext.js';
import { supportBotGatewayAuthPlugin } from '../../src/plugins/supportBotGatewayAuth.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const supportKey = 'support-bot-key-with-at-least-32-characters';
const generalKey = 'general-api-key-with-at-least-32-characters';
let previousSupportKey = '';
let previousApiKey = '';

function adminContext(request: FastifyRequest): TenantContext {
  return {
    tenantId: 'octane',
    userId: 'admin-user',
    audience: 'internal',
    role: 'admin',
    scopes: ['*'],
    departments: [],
    allDepartmentAccess: true,
    requestId: request.requestId,
    sessionVerified: true,
  };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  requestContextPlugin(app);
  errorHandlerPlugin(app);
  app.decorate('sessionOrApiKey', async (request: FastifyRequest) => {
    if (request.headers.authorization !== `Bearer ${generalKey}`) {
      throw new AuthError('Invalid general credential');
    }
    request.ctx = adminContext(request);
  });
  supportBotGatewayAuthPlugin(app);
  app.get('/service', { onRequest: [app.supportBotGatewayAuth] }, async (request) => ({
    userId: request.ctx?.userId,
  }));
  app.get('/general', { onRequest: [app.sessionOrApiKey] }, async () => ({ ok: true }));
  app.get('/map', { onRequest: [app.supportBotGatewayOrAdmin] }, async () => ({ ok: true }));
  return app;
}

describe('dedicated support-bot gateway authentication', () => {
  beforeEach(() => {
    previousSupportKey = env.SUPPORT_BOT_GATEWAY_API_KEY;
    previousApiKey = env.API_KEY;
    env.SUPPORT_BOT_GATEWAY_API_KEY = supportKey;
    env.API_KEY = generalKey;
  });

  afterEach(() => {
    env.SUPPORT_BOT_GATEWAY_API_KEY = previousSupportKey;
    env.API_KEY = previousApiKey;
  });

  it('accepts only the dedicated key on service routes', async () => {
    const app = await buildApp();
    const accepted = await app.inject({
      method: 'GET',
      url: '/service',
      headers: { 'x-support-bot-key': supportKey },
    });
    const broadKey = await app.inject({
      method: 'GET',
      url: '/service',
      headers: { authorization: `Bearer ${generalKey}` },
    });
    const wrongKey = await app.inject({
      method: 'GET',
      url: '/service',
      headers: { 'x-support-bot-key': 'wrong' },
    });
    await app.close();

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ userId: 'support-bot-gateway' });
    expect(broadKey.statusCode).toBe(401);
    expect(wrongKey.statusCode).toBe(401);
  });

  it('does not let the dedicated key authenticate unrelated routes', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/general',
      headers: { 'x-support-bot-key': supportKey },
    });
    await app.close();
    expect(response.statusCode).toBe(401);
  });

  it('allows either the service identity or a verified admin on mapping routes', async () => {
    const app = await buildApp();
    const service = await app.inject({
      method: 'GET',
      url: '/map',
      headers: { 'x-support-bot-key': supportKey },
    });
    const admin = await app.inject({
      method: 'GET',
      url: '/map',
      headers: { authorization: `Bearer ${generalKey}` },
    });
    await app.close();
    expect(service.statusCode).toBe(200);
    expect(admin.statusCode).toBe(200);
  });
});
