/**
 * Zoho OAuth sign-in — resolving the worker's identity (integrations/zohoOAuth.fetchCurrentUser).
 *
 * Regression cover for `ZOHO_USER_LOOKUP_FAILED` hitting every NON-ADMIN worker. `GET /users` is gated
 * by the caller's CRM profile permission on the Users module, not just the OAuth scope: Administrator
 * profiles hold it, Sales-type profiles usually do not, so the call 403'd and login died for exactly
 * the ordinary users who make up the org. The fallback must identify the human at the accounts level
 * and read their profile/role with the SERVICE token instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

const listActiveUsersMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/integrations/zohoCrm.js', () => ({
  zohoCrm: { listActiveUsers: listActiveUsersMock },
}));

import { fetchCurrentUser } from '../../src/integrations/zohoOAuth.js';

/** Minimal fetch stub: route by URL so each test states only what Zoho returns. */
function stubFetch(handlers: { crmUsers?: () => Response; userInfo?: () => Response }): void {
  // `input` is typed loosely because this tsconfig has no DOM lib (no RequestInfo/Request globals);
  // every call site here passes a plain URL string anyway.
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = typeof input === 'string' ? input : String(input);
    if (url.includes('/users?type=CurrentUser')) {
      if (!handlers.crmUsers) throw new Error(`unexpected CRM call: ${url}`);
      return handlers.crmUsers();
    }
    if (url.includes('/oauth/user/info')) {
      if (!handlers.userInfo) throw new Error(`unexpected userinfo call: ${url}`);
      return handlers.userInfo();
    }
    throw new Error(`unexpected fetch: ${url}`);
  }));
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  listActiveUsersMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCurrentUser', () => {
  it('uses the worker\'s own CRM record when their profile is permitted (the admin path)', async () => {
    stubFetch({
      crmUsers: () =>
        json({
          users: [
            { id: '77', full_name: 'Ada Admin', email: 'ada@x.com', profile: { name: 'Administrator' }, role: { name: 'CEO' } },
          ],
        }),
    });
    const worker = await fetchCurrentUser('tok');
    expect(worker).toEqual({
      zohoUserId: '77',
      fullName: 'Ada Admin',
      email: 'ada@x.com',
      profile: 'Administrator',
      role: 'CEO',
    });
    // The permitted path must not spend a service-token roster call.
    expect(listActiveUsersMock).not.toHaveBeenCalled();
  });

  it('recovers a 403 NO_PERMISSION — the ordinary-profile case that broke login', async () => {
    stubFetch({
      crmUsers: () => json({ code: 'NO_PERMISSION', message: 'permission denied', status: 'error' }, 403),
      userInfo: () => json({ Email: 'Sales.Guy@X.com', Display_Name: 'Sales Guy', ZUID: 42 }),
    });
    listActiveUsersMock.mockResolvedValue([
      { zohoUserId: '12', name: 'Sales Guy', email: 'sales.guy@x.com', profile: 'Sales Agent', role: 'Sales', isOnline: false },
    ]);
    const worker = await fetchCurrentUser('tok');
    expect(worker.zohoUserId).toBe('12');
    // Profile/role are the RBAC inputs — they must survive the fallback, not come back null.
    expect(worker.profile).toBe('Sales Agent');
    expect(worker.role).toBe('Sales');
  });

  it('recovers a 401 OAUTH_SCOPE_MISMATCH the same way', async () => {
    stubFetch({
      crmUsers: () => json({ code: 'OAUTH_SCOPE_MISMATCH', status: 'error' }, 401),
      userInfo: () => json({ Email: 'a@x.com' }),
    });
    listActiveUsersMock.mockResolvedValue([
      { zohoUserId: '9', name: 'A', email: 'a@x.com', profile: 'Standard', role: 'Rep', isOnline: false },
    ]);
    await expect(fetchCurrentUser('tok')).resolves.toMatchObject({ zohoUserId: '9', profile: 'Standard' });
  });

  it('matches the CRM roster case-insensitively (Zoho casing is not stable)', async () => {
    stubFetch({
      crmUsers: () => json({}, 403),
      userInfo: () => json({ Email: 'MiXeD@Case.COM' }),
    });
    listActiveUsersMock.mockResolvedValue([
      { zohoUserId: '5', name: 'M', email: 'mixed@case.com', profile: 'Sales Agent', role: null, isOnline: false },
    ]);
    await expect(fetchCurrentUser('tok')).resolves.toMatchObject({ zohoUserId: '5' });
  });

  it('still signs in a Zoho account that is NOT an active CRM user — Mytrion Admin decides access, not login', async () => {
    stubFetch({
      crmUsers: () => json({}, 403),
      userInfo: () => json({ Email: 'ghost@x.com', Display_Name: 'Ghost', ZUID: 999 }),
    });
    listActiveUsersMock.mockResolvedValue([
      { zohoUserId: '1', name: 'Someone', email: 'someone@x.com', profile: 'Sales Agent', role: null, isOnline: false },
    ]);
    const worker = await fetchCurrentUser('tok');
    // Prefixed: a ZUID is a different id space from a CRM user id, and owner-scoped lookups must
    // fail closed on it rather than mistake it for one.
    expect(worker.zohoUserId).toBe('zuid:999');
    expect(worker.email).toBe('ghost@x.com');
    // No CRM profile/role to claim — access comes from Mytrion Admin.
    expect(worker.profile).toBeNull();
    expect(worker.role).toBeNull();
  });

  it('refuses only when the sign-in cannot be identified at all (no CRM user AND no ZUID)', async () => {
    stubFetch({
      crmUsers: () => json({}, 403),
      userInfo: () => json({ Email: 'ghost@x.com' }),
    });
    listActiveUsersMock.mockResolvedValue([]);
    await expect(fetchCurrentUser('tok')).rejects.toThrow(/cannot be identified/);
  });

  it('does NOT swallow a genuine Zoho outage — a 500 still fails, and carries the reason', async () => {
    stubFetch({ crmUsers: () => new Response('upstream exploded', { status: 500 }) });
    // Falling back here would mask a broken dependency as a login problem.
    await expect(fetchCurrentUser('tok')).rejects.toMatchObject({ code: 'ZOHO_USER_LOOKUP_FAILED' });
    expect(listActiveUsersMock).not.toHaveBeenCalled();
  });
});
