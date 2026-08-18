import { describe, expect, it } from 'vitest';
import {
  appendSwipeParentCarrierTargets,
  resolveReferralTargets,
  type ReferralChildSource,
  type ReferralDealSource,
  type ReferralParentSource,
} from '../../src/modules/manager/referralResolution.js';

const parent: ReferralParentSource = {
  id: 'P1',
  referrerId: 'REF-000322',
  name: 'AL AZIZ EXPRESS INC',
  calculation: 'Swipes (Legacy)',
  dealId: null,
};

const child: ReferralChildSource = {
  id: 'C1',
  referrerId: 'REF-000322',
  parentLookupId: 'P1',
  name: 'Logixpress',
  calculation: null,
  paid: false,
  parentPaid: false,
};

const deal: ReferralDealSource = {
  id: 'D1',
  name: 'Logixpress',
  carrierId: 5804841,
  parentLookupId: 'P1',
  childLookupId: 'C1',
};

describe('swipe parent fleet rollup', () => {
  it('adds the unique parent carrier next to the child deal for swipes only', () => {
    const { targets } = resolveReferralTargets([parent], [child], [deal]);
    const withParent = appendSwipeParentCarrierTargets(
      targets,
      new Map([['AL AZIZ EXPRESS INC', 5789458]]),
    );

    expect(targets.map((target) => target.carrierId)).toEqual([5804841]);
    expect(targets.every((target) => target.role === 'child')).toBe(true);
    expect(withParent.map((target) => target.carrierId)).toEqual([5804841, 5789458]);
    expect(withParent.map((target) => target.role)).toEqual(['child', 'parent_itself']);
    expect(withParent.every((target) => target.bonusType === 'swipes_legacy')).toBe(true);
  });

  it('does not add a parent fleet carrier to gallons-legacy child deals', () => {
    const gallonsParent = { ...parent, calculation: 'Gallons (Legacy)', name: 'YILKI LLC' };
    const { targets } = resolveReferralTargets([gallonsParent], [child], [
      { ...deal, carrierId: 5774938 },
    ]);
    const withParent = appendSwipeParentCarrierTargets(
      targets,
      new Map([['YILKI LLC', 5764487]]),
    );
    expect(withParent.map((target) => target.carrierId)).toEqual([5774938]);
  });
});
