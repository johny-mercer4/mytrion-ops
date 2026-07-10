/**
 * Deluge executor env switch: with ZOHO_FUNCTIONS_ENV=sandbox the executor targets the
 * sandbox functions root AND pulls its token from the sandbox service ('crm_sandbox' —
 * which falls back to the prod CRM refresh token when no sandbox token is configured).
 * Prod-default behavior is covered by zoho-functions.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => {
  process.env.ZOHO_FUNCTIONS_ENV = 'sandbox';
  process.env.ZOHO_FUNCTIONS_SANDBOX_BASE_URL = 'https://sandbox.zohoapis.com/crm/v2/functions';
  process.env.ZOHO_CRM_API_DOMAIN = 'https://www.zohoapis.com/crm/v8';
  return { fetchMock: vi.fn() };
});
vi.stubGlobal('fetch', fetchMock);

const { getZohoTokenMock } = vi.hoisted(() => ({ getZohoTokenMock: vi.fn() }));
vi.mock('../../src/integrations/wrapper.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/wrapper.js')>();
  return { ...mod, getZohoToken: getZohoTokenMock, invalidateZohoToken: vi.fn() };
});

import {
  activeZohoFunctionsEnv,
  executeZohoFunction,
  zohoFunctionsBaseUrl,
} from '../../src/integrations/zohoFunctions.js';

beforeEach(() => {
  vi.clearAllMocks();
  getZohoTokenMock.mockResolvedValue({ accessToken: 'sb-tok', apiDomain: undefined, expiresInSec: 3600 });
});

describe('sandbox env', () => {
  it('reports sandbox and targets the sandbox functions root', () => {
    expect(activeZohoFunctionsEnv()).toBe('sandbox');
    expect(zohoFunctionsBaseUrl()).toBe('https://sandbox.zohoapis.com/crm/v2/functions');
  });

  it('executes against the sandbox URL with the crm_sandbox token service', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ details: { output: '{"status":"success"}' } }), { status: 200 }),
    );
    await executeZohoFunction('mytrionfinanceparentsnapshot', {});
    expect(getZohoTokenMock).toHaveBeenCalledWith('crm_sandbox');
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe(
      'https://sandbox.zohoapis.com/crm/v2/functions/mytrionfinanceparentsnapshot/actions/execute',
    );
    expect((init.headers as Record<string, string>).Authorization).toBe('Zoho-oauthtoken sb-tok');
  });
});
