/**
 * Marketing's "No Tier" is active clients only.
 *
 * The rule is one predicate, and it is worth pinning because it is easy to "simplify" into either of
 * two wrong things: dropping every dormant carrier (which would delete earned tiers from the roster
 * and hide churn), or dropping nobody (which is what it replaced). Both look reasonable in a diff.
 *
 * The definition of active is deliberately the loyalty program's own track basis — at least one card
 * transacting in the previous calendar month, the same window `resolveTierForRow` scores against —
 * so Marketing's No Tier is exactly "was trading, has not earned a tier".
 */
import { describe, expect, it } from 'vitest';

import type { LoyaltyClient } from '../../../api/loyalty';
import { countsForMarketing } from './LoyaltyCard';

type Bucket = 'enterprise' | 'gold' | 'silver' | 'bronze' | 'building' | 'idle';

/** Only the two fields the predicate reads; the rest of LoyaltyClient is irrelevant here. */
const row = (bucket: Bucket, activeCardsPrevMonth: number) =>
  ({ bucket, client: { activeCardsPrevMonth } as LoyaltyClient }) as Parameters<
    typeof countsForMarketing
  >[0];

describe('the No Tier bucket', () => {
  it('keeps a carrier that transacted last month', () => {
    expect(countsForMarketing(row('idle', 1))).toBe(true);
  });

  it('drops a carrier that transacted nothing last month', () => {
    expect(countsForMarketing(row('idle', 0))).toBe(false);
  });

  it('drops a carrier whose previous-month count is missing entirely', () => {
    // An absent field is not evidence of activity. Treating `undefined` as active would quietly
    // restore the old behaviour for any carrier the roster query could not measure.
    const missing = { bucket: 'idle', client: {} as LoyaltyClient } as Parameters<
      typeof countsForMarketing
    >[0];
    expect(countsForMarketing(missing)).toBe(false);
  });
});

describe('every other bucket is untouched', () => {
  it.each<Bucket>(['enterprise', 'gold', 'silver', 'bronze', 'building'])(
    'keeps a dormant %s carrier',
    (bucket) => {
      // `lastTier` is retained through a dormant month BY DESIGN. A gold carrier that went quiet is
      // the single most interesting row on this screen — losing it would hide a churn signal, which
      // is the opposite of what filtering the roster is for.
      expect(countsForMarketing(row(bucket, 0))).toBe(true);
    },
  );

  it.each<Bucket>(['enterprise', 'gold', 'silver', 'bronze', 'building'])(
    'keeps an active %s carrier',
    (bucket) => {
      expect(countsForMarketing(row(bucket, 12))).toBe(true);
    },
  );
});

describe('the distribution adds up', () => {
  it('leaves a filtered roster whose buckets sum to the filtered total', () => {
    // The defect this guards: `total` used to be the SERVER's roster count. Filtering the scored
    // rows without moving the denominator makes every percentage understate and the tiles describe
    // a roster the grid cannot show.
    const roster = [
      row('gold', 40),
      row('silver', 0), // dormant but tiered — stays
      row('idle', 3), // active, untiered — stays
      row('idle', 0), // dormant, untiered — dropped
      row('idle', 0), // dropped
      row('building', 0), // stays
    ];
    const kept = roster.filter(countsForMarketing);
    expect(kept).toHaveLength(4);
    expect(roster.length - kept.length).toBe(2);
  });
});
