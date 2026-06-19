import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

// Auth + base URL are the wrapper's job; mock them so we exercise zohoPeople's request/parse logic.
vi.mock('../../src/integrations/wrapper.js', () => ({
  authHeaders: async () => ({ Authorization: 'Zoho-oauthtoken test' }),
  baseUrl: () => 'https://people.zoho.com/api',
}));
vi.stubGlobal('fetch', fetchMock);

import { searchEmployees } from '../../src/integrations/zohoPeople.js';
import { zohoPeopleSearchEmployeesTool } from '../../src/modules/tools/definitions/zoho_people_search_employees.js';
import { makeContext } from '../fixtures/seed.js';

/** Build a forms getRecords response: records = [{ id, fields }]. */
function peopleResponse(records: Array<{ id: string; fields: Record<string, unknown> }>) {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({ response: { status: 0, result: records.map((r) => ({ [r.id]: [r.fields] })) } }),
  };
}

function searchParamsOf(callIndex: number): string {
  const url = fetchMock.mock.calls[callIndex]?.[0] as URL;
  return url.searchParams.get('searchParams') ?? '';
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('zohoPeople.searchEmployees', () => {
  it('fetches all employees (no filters → one call, no searchParams) and flattens records', async () => {
    fetchMock.mockResolvedValue(
      peopleResponse([
        { id: '1', fields: { FirstName: 'Ada', LastName: 'Lovelace' } },
        { id: '2', fields: { FirstName: 'Alan' } },
      ]),
    );
    const out = await searchEmployees();
    expect(out).toEqual([
      { recordId: '1', fields: { FirstName: 'Ada', LastName: 'Lovelace' } },
      { recordId: '2', fields: { FirstName: 'Alan' } },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]?.[0] as URL;
    expect(url.pathname).toBe('/api/forms/employee/getRecords');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('searchParams')).toBeNull();
  });

  it('filters by department (Contains)', async () => {
    fetchMock.mockResolvedValue(peopleResponse([{ id: '9', fields: { Department: 'Sales' } }]));
    await searchEmployees({ department: 'Sales' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(searchParamsOf(0)).toBe("{searchField:'Department',searchOperator:'Contains',searchText:'Sales'}");
  });

  it('single-word name fans out to first + last name (two calls, deduped)', async () => {
    fetchMock
      .mockResolvedValueOnce(peopleResponse([{ id: '1', fields: { FirstName: 'John' } }]))
      .mockResolvedValueOnce(
        peopleResponse([
          { id: '1', fields: { FirstName: 'John' } },
          { id: '2', fields: { LastName: 'Johnson' } },
        ]),
      );
    const out = await searchEmployees({ name: 'John' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(searchParamsOf(0)).toContain("searchField:'FirstName'");
    expect(searchParamsOf(1)).toContain("searchField:'LastName'");
    expect(out.map((e) => e.recordId)).toEqual(['1', '2']); // deduped
  });

  it('two-word name → one call with first AND last (pipe-joined)', async () => {
    fetchMock.mockResolvedValue(peopleResponse([{ id: '1', fields: {} }]));
    await searchEmployees({ name: 'John Doe', department: 'Sales' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sp = searchParamsOf(0);
    expect(sp).toContain("{searchField:'Department',searchOperator:'Contains',searchText:'Sales'}");
    expect(sp).toContain("{searchField:'FirstName',searchOperator:'Contains',searchText:'John'}");
    expect(sp).toContain("{searchField:'LastName',searchOperator:'Contains',searchText:'Doe'}");
    expect(sp.split('|')).toHaveLength(3);
  });

  it('throws on a People error envelope (status != 0)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ response: { status: 1, message: 'No permission' } }),
    });
    await expect(searchEmployees({ name: 'x' })).rejects.toThrow(/No permission/);
  });
});

describe('zoho_people.search_employees tool', () => {
  it('returns { count, employees } from the handler', async () => {
    fetchMock.mockResolvedValue(peopleResponse([{ id: '1', fields: { FirstName: 'Ada' } }]));
    const result = await zohoPeopleSearchEmployeesTool.handler({ limit: 10 }, makeContext({ role: 'admin' }));
    expect(result).toEqual({ count: 1, employees: [{ recordId: '1', fields: { FirstName: 'Ada' } }] });
  });
});
