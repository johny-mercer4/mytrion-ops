import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchKb, searchSupportKb } from '../src/kb/search.js';

describe('bundled KB safe fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('excludes Money Code articles while the service is disabled', () => {
    const hits = searchKb(
      'money code fee and limit',
      5,
      new Set(['knowledge', 'cards']),
    );

    expect(hits.some((hit) => hit.serviceId === 'money_code')).toBe(false);
  });

  it('restores Money Code articles only when explicitly enabled', () => {
    const hits = searchKb(
      'money code fee and limit',
      5,
      new Set(['knowledge', 'money_code']),
    );

    expect(hits.some((hit) => hit.serviceId === 'money_code')).toBe(true);
  });

  it('passes the closed-over carrier and enabled services to DB retrieval', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ articles: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const hits = await searchSupportKb(
      'carrier-db-scope',
      'a deliberately unknown knowledge question',
      ['knowledge', 'cards'],
      3,
    );

    expect(hits).toEqual([]);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    expect(JSON.parse(String(init?.body))).toEqual({
      carrierId: 'carrier-db-scope',
      query: 'a deliberately unknown knowledge question',
      enabledServices: ['cards', 'knowledge'],
      limit: 3,
    });
  });

  it('keeps disabled Money Code content out of the fallback after backend failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 })),
    );
    const hits = await searchSupportKb(
      'carrier-fallback-scope',
      'money code fee and limit',
      ['knowledge', 'cards'],
      3,
    );

    expect(hits.some((hit) => hit.serviceId === 'money_code')).toBe(false);
  });
});
