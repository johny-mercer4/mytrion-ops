/**
 * Loyalty Tiers v3 — the track basis and the 10% grace band.
 *
 * Pinned against the deck, which is explicit: "System counts active cards (>=1 transaction previous
 * month) on 1st of each month", and "1-month grace if within 10%".
 */
import { describe, expect, it } from 'vitest';
import { resolveTier, resolveTierForRow, resolveTrackCards } from './loyalty';

describe('resolveTrackCards — what the track is scored against', () => {
  it('uses PREVIOUS-month transacting cards, not the account total', () => {
    // The bug this fixes: 20 cards issued, 12 "active" on the account, but only 3 trucks fuelled.
    expect(resolveTrackCards({ activeCardsPrevMonth: 3, activeCardsThisMonth: 2 })).toBe(3);
  });

  it('falls back to THIS month only when there is no previous month', () => {
    // A carrier that started fuelling mid-month has no prior count; scoring them as "no cards" for
    // their entire first month would drop them out of the program.
    expect(resolveTrackCards({ activeCardsPrevMonth: 0, activeCardsThisMonth: 4 })).toBe(4);
  });

  it('never falls back to the account total — plastic with no pumps is not an active card', () => {
    expect(resolveTrackCards({ activeCardsPrevMonth: 0, activeCardsThisMonth: 0 })).toBe(0);
    expect(resolveTier(resolveTrackCards({}), 5000).track).toBeNull();
  });
});

describe('the reported symptom: clients wrongly stuck in Building', () => {
  it('a 3-truck company with 20 issued cards is scored T2, not Fleet', () => {
    const before = resolveTier(20, 3200); // old behaviour: account total → T3 fleet, bronze 10,000
    const after = resolveTier(resolveTrackCards({ activeCardsPrevMonth: 3 }), 3200);
    expect(before.level).toBe('none'); // "Building" despite 3,200 gal on three trucks
    expect(after.trackLabel).toBe('Small Company');
    expect(after.level).toBe('silver'); // T2: bronze 2,200 / silver 3,000
  });

  it('a genuine 12-truck fleet is still scored as Fleet', () => {
    const t = resolveTier(resolveTrackCards({ activeCardsPrevMonth: 12 }), 14611.96);
    expect(t.segmentLabel).toBe('Fleet');
    expect(t.level).toBe('silver');
  });
});

describe('10% grace — a retention rule, never a promotion', () => {
  it('keeps last month’s tier when this month lands within 10% below it', () => {
    // T1 gold = 2,000 → the grace floor is 1,800. Held gold last month, pumped 1,850 this month.
    const t = resolveTier(1, 1850, { heldLastMonth: 'gold' });
    expect(t.level).toBe('gold');
    expect(t.grace).toBe(true);
  });

  it('does NOT grant a tier the client never held — grace only prevents a drop', () => {
    // Same 1,850 gallons, but they were Silver last month: they earn Silver, not a graced Gold.
    // This is the distinction that matters — treating the band as a discount would move every
    // threshold down 10% permanently.
    const t = resolveTier(1, 1850, { heldLastMonth: 'silver' });
    expect(t.level).toBe('silver');
    expect(t.grace).toBe(false);
  });

  it('does not block a promotion', () => {
    const t = resolveTier(1, 2100, { heldLastMonth: 'silver' });
    expect(t.level).toBe('gold');
    expect(t.grace).toBe(false);
  });

  it('lets the tier drop once the shortfall exceeds 10%', () => {
    // 1,700 is below the 1,800 gold floor → the drop to earned Silver stands.
    const t = resolveTier(1, 1700, { heldLastMonth: 'gold' });
    expect(t.level).toBe('silver');
    expect(t.grace).toBe(false);
  });

  it('with no history there is nothing to grace', () => {
    expect(resolveTier(1, 1850)).toMatchObject({ level: 'silver', grace: false });
  });
});

describe('resolveTierForRow — the single entry point both surfaces use', () => {
  it('scores the track on prev-month cards and the level on this-month gallons', () => {
    const t = resolveTierForRow({
      activeCardsPrevMonth: 3,
      activeCardsThisMonth: 3,
      gallonsThisMonth: 3200,
      gallonsPrevMonth: 3100,
      cycleGallons: 0,
    });
    expect(t.trackLabel).toBe('Small Company');
    expect(t.level).toBe('silver'); // T2 silver = 3,000
  });

  it('falls back to cycle gallons before any pumps land this month', () => {
    const t = resolveTierForRow({ activeCardsPrevMonth: 1, gallonsThisMonth: 0, cycleGallons: 2100 });
    expect(t.gallons).toBe(2100);
    expect(t.level).toBe('gold');
  });

  it('graces a client whose previous month earned a higher tier', () => {
    // Prev month 2,050 on 1 card = Gold; this month 1,850 is within 10% of the 2,000 bar.
    const t = resolveTierForRow({
      activeCardsPrevMonth: 1,
      gallonsThisMonth: 1850,
      gallonsPrevMonth: 2050,
    });
    expect(t.level).toBe('gold');
    expect(t.grace).toBe(true);
  });
});
