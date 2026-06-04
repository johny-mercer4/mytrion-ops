import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

// Mock the Zoho primitives so we exercise the Wrapper's caching, not real OAuth.
vi.mock('../../src/integrations/zoho.js', () => ({
  resolveZohoConfig: (service: string) => ({
    service,
    clientId: 'id',
    clientSecret: 'secret',
    refreshToken: 'refresh',
    accountsDomain: 'https://accounts.zoho.com',
  }),
  fetchZohoAccessToken: fetchMock,
  zohoAuthHeader: (t: { accessToken: string }) => ({
    Authorization: `Zoho-oauthtoken ${t.accessToken}`,
  }),
}));

import { authHeaders, getZohoToken, resetAuthCache } from '../../src/integrations/wrapper.js';

describe('wrapper auth', () => {
  beforeEach(() => {
    resetAuthCache();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ accessToken: 'tok1', apiDomain: undefined, expiresInSec: 3600 });
  });

  it('caches a Zoho token within its lifetime (one refresh for repeated calls)', async () => {
    const t0 = 1_000_000;
    const a = await getZohoToken('crm', t0);
    const b = await getZohoToken('crm', t0 + 60_000);
    expect(a.accessToken).toBe('tok1');
    expect(b.accessToken).toBe('tok1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes after expiry (minus skew)', async () => {
    const t0 = 1_000_000;
    await getZohoToken('crm', t0);
    fetchMock.mockResolvedValue({ accessToken: 'tok2', apiDomain: undefined, expiresInSec: 3600 });
    // 3600s lifetime, 60s skew -> stale at t0 + 3_540_000ms
    const later = await getZohoToken('crm', t0 + 3_600_000);
    expect(later.accessToken).toBe('tok2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches per service independently', async () => {
    await getZohoToken('crm', 0);
    await getZohoToken('desk', 0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('produces a Zoho-oauthtoken Authorization header', async () => {
    const headers = await authHeaders('zoho_crm');
    expect(headers.Authorization).toBe('Zoho-oauthtoken tok1');
  });
});
