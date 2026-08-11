/**
 * RingCentral softphone routes — department authorization.
 *
 * `requireSoftphoneAccess` is the server half of a two-part decision whose client half lives in
 * `apps/mytrion-crm/src/components/ringcentral/rcRouteGate.ts`. The two halves drifted once —
 * `collection` was in the client allowlist and not the server one — and the failure was invisible:
 * the widget booted, the config request was refused, and `RingCentralPhone` swallows that error by
 * design ("widget unavailable — fail silently"). A Collection agent just had a phone that did
 * nothing, with a clean console.
 *
 * So the allowlist gets a test rather than a comment. It also pins that a verified session ignores a
 * self-asserted `x-department-access` header, which is the general rule for every route in this app.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

/**
 * Resolve departments straight from the profile string.
 *
 * Without this the suite would be testing the RESOLVER, not the gate. With no database, the real
 * service catches and degrades to `legacyAccess`, which deliberately never grants `customer-service`
 * ("Admin Profile/Role Defaults / per-user only", `mytrionAccessService.ts:314`) — so a genuine CS
 * agent looks refused for a reason that has nothing to do with this route.
 */
vi.mock('../../src/modules/access/mytrionAccessService.js', async (importOriginal) => {
  const mod =
    await importOriginal<typeof import('../../src/modules/access/mytrionAccessService.js')>();
  const { deriveWorkerDepartments } = await import('../../src/lib/department.js');
  return {
    ...mod,
    mytrionAccessService: {
      ...mod.mytrionAccessService,
      resolveBatch: vi.fn(async () => new Map()),
      resolveWorkerAccess: vi.fn(async (input: { profileName?: string | null }) => ({
        accessibleMytrions: [],
        homeMytrion: null,
        allDepartmentAccess: false,
        departments: deriveWorkerDepartments(input.profileName ?? null, null),
        viewAsUserIds: [],
        mytrionAccessModes: {},
      })),
    },
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { env } from '../../src/config/env.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

/** A verified worker session. `profile` drives the department grant (substring match). */
async function workerToken(profile: string, zohoUserId = '77'): Promise<string> {
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale claim — re-derived from the profile at verify
    worker: { zohoUserId, userName: 'Robiya', profile },
  });
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

const CONFIG_URL = '/v1/ringcentral/embed-config';

/**
 * The endpoint 404s when the feature flag is off (default `'0'`), so an allowed caller's success
 * case is "not 401 and not 403". The gate runs before the flag check, so the REFUSALS below are
 * exact regardless of configuration — which is the half that matters here.
 */
const configured = Boolean(env.FF_RINGCENTRAL_ENABLED && env.RINGCENTRAL_CLIENT_ID);

describe('softphone access is limited to the desk-phone departments', () => {
  it('refuses an unauthenticated caller', async () => {
    const res = await app.inject({ method: 'GET', url: CONFIG_URL });
    expect(res.statusCode).toBe(401);
  });

  it.each([
    ['Sales Rep', 'sales'],
    ['Customer Service Agent', 'customer-service'],
    ['Collection Agent', 'collection'],
  ])('allows %s (%s)', async (profile) => {
    const token = await workerToken(profile);
    const res = await app.inject({ method: 'GET', url: CONFIG_URL, headers: bearer(token) });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(configured ? 200 : 404);
  });

  it.each(['Billing Clerk', 'HR Generalist', 'Recruiter', 'Finance Analyst'])(
    'refuses %s',
    async (profile) => {
      const token = await workerToken(profile);
      const res = await app.inject({ method: 'GET', url: CONFIG_URL, headers: bearer(token) });
      expect(res.statusCode).toBe(403);
    },
  );

  it('ignores a self-asserted department header on a verified session', async () => {
    // The whole point of FF_SESSION_DEPT_AUTHORITATIVE: a billing worker cannot type their way into
    // the softphone. If this ever passes, every department gate in the app is bypassable the same way.
    const token = await workerToken('Billing Clerk');
    const res = await app.inject({
      method: 'GET',
      url: CONFIG_URL,
      headers: { ...bearer(token), 'x-department-access': 'sales' },
    });
    expect(res.statusCode).toBe(403);
  });
});
