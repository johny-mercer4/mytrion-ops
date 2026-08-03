import { afterEach, describe, expect, it, vi } from 'vitest';
import { KB_ARTICLES } from '../src/kb/corpus.js';
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

  it('grounds fraud-hold answers in the June operations manual correction', () => {
    const hits = searchKb(
      'can I override or reactivate a card on hold for fraud',
      5,
      new Set(['knowledge', 'cards']),
    );
    const status = hits.find((hit) => hit.id === 'KB-32');

    expect(status?.en).toContain('cannot be permanently reactivated');
    expect(status?.en).toContain('Verification approval');
    expect(status?.en).toContain('only when the live card result marks it available');
  });

  it('retrieves the client-communicable limit increase requirements', () => {
    const hits = searchKb(
      'what are the limit increase requirements paid invoices insurance plaid',
      3,
      new Set(['knowledge', 'billing']),
    );

    expect(hits[0]?.id).toBe('KB-34');
    expect(hits[0]?.en).toContain('at least 5 fully paid invoices');
    expect(hits[0]?.en).toContain('$5,000');
  });

  it('keeps internal-only manual identifiers out of the client corpus', () => {
    const corpus = JSON.stringify(KB_ARTICLES);

    expect(corpus).not.toContain('9546508');
    expect(corpus).not.toContain('Joshua Dunavant');
    expect(corpus).not.toContain('Secure Entry Code');
    expect(corpus).not.toContain('C-19');
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
