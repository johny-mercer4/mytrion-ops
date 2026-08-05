/**
 * Zoho OAuth worker sign-in — the BROWSER-facing callback (GET /v1/auth/zoho/callback).
 *
 * Regression cover for a total sign-in outage: the Zoho server app's redirect URI was registered as
 * this API path, but only the SPA-relay POST existed, so Zoho sent the browser to a GET that 404'd
 * (`Route GET /v1/auth/zoho/callback not found`). Nobody could log in, and the error said nothing
 * about OAuth. The GET must bounce the browser to the portal with the one-time code intact — never
 * consume the code itself, because the tested POST relay is what completes the exchange.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.FF_ZOHO_OAUTH_ENABLED = '1';
});

vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

// The code exchange must never run for a GET — asserted below via these spies staying untouched.
vi.mock('../../src/integrations/zohoOAuth.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/zohoOAuth.js')>();
  return {
    ...mod,
    exchangeCodeForToken: vi.fn(async () => 'unused-access-token'),
    fetchCurrentUser: vi.fn(async () => ({
      zohoUserId: '1',
      fullName: 'Nobody',
      email: null,
      profile: null,
      role: null,
    })),
  };
});

import { buildApp } from '../../src/app.js';
import { exchangeCodeForToken } from '../../src/integrations/zohoOAuth.js';

const exchangeMock = vi.mocked(exchangeCodeForToken);

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('GET /v1/auth/zoho/callback', () => {
  it('is registered — a browser redirect from Zoho must not 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/zoho/callback?code=abc123&state=signed-state',
    });
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).toBe(302);
  });

  it('forwards code and state to the portal so the SPA relay can finish the exchange', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/zoho/callback?code=abc123&state=signed-state',
    });
    const location = res.headers.location as string;
    // Same-origin root by default (the portal is served there), params intact.
    expect(location.startsWith('/?')).toBe(true);
    const params = new URLSearchParams(location.slice(location.indexOf('?') + 1));
    expect(params.get('code')).toBe('abc123');
    expect(params.get('state')).toBe('signed-state');
    expect(params.get('error')).toBeNull();
  });

  it('does not consume the one-time code itself', async () => {
    exchangeMock.mockClear();
    await app.inject({ method: 'GET', url: '/v1/auth/zoho/callback?code=abc123&state=s' });
    // Consuming it here would leave the SPA's POST relay with an already-redeemed code.
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it('passes a denied consent through as ?error rather than a dead end', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/zoho/callback?error=access_denied',
    });
    expect(res.statusCode).toBe(302);
    const params = new URLSearchParams((res.headers.location as string).split('?')[1] ?? '');
    expect(params.get('error')).toBe('access_denied');
  });

  it('labels a callback that carries neither a code nor an error', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/zoho/callback' });
    expect(res.statusCode).toBe(302);
    const params = new URLSearchParams((res.headers.location as string).split('?')[1] ?? '');
    expect(params.get('error')).toBe('invalid_callback');
  });

  it('drops unexpected query params instead of forwarding them to the portal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/zoho/callback?code=c&state=s&location=us&accounts-server=https%3A%2F%2Faccounts.zoho.com',
    });
    const params = new URLSearchParams((res.headers.location as string).split('?')[1] ?? '');
    expect(params.get('location')).toBeNull();
    expect(params.get('accounts-server')).toBeNull();
  });
});
