import { describe, expect, it } from 'vitest';
import type { ReferralWorkspace } from '../../../api/referrals';
import { buildReferralCards, cardMatchesFilter } from './referralModel';

const workspace: ReferralWorkspace = {
  periodMonth: '2026-06-01',
  periodFrom: '2026-06-01',
  periodTo: '2026-06-01',
  generatedAt: '2026-07-01T00:00:00.000Z',
  parents: {
    module: 'Parent_Referrers',
    moduleKey: 'parents',
    fields: [],
    rows: [
      {
        id: 'P1',
        ReferrerId: 'REF-1',
        Name: 'Atlas Partners',
        Company_Name: 'Atlas LLC',
        Calculation: 'Gallons (Legacy)',
      },
      { id: 'P2', ReferrerId: 'REF-2', Name: 'Unset Partner', Calculation: null },
    ],
    total: 2,
    truncated: false,
  },
  children: {
    module: 'Child_Referrals',
    moduleKey: 'children',
    fields: [],
    rows: [
      {
        id: 'C1',
        Referrer_ID: 'REF-1',
        Parent_Referrer: null,
        Name: 'North Star Trucking',
      },
      { id: 'ORPHAN', Referrer_ID: 'MISSING', Name: 'Orphan Carrier' },
    ],
    total: 2,
    truncated: false,
  },
  associations: {
    leads: { module: 'Leads', fields: [], rows: [], total: 0, truncated: false },
    deals: {
      module: 'Deals',
      fields: [],
      rows: [
        {
          id: 'D1',
          Deal_Name: 'North Star Deal',
          Carrier_ID: 5799001,
          Child_Referrer: { id: 'C1', name: 'North Star Trucking' },
          Parent_Referrer: null,
        },
      ],
      total: 1,
      truncated: false,
    },
  },
  previews: [
    {
      parentId: 'P1',
      childId: 'C1',
      dealId: 'D1',
      carrierId: 5799001,
      parentName: 'Atlas Partners',
      childName: 'North Star Trucking',
      dealName: 'North Star Deal',
      calculation: 'Gallons (Legacy)',
      bonusType: 'gallons_legacy',
      label: 'Gallons (Legacy)',
      recipientKind: 'parent',
      recipientName: 'Atlas Partners',
      fuelCodes: ['ULSD', 'ULSR'],
      recurring: true,
      rateUsd: 0.01,
      thresholdGallons: null,
      periodGallons: 1250,
      periodSwipes: 2,
      cumulativeGallons: 5000,
      amountUsd: '12.50',
      payableAmountUsd: '12.50',
      progressPct: 100,
      state: 'earned',
      ledgerStatus: null,
    },
  ],
  unresolvedChildIds: ['ORPHAN'],
  skippedNoCalculationChildIds: [],
  summary: {
    parents: 2,
    configuredParents: 1,
    children: 2,
    relatedDeals: 1,
    connectedCarriers: 1,
    needsDealLink: 1,
    needsCalculation: 0,
    earned: 1,
    tracking: 0,
    paid: 0,
    payableAmountUsd: '12.50',
  },
};

describe('referral card model', () => {
  it('groups child, Deal, and calculation preview under the parent', () => {
    const result = buildReferralCards(workspace);
    const card = result.cards[0]!;
    expect(card.name).toBe('Atlas Partners');
    expect(card.children.map((row) => row.id)).toEqual(['C1']);
    expect(card.deals.map((row) => row.id)).toEqual(['D1']);
    expect(card.previews).toHaveLength(1);
    expect(card.payableAmount).toBe(12.5);
    expect(card.setupState).toBe('ready');
  });

  it('keeps unmatched children visible as an orphan warning', () => {
    expect(buildReferralCards(workspace).orphanChildren.map((row) => row.id)).toEqual(['ORPHAN']);
  });

  it('marks an unset Calculation record as needing setup', () => {
    const card = buildReferralCards(workspace).cards[1]!;
    expect(card.setupState).toBe('needs_calculation');
    expect(cardMatchesFilter(card, 'needs_setup')).toBe(true);
    expect(cardMatchesFilter(card, 'Gallons (Legacy)')).toBe(false);
  });

  it('search text includes nested child and Deal values', () => {
    const card = buildReferralCards(workspace).cards[0]!;
    expect(card.searchText).toContain('north star trucking');
    expect(card.searchText).toContain('5799001');
  });
});
