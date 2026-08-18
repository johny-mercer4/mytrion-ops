import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReferralCalculationPreview } from '../../../api/referrals';
import { ReferralDetailModal } from './ReferralDetailModal';
import type { ReferralCardModel } from './referralModel';

function preview(
  overrides: Partial<ReferralCalculationPreview> &
    Pick<ReferralCalculationPreview, 'carrierId' | 'dealName' | 'role'>,
): ReferralCalculationPreview {
  return {
    parentId: 'P1',
    childId: 'C1',
    dealId: 'D1',
    parentName: 'AL AZIZ EXPRESS INC',
    childName: 'Logixpress',
    calculation: 'Swipes (Legacy)',
    bonusType: 'swipes_legacy',
    label: 'Swipes (Legacy)',
    recipientKind: 'parent',
    recipientName: 'AL AZIZ EXPRESS INC',
    fuelCodes: ['ULSD', 'ULSR'],
    recurring: true,
    rateUsd: 50,
    thresholdGallons: null,
    periodGallons: 0,
    periodSwipes: 2,
    cumulativeGallons: 0,
    amountUsd: '100.00',
    payableAmountUsd: '100.00',
    progressPct: 100,
    state: 'earned',
    ledgerStatus: null,
    ...overrides,
  };
}

const card: ReferralCardModel = {
  id: 'P1',
  parent: { id: 'P1', Name: 'AL AZIZ EXPRESS INC', ReferrerId: 'REF-000322' },
  children: [],
  deals: [],
  leads: [],
  calculation: 'Swipes (Legacy)',
  referrerId: 'REF-000322',
  name: 'AL AZIZ EXPRESS INC',
  company: 'AL AZIZ EXPRESS INC',
  payableAmount: 400,
  searchText: '',
  setupState: 'ready',
  previews: [
    preview({ carrierId: 5804841, dealName: 'Logixpress', role: 'child', periodSwipes: 2 }),
    preview({
      carrierId: 5789458,
      dealName: 'AL AZIZ EXPRESS INC',
      role: 'parent_itself',
      periodSwipes: 6,
      amountUsd: '300.00',
      payableAmountUsd: '300.00',
    }),
  ],
};

describe('Referral detail modal row badges', () => {
  it('badges child deal and parent-fleet rows from the API role flag', () => {
    render(
      <ReferralDetailModal
        card={card}
        parentFields={[]}
        childFields={[]}
        dealFields={[]}
        periodMonth="2026-07-31"
        periodFrom="2026-07-01"
        periodTo="2026-07-31"
        onClose={() => undefined}
      />,
    );

    const childRow = screen.getByText('Carrier #5804841', { exact: false }).closest('article');
    const parentRow = screen.getByText('Carrier #5789458', { exact: false }).closest('article');
    expect(childRow?.querySelector('.mg-rf-role')?.textContent).toBe('Child');
    expect(parentRow?.querySelector('.mg-rf-role')?.textContent).toBe('Parent Itself');
  });
});
