import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Set the inbound API key before env.ts is imported (parsed once at import time).
vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

import { buildApp } from '../../src/app.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('HTTP API (no external services)', () => {
  it('GET /health returns { ok: true }', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('rejects unauthenticated access to GET /v1/tools', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/tools' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'AUTH_ERROR' } });
  });

  it('returns 400 on a malformed login body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('rejects GET /v1/knowledge/docs with no API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/knowledge/docs' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'AUTH_ERROR' } });
  });

  it('rejects GET /v1/knowledge/docs with a wrong API key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/knowledge/docs',
      headers: { authorization: 'Bearer wrong-key' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('CORS preflight on /v1/chat/stream echoes a Zoho widget origin', async () => {
    const origin = 'https://3ab5b85d-1234.zappsusercontent.com';
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/chat/stream',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-api-key',
      },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('x-api-key');
  });

  it('CORS does not allow an unknown origin', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/chat/stream',
      headers: {
        origin: 'https://evil.example.com',
        'access-control-request-method': 'POST',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects DELETE /v1/knowledge/docs/:id with no API key', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/knowledge/docs/abc123' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'AUTH_ERROR' } });
  });

  it('validates bulk delete body (ids required, non-empty)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/knowledge/docs/delete',
      headers: { 'x-api-key': 'test-secret-key', 'content-type': 'application/json' },
      payload: { ids: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('rejects POST /v1/automation/logs with no API key', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/automation/logs', payload: { automationType: 'x' } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'AUTH_ERROR' } });
  });

  it('validates POST /v1/automation/logs body (automationType required)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/automation/logs',
      headers: { 'x-api-key': 'test-secret-key', 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
