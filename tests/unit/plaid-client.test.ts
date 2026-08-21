/**
 * Plaid Link-token client — mock fetch only. Does not call Check report GET.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import { createPlaidLinkToken, plaidHost } from '../../src/integrations/plaidClient.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  fetchMock.mockReset();
  env.PLAID_CLIENT_ID = '';
  env.PLAID_SECRET = '';
  env.PLAID_ENV = 'sandbox';
  env.PLAID_ENVIRONMENT = '';
});

describe('createPlaidLinkToken', () => {
  it('mints a sandbox auth Link token and never hits a Check /get', async () => {
    env.PLAID_CLIENT_ID = 'cid';
    env.PLAID_SECRET = 'sec';
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ link_token: 'link-sandbox-1', expiration: '2099-01-01T00:00:00Z' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const data = await createPlaidLinkToken({ clientUserId: 'octane-dc-test' });
    expect(data.billed).toBe(false);
    expect(data.product).toBe('link_token');
    expect(data.linkToken).toBe('link-sandbox-1');
    expect(plaidHost()).toBe('https://sandbox.plaid.com');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox.plaid.com/link/token/create');
    expect(url).not.toMatch(/check_report/);
    const body = JSON.parse(String(init.body)) as { products: string[] };
    expect(body.products).toEqual(['auth']);
  });
});
