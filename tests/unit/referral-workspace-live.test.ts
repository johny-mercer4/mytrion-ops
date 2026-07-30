import { beforeEach, describe, expect, it, vi } from 'vitest';

const { volumeMock, claimsMock } = vi.hoisted(() => ({
  volumeMock: vi.fn(),
  claimsMock: vi.fn(),
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
          Calculation: 'Gallons (Legacy)',
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
}));

vi.mock('../../src/repos/referralBonusRepo.js', () => ({
  referralBonusRepo: { listOneTimeClaims: claimsMock },
}));

import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { fetchReferralWorkspace } from '../../src/modules/manager/referralWorkspace.js';
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
  claimsMock.mockReset();
  claimsMock.mockResolvedValue([]);
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
    expect(volumeMock.mock.calls.map((call) => call[1])).toEqual(['2026-05-01', '2026-06-01']);
    expect(claimsMock.mock.calls.map((call) => call[1])).toEqual(['2026-05-01', '2026-06-01']);
  });
});
