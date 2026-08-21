/**
 * iSoftPull client — mock fetch only. Never pointed at app.isoftpull.com (base URL pinned empty
 * in vitest; tests set a dummy host).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import {
  fullStateName,
  isoftpullConfiguredMissing,
  pullIsoftPullReport,
} from '../../src/integrations/isoftpullClient.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  fetchMock.mockReset();
  env.ISOFTPULL_BASE_URL = '';
  env.ISOFTPULL_EQUIFAX_API_KEY = '';
  env.ISOFTPULL_EQUIFAX_API_SECRET = '';
});

describe('fullStateName', () => {
  it('expands a US abbreviation and leaves a full name alone', () => {
    expect(fullStateName('tx')).toBe('Texas');
    expect(fullStateName('Texas')).toBe('Texas');
  });
});

describe('pullIsoftPullReport', () => {
  it('POSTs /reports for one bureau and returns the payload', async () => {
    env.ISOFTPULL_BASE_URL = 'https://isoftpull.test/api/v2';
    env.ISOFTPULL_EQUIFAX_API_KEY = 'k';
    env.ISOFTPULL_EQUIFAX_API_SECRET = 's';
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, reports: { equifax: { success: true } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const data = await pullIsoftPullReport({
      bureau: 'equifax',
      firstName: 'Ada',
      lastName: 'Cole',
      address: '1 Main',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
    });
    expect(data.bureau).toBe('equifax');
    expect(data.payload).toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://isoftpull.test/api/v2/reports');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['api-key']).toBe('k');
    const body = JSON.parse(String(init.body)) as { state: string; full_feed: boolean };
    expect(body.state).toBe('Texas');
    expect(body.full_feed).toBe(true);
  });

  it('throws on 403 without treating it as a hit', async () => {
    env.ISOFTPULL_BASE_URL = 'https://isoftpull.test/api/v2';
    env.ISOFTPULL_EQUIFAX_API_KEY = 'k';
    env.ISOFTPULL_EQUIFAX_API_SECRET = 's';
    fetchMock.mockResolvedValue(new Response('denied', { status: 403 }));
    await expect(
      pullIsoftPullReport({
        bureau: 'equifax',
        firstName: 'Ada',
        lastName: 'Cole',
        address: '1 Main',
        city: 'Austin',
        state: 'Texas',
        zip: '78701',
      }),
    ).rejects.toThrow(/denied at the iSoftPull edge/);
  });

  it('names the missing bureau env instead of falling back to the legacy pair', () => {
    env.ISOFTPULL_BASE_URL = 'https://isoftpull.test/api/v2';
    expect(isoftpullConfiguredMissing()).toBe('ISOFTPULL_EQUIFAX_API_KEY');
  });
});
