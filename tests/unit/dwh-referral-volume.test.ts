import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dwhQueryMock } = vi.hoisted(() => ({
  dwhQueryMock: vi.fn(),
}));

vi.mock('../../src/integrations/dwh.js', () => ({
  dwhQuery: dwhQueryMock,
}));

import {
  fetchReferralParentCarriers,
  fetchReferralVolume,
  fetchReferralVolumeSets,
} from '../../src/integrations/dwhReferralVolume.js';

beforeEach(() => dwhQueryMock.mockReset());

describe('batched referral volume', () => {
  it('returns every fuel-code set from one bound MART query', async () => {
    dwhQueryMock.mockResolvedValue([
      {
        carrier_id: '123',
        gallons_0: '100',
        cumulative_gallons_0: '500',
        swipes_0: 2,
        gallons_1: '125',
        cumulative_gallons_1: '550',
        swipes_1: 3,
      },
    ]);

    const result = await fetchReferralVolumeSets([123], '2026-07-01', [
      { key: 'legacy', fuelCodes: ['ULSD', 'ULSR'] },
      { key: 'new', fuelCodes: ['ULSD', 'ULSR', 'DSL'] },
    ]);

    expect(dwhQueryMock).toHaveBeenCalledTimes(1);
    expect(dwhQueryMock.mock.calls[0]?.[1]).toEqual([
      [123],
      '2026-07-01',
      '2026-07-31',
      ['ULSD', 'ULSR'],
      ['ULSD', 'ULSR', 'DSL'],
      ['ULSD', 'ULSR', 'DSL'],
    ]);
    expect(result.get('legacy')?.get(123)).toEqual({
      carrierId: 123,
      gallons: 100,
      cumulativeGallons: 500,
      swipes: 2,
    });
    expect(result.get('new')?.get(123)?.gallons).toBe(125);
  });

  it('counts first-use cards in the window, not peak-to-date monthly distinct cards', async () => {
    dwhQueryMock.mockResolvedValue([]);
    await fetchReferralVolumeSets([5804841], '2026-07-01', [
      { key: 'legacy', fuelCodes: ['ULSD', 'ULSR'] },
    ]);
    const sql = String(dwhQueryMock.mock.calls[0]?.[0]);
    expect(sql).toContain('min(transaction_date) as first_dt');
    expect(sql).toContain('first_use_0');
    expect(sql).toContain('f.first_dt >= $2::date');
    expect(sql).not.toContain('date_trunc');
    expect(sql).not.toMatch(/new_cards|transaction_id|jsonb_object_agg/);
  });

  it('filters In Station gallons only and leaves swipe first-use unfiltered by network', async () => {
    dwhQueryMock.mockResolvedValue([]);
    await fetchReferralVolumeSets(
      [5774938, 5776791, 5797270],
      '2026-07-01',
      [{ key: 'legacy', fuelCodes: ['ULSD'] }],
      { from: '2026-07-01', to: '2026-07-31' },
    );
    const sql = String(dwhQueryMock.mock.calls[0]?.[0]);
    expect(sql).toContain('is_in_network is true as in_station');
    expect(sql).toContain('and e.in_station');
    expect(sql).toMatch(/sum\(e\.gal\) filter \(\s*where e\.fuel_code[\s\S]*and e\.in_station/);
    const firstUseCte = sql.slice(sql.indexOf('first_use_0 as'), sql.indexOf('select e.carrier_id'));
    expect(firstUseCte).toContain('min(transaction_date) as first_dt');
    expect(firstUseCte).not.toContain('in_station');
  });

  it('builds first-use history with no eligible lower date bound', async () => {
    dwhQueryMock.mockResolvedValue([]);
    await fetchReferralVolumeSets([1], '2026-08-01', [{ key: 'legacy', fuelCodes: ['ULSD'] }]);
    const sql = String(dwhQueryMock.mock.calls[0]?.[0]);
    const eligibleCte = sql.slice(sql.indexOf('with eligible as'), sql.indexOf('first_use_'));

    expect(sql).toContain("transaction_date < ($3::date + interval '1 day')");
    expect(eligibleCte).not.toMatch(/transaction_date >= /);
    expect(sql).toContain('card_number is not null');
  });

  it('clips gallons and first-use to the requested days', async () => {
    dwhQueryMock.mockResolvedValue([]);
    await fetchReferralVolumeSets(
      [1],
      '2026-08-01',
      [{ key: 'legacy', fuelCodes: ['ULSD'] }],
      { from: '2026-08-01', to: '2026-08-16' },
    );
    const sql = String(dwhQueryMock.mock.calls[0]?.[0]);
    expect(dwhQueryMock.mock.calls[0]?.[1]?.slice(0, 3)).toEqual([
      [1],
      '2026-08-01',
      '2026-08-16',
    ]);
    expect(sql).toContain('e.transaction_date >= $2::date');
    expect(sql).toContain('f.first_dt >= $2::date');
    expect(sql).toContain("f.first_dt < ($3::date + interval '1 day')");
  });

  it('references every bound parameter so Postgres can infer types', async () => {
    dwhQueryMock.mockResolvedValue([]);
    await fetchReferralVolumeSets([1], '2026-07-01', [{ key: 'legacy', fuelCodes: ['ULSD'] }]);
    const sql = String(dwhQueryMock.mock.calls[0]?.[0]);
    const params = dwhQueryMock.mock.calls[0]?.[1] as unknown[];
    expect(params.length).toBeGreaterThan(0);
    for (let i = 1; i <= params.length; i += 1) {
      expect(sql).toContain(`$${i}`);
    }
  });
});

describe('single-set referral volume', () => {
  it('uses the same first-use count so the engine path matches the workspace', async () => {
    dwhQueryMock.mockResolvedValue([
      {
        carrier_id: '123',
        gallons: '0',
        cumulative_gallons: '0',
        swipes: 8,
      },
    ]);

    const result = await fetchReferralVolume([123], '2026-07-01', ['ULSD', 'ULSR']);
    expect(result.get(123)?.swipes).toBe(8);
    const sql = String(dwhQueryMock.mock.calls[0]?.[0]);
    expect(sql).toContain('first_use');
    expect(sql).toContain('and e.in_station');
    expect(sql).not.toMatch(/transaction_date >= \$3::date\s+and\s+e\.transaction_date/);
  });
});

describe('parent fleet name lookup', () => {
  it('returns a carrier only when the company name maps to exactly one id', async () => {
    dwhQueryMock.mockResolvedValue([
      { company_name: 'AL AZIZ EXPRESS INC', carrier_id: '5789458' },
      { company_name: 'AL AZIZ EXPRESS INC', carrier_id: 5789458 },
      { company_name: 'SPLIT FLEET', carrier_id: '1' },
      { company_name: 'SPLIT FLEET', carrier_id: '2' },
    ]);

    const result = await fetchReferralParentCarriers([
      'AL AZIZ EXPRESS INC',
      'SPLIT FLEET',
      'MISSING CO',
    ]);
    expect(result).toEqual(new Map([['AL AZIZ EXPRESS INC', 5789458]]));
  });
});
