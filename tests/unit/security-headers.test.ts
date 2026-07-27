/**
 * Security headers that OAuth popup sign-in depends on.
 *
 * Regression guard for the RingCentral prod auth hang (2026-07-27): helmet's default
 * `Cross-Origin-Opener-Policy: same-origin` severs `window.opener` inside any popup we open, so
 * RingCentral Embeddable's redirect.js could never hand the auth code back and agents sat on
 * RC's "Loading..." page forever. Local dev never reproduced it (Vite sends no COOP).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import('../../src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

describe('Cross-Origin-Opener-Policy', () => {
  it('allows popups to keep their opener (OAuth sign-in must work)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
  });

  it('is never the popup-breaking bare same-origin', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    // `same-origin` puts window.open() popups in a separate browsing context group → opener null.
    expect(res.headers['cross-origin-opener-policy']).not.toBe('same-origin');
  });
});
