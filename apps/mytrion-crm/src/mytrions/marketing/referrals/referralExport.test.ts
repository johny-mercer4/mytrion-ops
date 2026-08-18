import { describe, expect, it } from 'vitest';
import type { ReferralCardModel } from './referralModel';
import { buildReferralExportRows } from './referralExport';

const readyCard: ReferralCardModel = {
  id: 'P1',
  parent: {},
  children: [],
  deals: [],
  leads: [],
  calculation: 'Gallons (Legacy)',
  referrerId: 'REF-1',
  name: 'Parent One',
  company: 'Company One',
  payableAmount: 12.34,
  searchText: '',
  setupState: 'ready',
  previews: [
    {
      parentId: 'P1',
      childId: 'C1',
      dealId: 'D1',
      carrierId: 123,
      parentName: 'Parent One',
      childName: 'Child One',
      dealName: 'Deal One',
      calculation: 'Gallons (Legacy)',
      bonusType: 'gallons_legacy',
      label: 'Legacy gallons',
      recipientKind: 'parent',
      recipientName: 'Parent One',
      fuelCodes: ['ULSD', 'ULSR'],
      recurring: true,
      rateUsd: 0.01,
      thresholdGallons: null,
      periodGallons: 1234,
      periodSwipes: 8,
      cumulativeGallons: 9000,
      amountUsd: '12.34',
      payableAmountUsd: '12.34',
      progressPct: 100,
      state: 'earned',
      ledgerStatus: null,
    },
  ],
};

describe('referral export rows', () => {
  it('exports every calculation and retains parents that still need setup', () => {
    const setupCard: ReferralCardModel = {
      ...readyCard,
      id: 'P2',
      referrerId: 'REF-2',
      name: 'Parent Two',
      calculation: '',
      setupState: 'needs_calculation',
      previews: [],
    };
    const rows = buildReferralExportRows([readyCard, setupCard], '2026-07-01');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      period: '2026-07-01',
      parentReferrerId: 'REF-1',
      carrierId: 123,
      eligibleGallons: 1234,
      uniqueCards: 8,
      calculatedBonusUsd: 12.34,
      payableUsd: 12.34,
    });
    expect(rows[1]).toMatchObject({
      parentReferrerId: 'REF-2',
      setupStatus: 'Needs calculation',
      carrierId: null,
      state: 'setup required',
    });
  });

  it('exports swipe rows as first-use new swipes, not unique cards this month', () => {
    const swipeCard: ReferralCardModel = {
      ...readyCard,
      calculation: 'Swipes (Legacy)',
      previews: [
        {
          ...readyCard.previews[0]!,
          calculation: 'Swipes (Legacy)',
          bonusType: 'swipes_legacy',
          label: 'Swipes (Legacy)',
          rateUsd: 50,
          periodGallons: 0,
          periodSwipes: 1,
          amountUsd: '50.00',
          payableAmountUsd: '50.00',
        },
      ],
    };

    const [row] = buildReferralExportRows([swipeCard], '2026-04-01', '2026-05-01');
    expect(row).toMatchObject({
      rule: '$50 per first-use swipe',
      activityMetric: 'New swipes (first-use cards)',
      activityValue: 1,
      uniqueCards: 1,
      payableUsd: 50,
    });
  });
});
