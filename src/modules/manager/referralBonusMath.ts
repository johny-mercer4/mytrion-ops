import type { ReferralBonusStatus } from '../../db/schema/index.js';
import type { ReferralBonusSpec } from './referralBonusTypes.js';

export interface ReferralVolumeInput {
  gallons: number;
  swipes: number;
  cumulativeGallons: number;
}

export interface ReferralBonusComputation {
  amount: number;
  payableAmount: number;
  qtyGallons: number | null;
  qtySwipes: number | null;
  progressPct: number;
  state: 'tracking' | 'earned' | 'paid';
}

/**
 * Apply one PDF bonus rule to one related Deal/carrier.
 *
 * `alreadyPaid` comes from either the permanent ledger or Zoho's Parent_Paid/Paid flag. A one-time
 * award remains visible as $50 in the Manager detail, but payableAmount becomes zero so it can never
 * be included in a second payout total.
 */
export function computeReferralBonus(
  spec: ReferralBonusSpec,
  volume: ReferralVolumeInput,
  alreadyPaid = false,
): ReferralBonusComputation {
  if (spec.type === 'gallons_legacy') {
    const amount = volume.gallons > 0 ? volume.gallons * spec.rateUsd : 0;
    return {
      amount,
      payableAmount: amount,
      qtyGallons: volume.gallons,
      qtySwipes: null,
      progressPct: amount > 0 ? 100 : 0,
      state: amount > 0 ? 'earned' : 'tracking',
    };
  }

  if (spec.type === 'swipes_legacy') {
    const amount = volume.swipes > 0 ? volume.swipes * spec.rateUsd : 0;
    return {
      amount,
      payableAmount: amount,
      qtyGallons: null,
      qtySwipes: volume.swipes,
      progressPct: amount > 0 ? 100 : 0,
      state: amount > 0 ? 'earned' : 'tracking',
    };
  }

  const threshold = spec.thresholdGallons ?? 0;
  const reached = threshold > 0 && volume.cumulativeGallons >= threshold;
  const amount = reached || alreadyPaid ? spec.rateUsd : 0;
  return {
    amount,
    payableAmount: alreadyPaid ? 0 : amount,
    qtyGallons: volume.gallons,
    qtySwipes: null,
    progressPct:
      threshold > 0 ? Math.min(100, Math.max(0, (volume.cumulativeGallons / threshold) * 100)) : 0,
    state: alreadyPaid ? 'paid' : reached ? 'earned' : 'tracking',
  };
}

/**
 * Every persisted one-time row reserves that carrier/type award, including a voided row. This
 * mirrors the database guard: voiding preserves the audit trail and does not silently make a
 * second $50 award eligible.
 */
export function isClaimedStatus(_status: ReferralBonusStatus): boolean {
  return true;
}
