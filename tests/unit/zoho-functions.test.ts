/**
 * Zoho Deluge function executor. Coverage: exact request shape (body-less POST, args as
 * ONE JSON query param, Zoho-oauthtoken header), details.output parsing incl. the
 * numeric-key repair, unwrap modes, 401 invalidate+retry-once with the managed token,
 * fallback-pair semantics (falls through on function-not-found only), base-URL derivation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => {
  process.env.ZOHO_CRM_API_DOMAIN = 'https://www.zohoapis.com/crm/v8';
  process.env.ZOHO_FUNCTIONS_BASE_URL = '';
  return { fetchMock: vi.fn() };
});
vi.stubGlobal('fetch', fetchMock);

const { getZohoTokenMock, invalidateMock } = vi.hoisted(() => ({
  getZohoTokenMock: vi.fn(),
  invalidateMock: vi.fn(),
}));
vi.mock('../../src/integrations/wrapper.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/wrapper.js')>();
  return { ...mod, getZohoToken: getZohoTokenMock, invalidateZohoToken: invalidateMock };
});

import {
  executeZohoFunction,
  executeZohoFunctionWithFallback,
  parseFunctionOutput,
  zohoFunctionsBaseUrl,
  ZohoFunctionError,
} from '../../src/integrations/zohoFunctions.js';

function zohoResponse(output: unknown, status = 200): Response {
  const body =
    output === undefined
      ? ''
      : JSON.stringify({
          details: { output: typeof output === 'string' ? output : JSON.stringify(output) },
        });
  return new Response(body, { status });
}

beforeEach(() => {
  vi.clearAllMocks();
  getZohoTokenMock.mockResolvedValue({ accessToken: 'tok-1', apiDomain: undefined, expiresInSec: 3600 });
});

describe('zohoFunctionsBaseUrl', () => {
  it('derives /crm/v2/functions from the ORIGIN of the v8 API domain', () => {
    expect(zohoFunctionsBaseUrl()).toBe('https://www.zohoapis.com/crm/v2/functions');
  });
});

describe('parseFunctionOutput', () => {
  it('parses clean JSON', () => {
    expect(parseFunctionOutput('{"status":"success","id":"1"}')).toEqual({
      status: 'success',
      id: '1',
    });
  });

  it('repairs bare numeric keys before parsing', () => {
    expect(parseFunctionOutput('{90002:"Multiple carriers found",90001:"x"}')).toEqual({
      '90002': 'Multiple carriers found',
      '90001': 'x',
    });
  });

  it('returns non-JSON text as-is and empty as null', () => {
    expect(parseFunctionOutput('billing form not found')).toBe('billing form not found');
    expect(parseFunctionOutput('  ')).toBeNull();
  });
});

describe('executeZohoFunction — request shape', () => {
  it('POSTs body-less with auth_type + arguments in the query and the oauth header', async () => {
    fetchMock.mockResolvedValueOnce(zohoResponse({ status: 'success' }));
    await executeZohoFunction('mytrionhomesnapshot', { userId: '42', skip: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe(
      'https://www.zohoapis.com/crm/v2/functions/mytrionhomesnapshot/actions/execute',
    );
    expect(url.searchParams.get('auth_type')).toBe('oauth');
    expect(JSON.parse(url.searchParams.get('arguments') ?? '{}')).toEqual({ userId: '42' }); // undefined dropped
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe('Zoho-oauthtoken tok-1');
  });
});

describe('executeZohoFunction — unwrap modes', () => {
  it("'status' passes on status:success and throws the payload message otherwise", async () => {
    fetchMock.mockResolvedValueOnce(zohoResponse({ status: 'success', rows: [1] }));
    await expect(
      executeZohoFunction('fn', {}, { unwrap: 'status' }),
    ).resolves.toEqual({ status: 'success', rows: [1] });

    fetchMock.mockResolvedValueOnce(zohoResponse({ status: 'error', message: 'no carrier' }));
    await expect(executeZohoFunction('fn', {}, { unwrap: 'status' })).rejects.toThrow('no carrier');
  });

  it("'successFlag' accepts success:true and rejects success:false", async () => {
    fetchMock.mockResolvedValueOnce(zohoResponse({ success: true, data: { a: 1 } }));
    await expect(executeZohoFunction('fn', {}, { unwrap: 'successFlag' })).resolves.toEqual({
      success: true,
      data: { a: 1 },
    });
    fetchMock.mockResolvedValueOnce(zohoResponse({ success: false, message: 'dup lead' }));
    await expect(executeZohoFunction('fn', {}, { unwrap: 'successFlag' })).rejects.toThrow(
      'dup lead',
    );
  });

  it("'permissive' (default) unwraps data/Result/Response and never throws on soft shapes", async () => {
    fetchMock.mockResolvedValueOnce(zohoResponse({ Result: { newStatus: 'HOLD' } }));
    await expect(executeZohoFunction('fn', {})).resolves.toEqual({ newStatus: 'HOLD' });
  });
});

describe('executeZohoFunction — auth behavior', () => {
  it('on 401 with the managed token: invalidates, refreshes, retries exactly once', async () => {
    getZohoTokenMock
      .mockResolvedValueOnce({ accessToken: 'stale', apiDomain: undefined, expiresInSec: 3600 })
      .mockResolvedValueOnce({ accessToken: 'fresh', apiDomain: undefined, expiresInSec: 3600 });
    fetchMock
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(zohoResponse({ status: 'success' }));
    await executeZohoFunction('fn', {});
    expect(invalidateMock).toHaveBeenCalledWith('crm');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect((second[1].headers as Record<string, string>).Authorization).toBe(
      'Zoho-oauthtoken fresh',
    );
  });

  it('a caller-supplied token disables the retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
    await expect(
      executeZohoFunction('fn', {}, { accessToken: 'my-token' }),
    ).rejects.toBeInstanceOf(ZohoFunctionError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getZohoTokenMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});

describe('executeZohoFunctionWithFallback', () => {
  it('falls through to the next casing on 404 only', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(zohoResponse({ status: 'success', invoices: [] }));
    const out = await executeZohoFunctionWithFallback(
      ['mytrionCheckPayment', 'mytrioncheckpayment'],
      { carrierId: '5' },
      { unwrap: 'status' },
    );
    expect(out).toEqual({ status: 'success', invoices: [] });
    const calls = fetchMock.mock.calls as Array<[URL, RequestInit]>;
    expect(calls[0]![0].pathname).toContain('mytrionCheckPayment');
    expect(calls[1]![0].pathname).toContain('mytrioncheckpayment');
  });

  it('does NOT fall through on a non-not-found failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('server broke', { status: 500 }));
    await expect(
      executeZohoFunctionWithFallback(['a', 'b'], {}),
    ).rejects.toThrow('HTTP 500');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
