/**
 * COQL auto-pagination (`zohoCrm.runCoqlAll`).
 *
 * These paths cannot be exercised against the real org: the modules that drove this work hold 687 and
 * 4 records, so every prod drain is a single page and page 2+ would ship untested. The HTTP layer is
 * stubbed here so the loop itself — boundaries, termination, guards — is pinned.
 *
 * The termination rules encode two live Zoho behaviours worth not re-learning:
 *   - an offset past the end returns HTTP 200 `{"data":[]}` with NO `info` block, so `more_records`
 *     cannot be the only signal;
 *   - a short page is the reliable end-of-set marker.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('../../src/integrations/zohoAuth.js', () => ({
  authHeaders: async () => ({ Authorization: 'Zoho-oauthtoken test' }),
  baseUrl: () => 'https://www.zohoapis.com/crm/v8',
  invalidateZohoToken: () => {},
}));
vi.stubGlobal('fetch', fetchMock);

const { zohoCrm } = await import('../../src/integrations/zohoCrm.js');

/** A page of `n` synthetic rows, numbered from `from` so ordering/duplication is visible. */
function page(from: number, n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({ id: String(from + i) }));
}

function ok(data: Array<Record<string, unknown>>, info?: { more_records?: boolean; count?: number }) {
  return { ok: true, status: 200, text: async () => JSON.stringify({ data, ...(info ? { info } : {}) }) };
}

/** The LIMIT clause of every COQL call made, in order — the assertion that matters most here. */
function limitsRequested(): string[] {
  return fetchMock.mock.calls.map((call) => {
    const body = JSON.parse((call[1] as { body: string }).body) as { select_query: string };
    return /limit\s+([\d]+,\s*[\d]+)/i.exec(body.select_query)?.[1] ?? '(none)';
  });
}

describe('runCoqlAll', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('walks page by page and concatenates every row in order', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(page(0, 3), { more_records: true }))
      .mockResolvedValueOnce(ok(page(3, 3), { more_records: true }))
      .mockResolvedValueOnce(ok(page(6, 2), { more_records: false }));

    const res = await zohoCrm.runCoqlAll('select id from Parent_Referrers where id is not null order by id desc', {
      pageSize: 3,
    });

    expect(res.rows.map((r) => r.id)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
    expect(res.pages).toBe(3);
    expect(res.truncated).toBe(false);
    expect(limitsRequested()).toEqual(['0, 3', '3, 3', '6, 3']);
  });

  it('stops on a short page without spending another call', async () => {
    fetchMock.mockResolvedValueOnce(ok(page(0, 2), { more_records: true }));

    const res = await zohoCrm.runCoqlAll('select id from X where id is not null', { pageSize: 5 });

    // more_records said "true" but the page came back short — the set is exhausted either way.
    expect(res.rows).toHaveLength(2);
    expect(res.pages).toBe(1);
    expect(res.truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops when a full page reports no more records', async () => {
    fetchMock.mockResolvedValueOnce(ok(page(0, 4), { more_records: false }));

    const res = await zohoCrm.runCoqlAll('select id from X where id is not null', { pageSize: 4 });

    expect(res.rows).toHaveLength(4);
    expect(res.pages).toBe(1);
    expect(res.truncated).toBe(false);
  });

  it('survives a response with no info block at all (Zoho omits it past the end)', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(page(0, 2), { more_records: true }))
      .mockResolvedValueOnce(ok([]));

    const res = await zohoCrm.runCoqlAll('select id from X where id is not null', { pageSize: 2 });

    expect(res.rows).toHaveLength(2);
    expect(res.truncated).toBe(false);
  });

  it('treats HTTP 204 as a clean empty result', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' });

    const res = await zohoCrm.runCoqlAll('select id from X where id is not null', { pageSize: 100 });

    expect(res.rows).toEqual([]);
    expect(res.pages).toBe(1);
    expect(res.truncated).toBe(false);
  });

  it('honours a row budget and reports truncated, trimming to the budget exactly', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(page(0, 4), { more_records: true }))
      .mockResolvedValueOnce(ok(page(4, 4), { more_records: true }));

    const res = await zohoCrm.runCoqlAll('select id from X where id is not null', { pageSize: 4, maxRows: 5 });

    expect(res.rows).toHaveLength(5);
    expect(res.rows.at(-1)?.id).toBe('4');
    expect(res.truncated).toBe(true);
  });

  it('reports truncated when the time budget expires mid-drain', async () => {
    // budgetMs 0 → the check trips on the first boundary, with rows still available upstream.
    fetchMock.mockResolvedValueOnce(ok(page(0, 2), { more_records: true }));

    const res = await zohoCrm.runCoqlAll('select id from X where id is not null', { pageSize: 2, budgetMs: 0 });

    expect(res.rows).toHaveLength(2);
    expect(res.truncated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a query that already carries its own LIMIT', async () => {
    await expect(
      zohoCrm.runCoqlAll('select id from X where id is not null limit 0, 200'),
    ).rejects.toThrow(/owns the LIMIT clause/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clamps page size to Zoho\'s 2000-row page cap', async () => {
    fetchMock.mockResolvedValueOnce(ok(page(0, 1), { more_records: false }));

    await zohoCrm.runCoqlAll('select id from X where id is not null', { pageSize: 99_999 });

    expect(limitsRequested()).toEqual(['0, 2000']);
  });

  it('stops at the 100k offset ceiling instead of looping into a Zoho error', async () => {
    // Every page is full and claims more — only the hard ceiling can end this.
    fetchMock.mockImplementation(async () => ok(page(0, 2000), { more_records: true }));

    const res = await zohoCrm.runCoqlAll('select id from X where id is not null', { pageSize: 2000 });

    expect(res.truncated).toBe(true);
    expect(res.pages).toBe(50); // 50 * 2000 = the 100_000 ceiling
    expect(res.rows).toHaveLength(100_000);
  });
});
