/**
 * Touchpoints client: POST shape (key in path, department view + params in body),
 * `{data}` unwrap, ApiError propagation, and logAutomation's swallow-everything contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './transport';
import { callTouchpoint, logAutomation } from './touchpoints';
import { jsonResponse } from '../test/sse';

const SESSION_KEY = 'octane.session.v1';

function seedSession(): void {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      accessToken: 'tok',
      refreshToken: 'r1',
      worker: { zohoUserId: '42', userName: 'Robiya' },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('callTouchpoint', () => {
  it('POSTs to /v1/touchpoints/<key> with the department view and unwraps {data}', async () => {
    seedSession();
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { key: 'dwh.carrier_balance', data: { balance: 812.4 } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await callTouchpoint('dwh.carrier_balance', { carrierId: '123' });
    expect(out).toEqual({ balance: 812.4 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/v1/touchpoints/dwh.carrier_balance');
    expect(JSON.parse(String(init.body))).toEqual({
      departmentAccess: ['sales'],
      params: { carrierId: '123' },
    });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('propagates the backend error code/message as ApiError', async () => {
    seedSession();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(422, { error: { code: 'SERVER_CRM_REJECTED', message: 'insufficient available' } }),
      ),
    );
    await expect(callTouchpoint('dwh.carrier_balance', { carrierId: '1' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      message: 'insufficient available',
    } satisfies Partial<ApiError>);
  });
});

describe('logAutomation', () => {
  it('fires one POST with the session agent name and swallows failures', async () => {
    seedSession();
    const fetchMock = vi.fn(async () => jsonResponse(500, {}));
    vi.stubGlobal('fetch', fetchMock);
    expect(() => logAutomation('balance')).not.toThrow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/v1/automation/logs');
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    expect(body.automationType).toBe('balance');
    expect(body.agentName).toBe('Robiya');
    expect(body.triggerDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.triggerTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('aliases catalog ids to widget log keys and hyphen→underscore', async () => {
    seedSession();
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: '1' }));
    vi.stubGlobal('fetch', fetchMock);
    logAutomation('close-app');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as {
      automationType: string;
    };
    expect(body.automationType).toBe('close_wex_application');
  });
});
