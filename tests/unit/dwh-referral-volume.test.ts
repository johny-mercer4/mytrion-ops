import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dwhQueryMock } = vi.hoisted(() => ({
  dwhQueryMock: vi.fn(),
}));

vi.mock('../../src/integrations/dwh.js', () => ({
  dwhQuery: dwhQueryMock,
}));

import { fetchReferralVolumeSets } from '../../src/integrations/dwhReferralVolume.js';

beforeEach(() => dwhQueryMock.mockReset());

describe('batched referral volume', () => {
  it('returns every fuel-code set from one bound MART query', async () => {
    dwhQueryMock.mockResolvedValue([
      {
        carrier_id: '123',
        gallons_0: '100',
        cumulative_gallons_0: '500',
        swipes_0: '2',
        gallons_1: '125',
        cumulative_gallons_1: '550',
        swipes_1: '3',
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

  it('counts distinct in-month cards, not lifetime first-cards or transactions', async () => {
    dwhQueryMock.mockResolvedValue([]);
    await fetchReferralVolumeSets([1], '2026-08-01', [{ key: 'legacy', fuelCodes: ['ULSD'] }]);
    const sql = String(dwhQueryMock.mock.calls[0]?.[0]);
    expect(sql).toContain('count(distinct e.card_number)');
    expect(sql).not.toMatch(/new_cards|first_dt|transaction_id/);
  });
});
