import { describe, expect, it } from 'vitest';
import {
  resolveProjectedTierForRow,
  resolveSegment,
  resolveTier,
  resolveTierForRow,
  resolveTrack,
  resolveTrackCards,
  tierBucketOf,
  tierRewards,
} from './loyalty';

describe('Loyalty Tiers v3 track model', () => {
  it('uses previous-month transacting cards and never the account card total or trucks', () => {
    expect(resolveTrackCards({ activeCardsPrevMonth: 3, activeCardsThisMonth: 8 })).toBe(3);
    expect(
      resolveTierForRow({
        activeCardsPrevMonth: 3,
        activeCardsThisMonth: 8,
        inNetworkGallonsPrevMonth: 3200,
      }),
    ).toMatchObject({
      track: 'T2',
      trackLabel: 'Small Company',
      level: 'silver',
      fleetSize: 3,
      fleetSizeKnown: true,
    });
  });

  it('implements every active-card boundary, including Enterprise at 12+', () => {
    expect(resolveTrack(0)).toBeNull();
    expect(resolveTrack(1)).toBe('T1');
    expect(resolveTrack(2)).toBe('T2');
    expect(resolveTrack(3)).toBe('T2');
    expect(resolveTrack(4)).toBe('T3');
    expect(resolveTrack(11)).toBe('T3');
    expect(resolveTrack(12)).toBe('enterprise');
    expect(resolveTrack(67)).toBe('enterprise');

    expect(resolveSegment(4)).toBe('small');
    expect(resolveSegment(7)).toBe('medium');
    expect(resolveSegment(9)).toBe('large');
    expect(resolveSegment(11)).toBe('fleet');
    expect(resolveSegment(12)).toBeNull();
  });
});

describe('closed-month tier evaluation', () => {
  it('uses exact T1 and T2 thresholds with no near-threshold upgrade', () => {
    expect(resolveTier(1, 1099.99).level).toBe('none');
    expect(resolveTier(1, 1100).level).toBe('bronze');
    expect(resolveTier(1, 1500).level).toBe('silver');
    expect(resolveTier(1, 2000).level).toBe('gold');

    expect(resolveTier(3, 2199.99).level).toBe('none');
    expect(resolveTier(3, 2200).level).toBe('bronze');
    expect(resolveTier(3, 3000).level).toBe('silver');
    expect(resolveTier(3, 4500).level).toBe('gold');
  });

  it('uses the normative T3 segment thresholds', () => {
    expect(resolveTier(4, 6500)).toMatchObject({ segment: 'small', level: 'silver' });
    expect(resolveTier(7, 9000)).toMatchObject({ segment: 'medium', level: 'silver' });
    expect(resolveTier(9, 19000)).toMatchObject({ segment: 'large', level: 'gold' });
    expect(resolveTier(11, 13500)).toMatchObject({ segment: 'fleet', level: 'silver' });
    expect(resolveTier(11, 23000)).toMatchObject({ segment: 'fleet', level: 'gold' });
  });

  it('does not apply the removed grace mechanism', () => {
    const result = resolveTier(1, 1850, { heldLastMonth: 'gold' });
    expect(result).toMatchObject({ level: 'silver', grace: false });
  });

  it('routes 12+ active cards to Enterprise without automatic gallon tiers', () => {
    expect(resolveTier(12, 50000)).toMatchObject({
      track: 'enterprise',
      status: 'enterprise',
      level: 'none',
      thresholds: null,
    });
  });

  it('uses the manager-entered Enterprise Gold target without inventing Bronze or Silver', () => {
    expect(
      resolveTier(12, 22999, {
        enterpriseMode: 'volume_target',
        enterpriseGoldTargetGallons: 23000,
      }),
    ).toMatchObject({
      track: 'enterprise',
      status: 'enterprise',
      level: 'none',
      enterpriseState: 'target_set',
      gallonsToNext: 1,
    });
    expect(
      resolveTier(12, 23000, {
        enterpriseMode: 'volume_target',
        enterpriseGoldTargetGallons: 23000,
      }),
    ).toMatchObject({
      track: 'enterprise',
      status: 'gold',
      level: 'gold',
      enterpriseState: 'gold',
      gallonsToNext: 0,
    });
  });

  it('keeps manual reward exceptions separate from the tier calculation', () => {
    const rewards = tierRewards('bronze', ['loves_rebate']);
    expect(rewards.filter((reward) => reward.active).map((reward) => reward.id)).toEqual([
      'loves_rebate',
    ]);
    expect(resolveTier(1, 1100).level).toBe('bronze');
  });
});

describe('M → M+1 status timing', () => {
  it('uses only closed previous-month in-network gallons for the active tier', () => {
    const result = resolveTierForRow({
      activeCardsPrevMonth: 1,
      activeCardsThisMonth: 5,
      inNetworkGallonsPrevMonth: 1600,
      inNetworkGallonsThisMonth: 12000,
    });
    expect(result).toMatchObject({
      track: 'T1',
      level: 'silver',
      status: 'silver',
      gallons: 1600,
      basis: 'closed_month',
    });
  });

  it('marks a new or returning current-month client as Building', () => {
    const result = resolveTierForRow({
      activeCardsPrevMonth: 0,
      activeCardsThisMonth: 4,
      inNetworkGallonsThisMonth: 7000,
    });
    expect(result).toMatchObject({
      status: 'building',
      level: 'none',
      track: 'T3',
      segment: 'small',
      basis: 'calibration',
    });
    expect(tierBucketOf(result)).toBe('building');
  });

  it('distinguishes evaluated No Tier from Building', () => {
    const evaluated = resolveTierForRow({
      activeCardsPrevMonth: 1,
      activeCardsThisMonth: 1,
      inNetworkGallonsPrevMonth: 900,
    });
    expect(evaluated).toMatchObject({ status: 'no_tier', basis: 'closed_month' });
    expect(tierBucketOf(evaluated)).toBe('idle');
  });

  it('retains the stored status during a fully dormant month', () => {
    expect(
      resolveTierForRow({
        activeCardsPrevMonth: 0,
        activeCardsThisMonth: 0,
        lastTierName: 'Gold',
      }),
    ).toMatchObject({ status: 'gold', level: 'gold', basis: 'stored' });
  });

  it('calculates this month separately as the next evaluation projection', () => {
    expect(
      resolveProjectedTierForRow({
        activeCardsThisMonth: 3,
        inNetworkGallonsThisMonth: 4600,
      }),
    ).toMatchObject({ track: 'T2', level: 'gold', gallons: 4600 });
  });
});
