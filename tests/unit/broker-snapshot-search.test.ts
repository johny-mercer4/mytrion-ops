/**
 * Data Center Broker Snapshot search — DWH `stg_broker_snapshot`, one key per call.
 *
 * Assertions pin the QUERY TEXT: there is no MC column, name is a prefix via `left(lower(...))`
 * (not `ILIKE %foo%`), and every read is `is_active` + LIMIT. A DWH miss is `{ available: false }`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { configured: true };
const query = vi.fn();

vi.mock('../../src/integrations/dwh.js', () => ({
  dwh: {
    isConfigured: () => state.configured,
    query: (...args: unknown[]) => query(...args),
  },
}));

const { searchBrokerSnapshot } = await import(
  '../../src/modules/verificationFlow/brokerSnapshotSearch.js'
);
const { BROKER_SNAPSHOT_SEARCH_LIMIT } = await import(
  '../../src/repos/dwhBrokerSnapshotRepo.js'
);

const ROW = {
  id: '16079457811075937970',
  dot_number: '8844425',
  owner_full_name: 'Abdirehin Ahmed',
  add_date: new Date('2024-01-15T00:00:00.000Z'),
  change_date: new Date('2026-08-01T00:00:00.000Z'),
  operating_status: 'AUTHORIZED FOR PROPERTY',
  physical_address: '1 Main St',
  phone_number: '6145550110',
  email: 'owner@example.com',
  truck_size: 2,
  power_units: 3,
  airflow_inserted_at: new Date('2026-08-20T12:00:00.000Z'),
  is_active: true,
  valid_from: new Date('2024-01-15T00:00:00.000Z'),
  valid_to: null,
  row_hash: 'abc',
  sk: '542539',
};

beforeEach(() => {
  state.configured = true;
  query.mockReset();
  query.mockResolvedValue([ROW]);
});

describe('searchBrokerSnapshot', () => {
  it('looks up an active row by exact USDOT and returns every column', async () => {
    const out = await searchBrokerSnapshot({ by: 'dot', q: '8844425' });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/select \*/i);
    expect(sql).toMatch(/from public\.stg_broker_snapshot/i);
    expect(sql).toMatch(/dot_number = \$1::bigint/);
    expect(sql).toMatch(/is_active/);
    expect(sql).not.toMatch(/\bmc\b/i);
    expect(params).toEqual(['8844425', BROKER_SNAPSHOT_SEARCH_LIMIT]);
    expect(out.available).toBe(true);
    expect(out.matchedOn).toBe('dot');
    expect(out.notFound).toBe(false);
    expect(out.records[0]?.ownerFullName).toBe('Abdirehin Ahmed');
    expect(out.records[0]?.fields?.row_hash).toBe('abc');
    expect(out.records[0]?.fields?.sk).toBe('542539');
    expect(out.records[0]?.fields?.email).toBe('owner@example.com');
    expect(out.records[0]?.fields?.valid_to).toBeNull();
  });

  it('searches owner name as a prefix, not a contains scan', async () => {
    const out = await searchBrokerSnapshot({ by: 'name', q: 'Abdirehin' });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/left\(lower\(owner_full_name\), length\(\$1\)\) = lower\(\$1\)/);
    expect(sql).not.toMatch(/%foo%|ilike/i);
    expect(sql).toMatch(/limit \$2/i);
    expect(params).toEqual(['Abdirehin', BROKER_SNAPSHOT_SEARCH_LIMIT]);
    expect(out.matchedOn).toBe('name');
    expect(out.records[0]?.dotNumber).toBe('8844425');
  });

  it('treats % in the typed name as a literal, not a wildcard', async () => {
    await searchBrokerSnapshot({ by: 'name', q: '100%_inc' });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toMatch(/ilike/i);
    expect(params[0]).toBe('100%_inc');
  });

  it('does not query for a name shorter than the min length', async () => {
    const out = await searchBrokerSnapshot({ by: 'name', q: 'ab' });
    expect(query).not.toHaveBeenCalled();
    expect(out.available).toBe(true);
    expect(out.notFound).toBe(true);
    expect(out.records).toEqual([]);
  });

  it('is a miss when the warehouse returns no rows', async () => {
    query.mockResolvedValue([]);
    const out = await searchBrokerSnapshot({ by: 'dot', q: '111111' });
    expect(out.available).toBe(true);
    expect(out.notFound).toBe(true);
    expect(out.records).toEqual([]);
  });

  it('is unavailable when DWH is not configured', async () => {
    state.configured = false;
    const out = await searchBrokerSnapshot({ by: 'dot', q: '8844425' });
    expect(query).not.toHaveBeenCalled();
    expect(out.available).toBe(false);
    expect(out.error).toMatch(/DWH_DATABASE_URL/);
  });

  it('is unavailable when the warehouse throws', async () => {
    query.mockRejectedValue(new Error('connection refused'));
    const out = await searchBrokerSnapshot({ by: 'dot', q: '8844425' });
    expect(out.available).toBe(false);
    expect(out.error).toMatch(/connection refused/);
  });

  it('marks the page truncated at the LIMIT', async () => {
    query.mockResolvedValue(Array.from({ length: BROKER_SNAPSHOT_SEARCH_LIMIT }, (_, i) => ({
      ...ROW,
      id: `row-${i}`,
    })));
    const out = await searchBrokerSnapshot({ by: 'name', q: 'John' });
    expect(out.truncated).toBe(true);
    expect(out.records).toHaveLength(BROKER_SNAPSHOT_SEARCH_LIMIT);
  });
});
