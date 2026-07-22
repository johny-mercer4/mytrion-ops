import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

// Auth + base URL are the wrapper's job; mock them so we exercise zohoCrm's request/parse logic.
vi.mock('../../src/integrations/zohoAuth.js', () => ({
  authHeaders: async () => ({ Authorization: 'Zoho-oauthtoken test' }),
  baseUrl: () => 'https://www.zohoapis.com/crm/v8',
  invalidateZohoToken: () => {},
}));
vi.stubGlobal('fetch', fetchMock);

import { assertReadOnlyCoql, getOrg, runCoql } from '../../src/integrations/zohoCrm.js';
import { zohoCrmQueryTool } from '../../src/modules/tools/definitions/zoho_crm_query.js';
import { makeContext } from '../fixtures/seed.js';

function coqlResponse(data: Array<Record<string, unknown>>, info?: { more_records?: boolean; count?: number }) {
  return { ok: true, status: 200, text: async () => JSON.stringify({ data, ...(info ? { info } : {}) }) };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('assertReadOnlyCoql', () => {
  it('accepts a SELECT (any case)', () => {
    expect(assertReadOnlyCoql('  select id from Leads limit 0, 5 ')).toBe('select id from Leads limit 0, 5');
    expect(assertReadOnlyCoql('SELECT Id FROM Leads where id is not null')).toMatch(/^SELECT/);
  });
  it('rejects a non-SELECT statement and chained statements', () => {
    expect(() => assertReadOnlyCoql('update Leads set x=1')).toThrow(/SELECT/i);
    expect(() => assertReadOnlyCoql('select id from Leads; drop table x')).toThrow(/single statement/i);
  });
  it('does NOT false-reject reads whose literals/fields contain write words', () => {
    // /coql is SELECT-only, so these are legitimate reads — the guard must not block them.
    expect(() => assertReadOnlyCoql("select id from Deals where Stage = 'Update Pending'")).not.toThrow();
    expect(() => assertReadOnlyCoql("select id from Leads where Status = 'Merge Complete'")).not.toThrow();
  });
});

describe('zohoCrm.runCoql', () => {
  it('POSTs the query to /coql and returns rows + pagination info', async () => {
    fetchMock.mockResolvedValue(
      coqlResponse([{ id: '1', Email: 'a@b.com' }], { more_records: true, count: 1 }),
    );
    const out = await runCoql('select id, Email from Contacts limit 0, 1');

    expect(out).toEqual({ rows: [{ id: '1', Email: 'a@b.com' }], count: 1, moreRecords: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('https://www.zohoapis.com/crm/v8/coql');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ select_query: 'select id, Email from Contacts limit 0, 1' });
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('treats HTTP 204 as an empty result set', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 204, text: async () => '' });
    const out = await runCoql('select id from Leads where Email = \'none@x.com\'');
    expect(out).toEqual({ rows: [], count: 0, moreRecords: false });
  });

  it('rejects a non-read-only query before any network call', async () => {
    await expect(runCoql('delete from Leads')).rejects.toThrow(/SELECT/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on an HTTP error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'INVALID_QUERY' });
    await expect(runCoql('select bogus from Nope')).rejects.toThrow(/HTTP 400/);
  });
});

describe('zohoCrm.getOrg', () => {
  it('returns the first org profile (snake_case keys)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ org: [{ id: '999', company_name: 'Octane' }] }),
    });
    const org = await getOrg();
    expect(org).toEqual({ id: '999', company_name: 'Octane' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://www.zohoapis.com/crm/v8/org');
  });

  it('returns {} when no org is present', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ org: [] }) });
    expect(await getOrg()).toEqual({});
  });

  it('throws on an HTTP error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'INVALID_OAUTH' });
    await expect(getOrg()).rejects.toThrow(/GET \/org HTTP 401/);
  });
});

describe('zoho_crm.query tool', () => {
  it('returns { count, moreRecords, rows } from the handler', async () => {
    fetchMock.mockResolvedValue(coqlResponse([{ id: '1' }], { more_records: false, count: 1 }));
    const result = await zohoCrmQueryTool.handler(
      { select_query: 'select id from Leads limit 0, 1' },
      makeContext({ role: 'admin' }),
    );
    expect(result).toEqual({ count: 1, moreRecords: false, rows: [{ id: '1' }] });
  });
});
