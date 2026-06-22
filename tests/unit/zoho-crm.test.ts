import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

// Auth + base URL are the wrapper's job; mock them so we exercise zohoCrm's request/parse logic.
vi.mock('../../src/integrations/wrapper.js', () => ({
  authHeaders: async () => ({ Authorization: 'Zoho-oauthtoken test' }),
  baseUrl: () => 'https://www.zohoapis.com/crm/v8',
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
  it('accepts a SELECT', () => {
    expect(assertReadOnlyCoql('  select id from Leads limit 0, 5 ')).toBe('select id from Leads limit 0, 5');
  });
  it('rejects non-SELECT, chained statements, and write keywords', () => {
    expect(() => assertReadOnlyCoql('update Leads set x=1')).toThrow(/SELECT/i);
    expect(() => assertReadOnlyCoql('select id from Leads; drop table x')).toThrow(/single statement/i);
    expect(() => assertReadOnlyCoql('select id from Leads where delete = 1')).toThrow(/write keyword/i);
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
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.zohoapis.com/crm/v8/coql');
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
  it('returns the first org profile', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ org: [{ id: '999', company_name: 'Octane' }] }),
    });
    const org = await getOrg();
    expect(org).toMatchObject({ id: '999', company_name: 'Octane' });
    expect((fetchMock.mock.calls[0]?.[0] as string)).toBe('https://www.zohoapis.com/crm/v8/org');
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
