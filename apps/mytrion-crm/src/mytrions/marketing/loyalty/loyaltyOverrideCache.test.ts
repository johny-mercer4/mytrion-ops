import { beforeEach, describe, expect, it } from 'vitest';
import type { LoyaltyClientOverride, LoyaltyRoster } from '../../../api/loyalty';
import { invalidateSwrCache, readSwrCache, writeSwrCache } from '../../_shared/swrCache';
import { MANAGER_LOYALTY_CACHE_KEY, propagateLoyaltyOverride } from './loyaltyOverrideCache';

const override: LoyaltyClientOverride = {
  carrierId: '123',
  enterpriseMode: null,
  enterpriseGoldTargetGallons: null,
  enabledRewardIds: ['loves_rebate'],
  note: 'Approved exception',
  updatedBy: 'Manager',
  updatedAt: '2026-07-31T12:00:00.000Z',
};

beforeEach(() => {
  invalidateSwrCache(MANAGER_LOYALTY_CACHE_KEY);
  invalidateSwrCache('sales:clients:');
});

describe('loyalty override cache propagation', () => {
  it('patches Manager immediately and invalidates every owner-scoped Sales roster', () => {
    writeSwrCache<LoyaltyRoster>(MANAGER_LOYALTY_CACHE_KEY, {
      clients: [
        {
          carrierId: '123', companyName: 'Acme', agentName: 'Agent', trucks: 1, activeCards: 1,
          lastTierName: '', activeCardsThisMonth: 1, activeCardsPrevMonth: 1,
          gallonsThisMonth: 1200, inNetworkGallonsThisMonth: 1200, cycleGallons: 1200,
          gallonsPrevMonth: 1200, inNetworkGallonsPrevMonth: 1200, computedIsActive: true,
          loyaltyOverride: null,
        },
      ],
      total: 1,
      fetchedAt: '2026-07-31T11:00:00.000Z',
    });
    writeSwrCache('sales:clients:self', ['old']);
    writeSwrCache('sales:clients:agent-42', ['old']);

    propagateLoyaltyOverride('123', override);

    expect(readSwrCache<LoyaltyRoster>(MANAGER_LOYALTY_CACHE_KEY)?.data.clients[0])
      .toMatchObject({ loyaltyOverride: override });
    expect(readSwrCache('sales:clients:self')).toBeNull();
    expect(readSwrCache('sales:clients:agent-42')).toBeNull();
  });

  it('also propagates a reset back to the automatic program', () => {
    writeSwrCache<LoyaltyRoster>(MANAGER_LOYALTY_CACHE_KEY, {
      clients: [{
        carrierId: '123', companyName: 'Acme', agentName: 'Agent', trucks: 1, activeCards: 1,
        lastTierName: '', activeCardsThisMonth: 1, activeCardsPrevMonth: 1,
        gallonsThisMonth: 1200, inNetworkGallonsThisMonth: 1200, cycleGallons: 1200,
        gallonsPrevMonth: 1200, inNetworkGallonsPrevMonth: 1200, computedIsActive: true,
        loyaltyOverride: override,
      }],
      total: 1,
      fetchedAt: '2026-07-31T11:00:00.000Z',
    });

    propagateLoyaltyOverride('123', null);

    expect(readSwrCache<LoyaltyRoster>(MANAGER_LOYALTY_CACHE_KEY)?.data.clients[0]?.loyaltyOverride)
      .toBeNull();
  });
});
