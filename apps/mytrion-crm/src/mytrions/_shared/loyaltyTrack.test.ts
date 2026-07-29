/**
 * Loyalty Tiers v3 — the two axes, and the 10% grace band.
 *
 * Since 2026-07-29 the axes are separate: TRUCKS bucket the track (1 truck = Owner-Operator) while
 * fuel activity gates program membership. The deck's "System counts active cards (>=1 transaction
 * previous month)" still defines membership; its card count is no longer the bucketer. Grace is
 * unchanged: "1-month grace if within 10%".
 *
 * NOTE on the older blocks below: they pass literal numbers as `resolveTier`'s first argument, which is
 * now a FLEET SIZE. The arithmetic is identical so they still hold, but read them as trucks.
 */
import { describe, expect, it } from 'vitest';
import {
  resolveFleetSize,
  resolveSegment,
  resolveTier,
  resolveTierForRow,
  resolveTrack,
  resolveTrackCards,
} from './loyalty';

describe('resolveTrackCards — the program-membership gate (and the fallback bucketer)', () => {
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


describe('owner-operator means exactly ONE TRUCK (2026-07-29 rule change)', () => {
  it('scores a 1-truck carrier running 21 cards as Owner-Operator, not Fleet', () => {
    // Carrier 5810474 RAWDEAL LOGISTICS LLC, from the live DWH: trucks 1, 21 transacting cards last
    // month, 29,539 gal. The card proxy put it in T3 Fleet; one truck is one truck.
    const t = resolveTierForRow({ trucks: 1, activeCardsPrevMonth: 21, gallonsThisMonth: 29_539 });
    expect(t.track).toBe('T1');
    expect(t.trackLabel).toBe('Owner-Operator');
    expect(t.segment).toBeNull();
    expect(t.fleetSize).toBe(1);
    expect(t.fleetSizeKnown).toBe(true);
  });

  it('does NOT call a 12-truck fleet an owner-operator just because one card transacted', () => {
    const t = resolveTierForRow({ trucks: 12, activeCardsPrevMonth: 1, gallonsThisMonth: 14_612 });
    expect(t.track).toBe('T3');
    expect(t.segment).toBe('fleet');
  });

  it('keeps a 1-truck carrier with NO fuel activity out of the program entirely', () => {
    // The load-bearing case. A bare `trucks === 1` swap would hand these a T1 track and flood
    // "Building" with ~2,975 dormant carriers — the exact symptom the 2026-07-28 fix removed.
    const t = resolveTierForRow({ trucks: 1, activeCardsPrevMonth: 0, activeCardsThisMonth: 0, gallonsThisMonth: 0 });
    expect(t.track).toBeNull();
    expect(t.level).toBe('none');
  });

  it('activity alone cannot grant a track when there are no gallons and no cards', () => {
    expect(resolveTierForRow({ trucks: 4, activeCardsPrevMonth: 0, activeCardsThisMonth: 0 }).track).toBeNull();
  });

  it('falls back to the card proxy when the truck count is unknown, and says so', () => {
    // ~184 carriers have a null Trucks field; 19 of them hold a live track (one at 9,259 gal).
    for (const trucks of [null, undefined, 0, -1, 1.5, Number.NaN]) {
      const t = resolveTierForRow({ trucks, activeCardsPrevMonth: 3, gallonsThisMonth: 3200 });
      expect(t.track, `trucks=${String(trucks)}`).toBe('T2');
      expect(t.fleetSizeKnown, `trucks=${String(trucks)}`).toBe(false);
      expect(t.fleetSize, `trucks=${String(trucks)}`).toBe(3);
    }
  });

  it('treats only a positive integer as a known fleet size', () => {
    expect(resolveFleetSize({ trucks: 1 })).toBe(1);
    expect(resolveFleetSize({ trucks: 12 })).toBe(12);
    expect(resolveFleetSize({ trucks: 0 })).toBeNull();
    expect(resolveFleetSize({ trucks: -3 })).toBeNull();
    expect(resolveFleetSize({ trucks: 2.5 })).toBeNull();
    expect(resolveFleetSize({ trucks: null })).toBeNull();
    expect(resolveFleetSize({})).toBeNull();
  });

  it('the ladder is total: every fleet size lands in exactly one track (and one segment at 4+)', () => {
    for (let fleet = 1; fleet <= 30; fleet += 1) {
      const track = resolveTrack(fleet);
      const matches = ['T1', 'T2', 'T3'].filter((t) => t === track);
      expect(matches, `fleet=${fleet}`).toHaveLength(1);
      const segment = resolveSegment(fleet);
      if (fleet < 4) expect(segment, `fleet=${fleet}`).toBeNull();
      else expect(segment, `fleet=${fleet}`).not.toBeNull();
      if (fleet >= 13) expect(segment, `fleet=${fleet}`).toBe('fleet'); // capped, incl. the 2,024 outlier
    }
    expect(resolveTrack(1)).toBe('T1');
    expect(resolveTrack(2)).toBe('T2');
    expect(resolveTrack(3)).toBe('T2');
    expect(resolveTrack(4)).toBe('T3');
  });
});
