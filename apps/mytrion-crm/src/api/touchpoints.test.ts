/**
 * Touchpoints client: POST shape (key in path, department view + params in body),
 * `{data}` unwrap, ApiError propagation, and logAutomation's swallow-everything contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './transport';
import { automationErrorCode, callTouchpoint, logAutomation } from './touchpoints';
import { jsonResponse } from '../test/sse';

const SESSION_KEY = 'octane.session.v1';

function seedSession(): void {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      accessToken: 'tok',
      refreshToken: 'r1',
      worker: { zohoUserId: '42', userName: 'CI Test Admin' },
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
  it('sends only the idempotent lifecycle fields for a terminal failure', async () => {
    seedSession();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { id: '1' }));
    vi.stubGlobal('fetch', fetchMock);
    logAutomation('balance', {
      runId: '11111111-1111-4111-8111-111111111111',
      phase: 'failed',
      durationMs: 723,
      errorCode: 'network',
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      automationType: 'balance_check',
      runId: '11111111-1111-4111-8111-111111111111',
      phase: 'failed',
      durationMs: 723,
      errorCode: 'network',
    });
    expect(body).not.toHaveProperty('errorMessage');
  });

  it('fires one POST with the session agent name and swallows failures', async () => {
    seedSession();
    const fetchMock = vi.fn(async () => jsonResponse(500, {}));
    vi.stubGlobal('fetch', fetchMock);
    // 'tracking' is deliberately an UNALIASED id — it is the pass-through case. ('balance' used to
    // stand here and now aliases to the widget's key, which is what the next test pins.)
    expect(() => logAutomation('tracking')).not.toThrow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/v1/automation/logs');
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    expect(body.automationType).toBe('tracking');
    expect(body.agentName).toBe('CI Test Admin');
    expect(body.triggerDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.triggerTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    // Everything this app logs is Horizon; the legacy Zoho widget sends no origin at all.
    expect(body.originSource).toBe('Mytrion Horizon');
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

  /**
   * The two aliases that closed a live data split: Horizon was writing `balance` / `account_status`
   * while the Zoho widget kept writing `balance_check` / `account_status_check` for the same
   * automations, so each one had two names and two partial histories in the log.
   */
  it.each([
    ['balance', 'balance_check'],
    ['account-status', 'account_status_check'],
    ['unit-driver', 'unit_driver_change'],
  ])('logs %s under the widget key %s', async (id, expected) => {
    seedSession();
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: '1' }));
    vi.stubGlobal('fetch', fetchMock);
    logAutomation(id);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    ) as { automationType: string; originSource: string };
    expect(body.automationType).toBe(expected);
    expect(body.originSource).toBe('Mytrion Horizon');
  });

  it('reduces errors to coarse, non-sensitive buckets', () => {
    expect(automationErrorCode(new Error('Failed to fetch carrier 123'))).toBe('network');
    expect(automationErrorCode(new Error('Card number is required'))).toBe('validation');
    expect(automationErrorCode(new Error('upstream returned a private payload'))).toBe(
      'automation_failed',
    );
  });
});
