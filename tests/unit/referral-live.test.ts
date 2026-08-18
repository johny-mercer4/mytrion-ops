import { beforeEach, describe, expect, it, vi } from 'vitest';

const { volumeMock, claimsMock, parentCarrierMock, records } = vi.hoisted(() => ({
  volumeMock: vi.fn(),
  claimsMock: vi.fn(),
  parentCarrierMock: vi.fn(async () => new Map<string, number>()),
  records: {
    parents: {
      module: 'Parent_Referrers',
      moduleKey: 'parents' as const,
      fields: [],
      rows: [
        {
          id: 'P1',
          ReferrerId: 'REF-000322',
          Name: 'AL AZIZ EXPRESS INC',
          Company_Name: 'AL AZIZ EXPRESS INC',
          Calculation: 'Swipes (Legacy)',
          Deal_Id: null,
        },
        {
          id: 'P2',
          ReferrerId: 'REF-000197',
          Name: 'YILKI LLC',
          Calculation: 'Gallons (Legacy)',
          Deal_Id: null,
        },
      ],
      total: 2,
      truncated: false,
      pages: 1,
    },
    children: {
      module: 'Child_Referrals',
      moduleKey: 'children' as const,
      fields: [],
      rows: [
        {
          id: 'C1',
          Referrer_ID: 'REF-000322',
          Parent_Referrer: { id: 'P1' },
          Name: 'Logixpress',
          Calculation: null,
          Paid: false,
          Parent_Paid: false,
        },
        {
          id: 'C2',
          Referrer_ID: 'REF-000197',
          Parent_Referrer: { id: 'P2' },
          Name: 'Yilki child',
          Calculation: null,
          Paid: false,
          Parent_Paid: false,
        },
      ],
      total: 2,
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
            Deal_Name: 'Logixpress',
            Carrier_ID: 5804841,
            Parent_Referrer: { id: 'P1' },
            Child_Referrer: { id: 'C1' },
          },
          {
            id: 'D2',
            Deal_Name: 'Yilki deal',
            Carrier_ID: 5774938,
            Parent_Referrer: { id: 'P2' },
            Child_Referrer: { id: 'C2' },
          },
        ],
        total: 2,
        truncated: false,
        pages: 1,
      },
    },
  },
}));

vi.mock('../../src/modules/manager/referralRecords.js', () => ({
  fetchReferralCalculationRecords: async () => records,
}));

vi.mock('../../src/integrations/dwhReferralVolume.js', () => ({
  fetchReferralVolumeSets: volumeMock,
  fetchReferralParentCarriers: parentCarrierMock,
}));

vi.mock('../../src/repos/referralBonusRepo.js', () => ({
  referralBonusRepo: { listOneTimeClaims: claimsMock },
}));

import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { fetchReferralLiveByReferrer } from '../../src/modules/manager/referralLive.js';
import { resetReferralWorkspaceCache } from '../../src/modules/manager/referralWorkspace.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const ctx: TenantContext = {
  tenantId: DEFAULT_TENANT_ID,
  userId: 'system',
  audience: 'internal',
  role: 'admin',
  scopes: ['*'],
  departments: [],
  allDepartmentAccess: true,
  requestId: 'req_referral_live_api',
};

beforeEach(() => {
  resetReferralWorkspaceCache();
  claimsMock.mockReset();
  claimsMock.mockResolvedValue([]);
  parentCarrierMock.mockReset();
  parentCarrierMock.mockResolvedValue(new Map([['AL AZIZ EXPRESS INC', 5789458]]));
  volumeMock.mockReset();
  volumeMock.mockImplementation(async (carriers: number[], _month: string, sets) => {
    const byCarrier = new Map([
      [5804841, { carrierId: 5804841, gallons: 0, swipes: 2, cumulativeGallons: 0 }],
      [5789458, { carrierId: 5789458, gallons: 0, swipes: 6, cumulativeGallons: 0 }],
      [5774938, { carrierId: 5774938, gallons: 24916, swipes: 0, cumulativeGallons: 24916 }],
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
});

describe('single-referrer live calculation', () => {
  it('returns parent + child rows and only fetches that parent’s carriers', async () => {
    const result = await fetchReferralLiveByReferrer(ctx, 'REF-000322', '2026-07-01', '2026-07-31');

    expect(result).toMatchObject({
      referrerId: 'REF-000322',
      calculation: 'Swipes (Legacy)',
      calculationKey: 'swipes_legacy',
      bonusAmountUsd: '400.00',
      activity: { kind: 'swipes', label: 'New swipes', value: 8 },
    });
    expect(result.rows.map((row) => ({ role: row.role, carrierId: row.carrierId, swipes: row.periodSwipes }))).toEqual(
      [
        { role: 'child', carrierId: 5804841, swipes: 2 },
        { role: 'parent_itself', carrierId: 5789458, swipes: 6 },
      ],
    );
    expect(volumeMock.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([5804841, 5789458]));
    expect(volumeMock.mock.calls[0]?.[0]).not.toContain(5774938);
    expect(parentCarrierMock).toHaveBeenCalledWith(['AL AZIZ EXPRESS INC']);
  });

  it('404s an unknown ReferrerId without reading MART', async () => {
    await expect(
      fetchReferralLiveByReferrer(ctx, 'REF-MISSING', '2026-07-01', '2026-07-31'),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(volumeMock).not.toHaveBeenCalled();
  });
});
