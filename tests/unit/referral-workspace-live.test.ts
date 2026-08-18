import { beforeEach, describe, expect, it, vi } from 'vitest';

const { volumeMock, claimsMock, parentCalculation, parentCarrierMock } = vi.hoisted(() => ({
  volumeMock: vi.fn(),
  claimsMock: vi.fn(),
  parentCalculation: { value: 'Gallons (Legacy)' },
  parentCarrierMock: vi.fn(async () => new Map<string, number>()),
}));

vi.mock('../../src/modules/manager/referralRecords.js', () => ({
  fetchReferralCalculationRecords: async () => ({
    parents: {
      module: 'Parent_Referrers',
      moduleKey: 'parents',
      fields: [],
      rows: [
        {
          id: 'P1',
          ReferrerId: 'REF-1',
          Name: 'Parent Co',
          Calculation: parentCalculation.value,
          Deal_Id: null,
        },
      ],
      total: 1,
      truncated: false,
      pages: 1,
    },
    children: {
      module: 'Child_Referrals',
      moduleKey: 'children',
      fields: [],
      rows: [
        {
          id: 'C1',
          Referrer_ID: 'REF-1',
          Parent_Referrer: { id: 'P1' },
          Name: 'Child Co',
          Calculation: null,
          Paid: false,
          Parent_Paid: false,
        },
      ],
      total: 1,
      truncated: false,
      pages: 1,
    },
    associations: {
      leads: { module: 'Leads', fields: [], rows: [], total: 0, truncated: false, pages: 0 },
      deals: {
        module: 'Deals',
        fields: [],
        rows: [
          {
            id: 'D1',
            Deal_Name: 'Child Deal',
            Carrier_ID: 123,
            Parent_Referrer: { id: 'P1' },
            Child_Referrer: { id: 'C1' },
          },
        ],
        total: 1,
        truncated: false,
        pages: 1,
      },
    },
  }),
}));

vi.mock('../../src/integrations/dwhReferralVolume.js', () => ({
  fetchReferralVolumeSets: volumeMock,
  fetchReferralParentCarriers: parentCarrierMock,
}));

vi.mock('../../src/repos/referralBonusRepo.js', () => ({
  referralBonusRepo: { listOneTimeClaims: claimsMock },
}));

import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import {
  fetchReferralWorkspace,
  resetReferralWorkspaceCache,
} from '../../src/modules/manager/referralWorkspace.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const ctx: TenantContext = {
  tenantId: DEFAULT_TENANT_ID,
  userId: 'admin_1',
  audience: 'internal',
  role: 'admin',
  scopes: ['*'],
  departments: ['management'],
  allDepartmentAccess: true,
  requestId: 'req_referral_live',
};

beforeEach(() => {
  resetReferralWorkspaceCache();
  parentCalculation.value = 'Gallons (Legacy)';
  claimsMock.mockReset();
  claimsMock.mockResolvedValue([]);
  parentCarrierMock.mockReset();
  parentCarrierMock.mockResolvedValue(new Map());
  volumeMock.mockReset();
  volumeMock.mockImplementation(async (_carriers, periodMonth: string, sets) => {
    const gallons = periodMonth === '2026-05-01' ? 100 : 999;
    return new Map(
      sets.map((set: { key: string }) => [
        set.key,
        new Map([[123, { carrierId: 123, gallons, swipes: 4, cumulativeGallons: gallons }]]),
      ]),
    );
  });
});

describe('selected-month referral calculation', () => {
  it('recalculates every selected month live and scopes one-time claims through that month', async () => {
    const may = await fetchReferralWorkspace(ctx, '2026-05-01');
    const june = await fetchReferralWorkspace(ctx, '2026-06-01');

    expect(may.previews[0]).toMatchObject({ periodGallons: 100, amountUsd: '1.00' });
    expect(june.previews[0]).toMatchObject({ periodGallons: 999, amountUsd: '9.99' });
    expect(may).toMatchObject({
      periodMonth: '2026-05-01',
      periodFrom: '2026-05-01',
      periodTo: '2026-05-31',
    });
    expect(volumeMock.mock.calls.map((call) => call[1])).toEqual(['2026-05-01', '2026-06-01']);
    expect(volumeMock.mock.calls[0]?.[3]).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    expect(claimsMock.mock.calls.map((call) => call[1])).toEqual(['2026-05-31', '2026-06-30']);
  });

  it('sums recurring monthly calcs across an inclusive from/to range', async () => {
    const range = await fetchReferralWorkspace(ctx, '2026-05-01', { periodTo: '2026-06-01' });

    expect(range).toMatchObject({
      periodMonth: '2026-06-01',
      periodFrom: '2026-05-01',
      periodTo: '2026-06-01',
    });
    expect(range.previews[0]).toMatchObject({
      periodGallons: 1099,
      amountUsd: '10.99',
      payableAmountUsd: '10.99',
    });
    expect(range.previews[0]?.months).toEqual([
      expect.objectContaining({ periodMonth: '2026-05-01', periodGallons: 100, amountUsd: '1.00' }),
      expect.objectContaining({ periodMonth: '2026-06-01', periodGallons: 999, amountUsd: '9.99' }),
    ]);
    expect(volumeMock.mock.calls.map((call) => call[1])).toEqual(['2026-05-01', '2026-06-01']);
    expect(claimsMock.mock.calls.map((call) => call[1])).toEqual(['2026-06-01']);
  });

  it('sums first-use swipes across a range without recounting a card', async () => {
    parentCalculation.value = 'Swipes (Legacy)';
    volumeMock.mockImplementation(async (_carriers, periodMonth: string, sets) => {
      const swipes = periodMonth === '2026-04-01' ? 2 : 1;
      return new Map(
        sets.map((set: { key: string }) => [
          set.key,
          new Map([[123, { carrierId: 123, gallons: 0, swipes, cumulativeGallons: 0 }]]),
        ]),
      );
    });

    const range = await fetchReferralWorkspace(ctx, '2026-04-01', { periodTo: '2026-05-01' });

    expect(range.previews[0]).toMatchObject({
      bonusType: 'swipes_legacy',
      periodSwipes: 3,
      amountUsd: '150.00',
      payableAmountUsd: '150.00',
    });
    expect(range.summary.payableAmountUsd).toBe('150.00');
    expect(range.previews[0]?.months).toEqual([
      expect.objectContaining({
        periodMonth: '2026-04-01',
        periodSwipes: 2,
        amountUsd: '100.00',
      }),
      expect.objectContaining({
        periodMonth: '2026-05-01',
        periodSwipes: 1,
        amountUsd: '50.00',
      }),
    ]);
    expect(volumeMock.mock.calls.map((call) => call[1])).toEqual(['2026-04-01', '2026-05-01']);
  });

  it('adds the parent fleet first-use swipes so Al Aziz July is 6 + 2 = 8', async () => {
    parentCalculation.value = 'Swipes (Legacy)';
    parentCarrierMock.mockResolvedValue(new Map([['Parent Co', 5789458]]));
    volumeMock.mockImplementation(async (carriers: number[], _periodMonth: string, sets) => {
      const byCarrier = new Map([
        [123, { carrierId: 123, gallons: 0, swipes: 2, cumulativeGallons: 0 }],
        [5789458, { carrierId: 5789458, gallons: 0, swipes: 6, cumulativeGallons: 0 }],
      ]);
      return new Map(
        sets.map((set: { key: string }) => [
          set.key,
          new Map(
            carriers.map((id) => [
              id,
              byCarrier.get(id) ?? { carrierId: id, gallons: 0, swipes: 0, cumulativeGallons: 0 },
            ]),
          ),
        ]),
      );
    });

    const july = await fetchReferralWorkspace(ctx, '2026-07-01', { periodTo: '2026-07-31' });
    const swipes = july.previews.reduce((sum, preview) => sum + preview.periodSwipes, 0);
    const bonus = july.previews.reduce((sum, preview) => sum + Number(preview.amountUsd), 0);

    expect(volumeMock.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([123, 5789458]));
    expect(july.previews).toHaveLength(2);
    expect(july.previews.map((preview) => preview.role)).toEqual(['child', 'parent_itself']);
    expect(july.previews.map((preview) => preview.carrierId)).toEqual([123, 5789458]);
    expect(swipes).toBe(8);
    expect(bonus).toBe(400);
    expect(july.summary.connectedCarriers).toBe(2);
  });

  it('does not add the parent fleet to gallons-legacy child deal totals', async () => {
    parentCarrierMock.mockResolvedValue(new Map([['Parent Co', 5764487]]));

    const july = await fetchReferralWorkspace(ctx, '2026-07-01', { periodTo: '2026-07-31' });

    expect(july.previews).toHaveLength(1);
    expect(july.previews[0]).toMatchObject({ carrierId: 123, periodGallons: 999 });
    expect(volumeMock.mock.calls[0]?.[0]).toEqual([123]);
  });

  it('clips each overlapping month to the requested days when calling MART', async () => {
    await fetchReferralWorkspace(ctx, '2026-07-15', { periodTo: '2026-08-20' });

    expect(volumeMock.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      ['2026-07-01', { from: '2026-07-15', to: '2026-07-31' }],
      ['2026-08-01', { from: '2026-08-01', to: '2026-08-20' }],
    ]);
  });

  it('evaluates a one-time award once through the range end, not once per month', async () => {
    parentCalculation.value = 'Gallons (Parent)';
    volumeMock.mockImplementation(async (_carriers, _periodMonth: string, sets) => {
      return new Map(
        sets.map((set: { key: string }) => [
          set.key,
          new Map([[123, { carrierId: 123, gallons: 100, swipes: 0, cumulativeGallons: 600 }]]),
        ]),
      );
    });

    const range = await fetchReferralWorkspace(ctx, '2026-05-01', { periodTo: '2026-06-01' });

    expect(range.previews[0]).toMatchObject({
      bonusType: 'gallons_parent',
      amountUsd: '50.00',
      payableAmountUsd: '50.00',
      cumulativeGallons: 600,
    });
    expect(range.summary.payableAmountUsd).toBe('50.00');
  });
});
