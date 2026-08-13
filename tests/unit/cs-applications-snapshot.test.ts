/**
 * csApplicationsQuery.ts (the Zoho drain layer) and applicationsSnapshotCache.ts (the dedicated
 * SWR cache) — stubbed-fetch pattern matches tests/unit/coql-paginate.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('../../src/integrations/zohoAuth.js', () => ({
  authHeaders: async () => ({ Authorization: 'Zoho-oauthtoken test' }),
  baseUrl: () => 'https://www.zohoapis.com/crm/v8',
  invalidateZohoToken: () => {},
}));
vi.stubGlobal('fetch', fetchMock);

const { drainApplications, drainDeals, resolveOwnerNames } = await import(
  '../../src/integrations/csApplicationsQuery.js'
);
const {
  getApplicationsSnapshot,
  invalidateApplicationsSnapshot,
  patchApplicationsSnapshotRow,
} = await import('../../src/lib/applicationsSnapshotCache.js');

function coqlOk(data: Array<Record<string, unknown>>, info?: { more_records?: boolean }) {
  return { ok: true, status: 200, text: async () => JSON.stringify({ data, ...(info ? { info } : {}) }) };
}

function queryOf(call: unknown): string {
  const body = JSON.parse((call as [unknown, { body: string }])[1].body) as { select_query: string };
  return body.select_query;
}

describe('drainApplications', () => {
  beforeEach(() => fetchMock.mockReset());

  it('walks pages and terminates on a short page, ordered by id', async () => {
    fetchMock
      .mockResolvedValueOnce(coqlOk([{ id: '1', Application_ID: 100, Name: 'A' }], { more_records: true }))
      .mockResolvedValueOnce(coqlOk([], { more_records: false }));

    const res = await drainApplications();

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.Application_ID).toBe(100);
    expect(res.truncated).toBe(false);
    expect(queryOf(fetchMock.mock.calls[0])).toMatch(/order by id asc/i);
    expect(queryOf(fetchMock.mock.calls[0])).toMatch(/from Applications/i);
  });

  it('coerces booleans/numbers and nulls out blanks', async () => {
    fetchMock.mockResolvedValueOnce(
      coqlOk([{ id: '1', Application_ID: 100, Verified: true, Number_of_Trucks: 3, Name: '' }], {
        more_records: false,
      }),
    );

    const res = await drainApplications();
    expect(res.rows[0]).toMatchObject({ Verified: true, Number_of_Trucks: 3, Name: null });
  });
});

describe('drainDeals', () => {
  beforeEach(() => fetchMock.mockReset());

  it('keys enrichment by Application_ID and queries only Deals with one set', async () => {
    fetchMock.mockResolvedValueOnce(
      coqlOk(
        [{ Application_ID: 901986, Owner: { id: '1', name: 'Mamurov' }, Payment_Type_Billing: 'ACH', Loves_Verification: null }],
        { more_records: false },
      ),
    );

    const res = await drainDeals();

    expect(queryOf(fetchMock.mock.calls[0])).toMatch(/from Deals where Application_ID is not null/i);
    expect(res.byApplicationId.get(901986)).toEqual({
      owner: { id: '1', name: 'Mamurov' },
      Payment_Type_Billing: 'ACH',
      Loves_Verification: null,
    });
  });

  it('skips a Deal with no Owner rather than crashing', async () => {
    fetchMock.mockResolvedValueOnce(coqlOk([{ Application_ID: 5, Owner: null }], { more_records: false }));
    const res = await drainDeals();
    expect(res.byApplicationId.get(5)?.owner).toBeNull();
  });
});

describe('resolveOwnerNames', () => {
  beforeEach(() => fetchMock.mockReset());

  it('skips the Users API round-trip when there is nothing to resolve', async () => {
    const result = await resolveOwnerNames([]);
    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('overlays the full display name for an active user (AllUsers + DeactiveUsers both queried)', async () => {
    // listUsersForNameResolution queries type=AllUsers then type=DeactiveUsers — resolve with the
    // SAME user on both calls; the id-based dedup means this is harmless either way.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ users: [{ id: '1', full_name: 'Islombek Mamurov', email: 'i@x.com' }] }),
    });

    const result = await resolveOwnerNames([{ id: '1', name: 'Mamurov' }]);
    expect(result.get('1')).toBe('Islombek Mamurov');
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('type=DeactiveUsers'))).toBe(true);
  });

  it('overlays a DEACTIVATED owner\'s name too — this is exactly why listActiveUsers() alone is not enough', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ users: [] }) }) // AllUsers: not found
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ users: [{ id: '1', full_name: 'Fady El Hage' }] }), // DeactiveUsers: found
      });

    const result = await resolveOwnerNames([{ id: '1', name: '' }]);
    expect(result.get('1')).toBe('Fady El Hage');
  });

  it('keeps the raw name when the owner is found nowhere or the API fails', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ users: [] }) });
    const result = await resolveOwnerNames([{ id: '1', name: 'Mamurov' }]);
    expect(result.get('1')).toBe('Mamurov');

    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const result2 = await resolveOwnerNames([{ id: '1', name: 'Mamurov' }]);
    expect(result2.get('1')).toBe('Mamurov');
  });
});

describe('applicationsSnapshotCache', () => {
  it('serves a cache hit within TTL without calling the loader again', async () => {
    const loader = vi.fn(async () => ({ rows: [{ id: '1' }], truncated: false }));
    await getApplicationsSnapshot('t1', loader);
    await getApplicationsSnapshot('t1', loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('force bypasses the cache and rebuilds', async () => {
    const loader = vi.fn(async () => ({ rows: [{ id: '1' }], truncated: false }));
    await getApplicationsSnapshot('t2', loader);
    await getApplicationsSnapshot('t2', loader, { force: true });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('is tenant-scoped — a different tenant never shares another tenant\'s snapshot', async () => {
    const loaderA = vi.fn(async () => ({ rows: [{ id: 'a' }], truncated: false }));
    const loaderB = vi.fn(async () => ({ rows: [{ id: 'b' }], truncated: false }));
    const a = await getApplicationsSnapshot('tenant-a', loaderA);
    const b = await getApplicationsSnapshot('tenant-b', loaderB);
    expect(a.data.rows).toEqual([{ id: 'a' }]);
    expect(b.data.rows).toEqual([{ id: 'b' }]);
  });

  it('patchApplicationsSnapshotRow mutates the cached row in place without a reload', async () => {
    const loader = vi.fn(async () => ({ rows: [{ id: '1', name: 'old' }], truncated: false }));
    await getApplicationsSnapshot('t3', loader);

    const patched = patchApplicationsSnapshotRow<{ id: string; name: string }>(
      't3',
      (rows) => rows.find((r) => r.id === '1'),
      (row) => {
        row.name = 'new';
      },
    );
    expect(patched).toBe(true);

    const after = await getApplicationsSnapshot('t3', loader);
    expect(after.data.rows[0]).toEqual({ id: '1', name: 'new' });
    expect(loader).toHaveBeenCalledTimes(1); // patch didn't force a reload
  });

  it('patchApplicationsSnapshotRow is a no-op (returns false) when nothing is cached yet', () => {
    const patched = patchApplicationsSnapshotRow<{ id: string }>(
      'never-loaded-tenant',
      (rows) => rows.find((r) => r.id === '1'),
      () => undefined,
    );
    expect(patched).toBe(false);
  });

  it('invalidateApplicationsSnapshot forces the next call to rebuild', async () => {
    const loader = vi.fn(async () => ({ rows: [{ id: '1' }], truncated: false }));
    await getApplicationsSnapshot('t4', loader);
    invalidateApplicationsSnapshot('t4');
    await getApplicationsSnapshot('t4', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
