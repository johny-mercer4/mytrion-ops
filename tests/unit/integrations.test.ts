import { beforeEach, describe, expect, it, vi } from 'vitest';

// CMP sandbox creds must exist before env.ts is imported (parsed once at import time).
const { fetchMock } = vi.hoisted(() => {
  process.env.CMP_SANDBOX_URL = 'https://sandbox.example.com';
  process.env.CMP_SANDBOX_LOGIN = 'u';
  process.env.CMP_SANDBOX_PASSWORD = 'p';
  process.env.SERVER_CRM_URL = 'https://crm.example.com';
  process.env.SERVER_CRM_KEY = 'srv-key';
  // Force DWH unset for a deterministic "not configured" test (dotenv won't override a
  // key already present in process.env, even when empty).
  process.env.DWH_DATABASE_URL = '';
  return { fetchMock: vi.fn() };
});
vi.stubGlobal('fetch', fetchMock);

import {
  activeCmpEnvironment,
  cmpAuthHeaders,
  cmpBaseUrl,
  clearCmpTokenCache,
  getCmpToken,
} from '../../src/integrations/cmp.js';
import { getDwhPool } from '../../src/integrations/dwh.js';
import { efsGroupWsdlFrom, extractEfsToken, wsdlToEndpoint } from '../../src/integrations/efs.js';
import {
  serverCrmAuthHeaders,
  serverCrmGet,
  serverCrmPost,
} from '../../src/integrations/serverCrm.js';
import { createTokenProvider } from '../../src/integrations/tokenCache.js';

describe('createTokenProvider', () => {
  it('coalesces concurrent fetches into one', async () => {
    let calls = 0;
    const p = createTokenProvider({
      ttlMs: 1000,
      fetch: async () => {
        calls += 1;
        await Promise.resolve();
        return 'tok';
      },
    });
    const [a, b] = await Promise.all([p.get(), p.get()]);
    expect([a, b]).toEqual(['tok', 'tok']);
    expect(calls).toBe(1);
  });

  it('refreshes only after the TTL (injected clock)', async () => {
    let calls = 0;
    let t = 0;
    const p = createTokenProvider({
      ttlMs: 100,
      now: () => t,
      fetch: async () => {
        calls += 1;
        return `tok${calls}`;
      },
    });
    expect(await p.get()).toBe('tok1');
    t = 50;
    expect(await p.get()).toBe('tok1'); // still fresh
    t = 150;
    expect(await p.get()).toBe('tok2'); // expired -> refetch
    expect(calls).toBe(2);
  });

  it('forceRefresh and clear both trigger a new fetch', async () => {
    let calls = 0;
    const p = createTokenProvider({ ttlMs: 10_000, fetch: async () => `t${(calls += 1)}` });
    expect(await p.get()).toBe('t1');
    expect(await p.forceRefresh()).toBe('t2');
    p.clear();
    expect(await p.get()).toBe('t3');
  });
});

describe('CMP wrapper auth', () => {
  beforeEach(() => {
    clearCmpTokenCache();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ token: 'abc' }) });
  });

  it('defaults to the sandbox environment with a slash-stripped base url', () => {
    expect(activeCmpEnvironment()).toBe('sandbox');
    expect(cmpBaseUrl()).toBe('https://sandbox.example.com');
  });

  it('authenticates once and caches the bearer token', async () => {
    expect(await getCmpToken()).toBe('abc');
    expect(await getCmpToken()).toBe('abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://sandbox.example.com/api/authenticate');
  });

  it('builds Bearer auth headers', async () => {
    const headers = await cmpAuthHeaders();
    expect(headers).toEqual({ Authorization: 'Bearer abc', 'Content-Type': 'application/json' });
  });
});

describe('EFS auth helpers', () => {
  it('extracts the token from EFS response shapes', () => {
    expect(extractEfsToken({ result: 'x' })).toBe('x');
    expect(extractEfsToken({ return: { clientId: 'y' } })).toBe('y');
    expect(extractEfsToken({ loginResponse: { clientId: 'z' } })).toBe('z');
    expect(extractEfsToken(undefined)).toBeUndefined();
  });

  it('derives the CarrierGroupWS WSDL + SOAP endpoint', () => {
    const card = 'https://ws.efsllc.com/axis2/services/CardManagementWS?wsdl';
    expect(efsGroupWsdlFrom(card)).toBe('https://ws.efsllc.com/axis2/services/CarrierGroupWS?wsdl');
    expect(wsdlToEndpoint(card)).toBe('https://ws.efsllc.com/axis2/services/CardManagementWS/');
  });
});

describe('DWH wrapper', () => {
  it('throws clearly when DWH_DATABASE_URL is not configured', () => {
    expect(() => getDwhPool()).toThrow(/DWH_DATABASE_URL/);
  });
});

describe('Server CRM wrapper (proxy)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{"ok":true}' });
  });

  it('sends the x-api-key header', () => {
    expect(serverCrmAuthHeaders()).toEqual({ 'x-api-key': 'srv-key', 'Content-Type': 'application/json' });
  });

  it('GET builds url + query and authenticates', async () => {
    const out = await serverCrmGet('/api/agent/dwh/schema', { table: 'cards' });
    expect(out).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://crm.example.com/api/agent/dwh/schema?table=cards');
    expect((init as RequestInit).method).toBe('GET');
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'srv-key' });
  });

  it('POST sends a JSON body', async () => {
    await serverCrmPost('/api/agent/dwh/snapshot', { agentName: 'Jane' });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe('{"agentName":"Jane"}');
  });

  it('throws on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    await expect(serverCrmGet('/api/agent/dwh/snapshot')).rejects.toThrow(/HTTP 500/);
  });
});
