/**
 * The worklist lane matrix.
 *
 * `laneFor` is the whole of Today: which cases surface, and in which lane. It is pure precisely
 * so this file can cover every branch without Postgres — the repo around it does five bounded
 * reads and then defers to this function, so a bug here is a bug in the desk's judgement rather
 * than in a query.
 */
import { describe, expect, it } from 'vitest';
import {
  DESK_POLICY,
  agingBand,
  daysBetween,
  isAgencyDue,
  laneFor,
  riskScore,
  type WorklistSignals,
} from '../../src/modules/collection/deskPolicy.js';
import { scheduleDates } from '../../src/repos/collectionPlanRepo.js';

function signals(over: Partial<WorklistSignals> = {}): WorklistSignals {
  return {
    daysPastDue: 45,
    remaining: 2_000,
    stage: 'connected',
    daysSinceContact: 3,
    daysSinceOpened: 60,
    promise: null,
    plan: null,
    agencyReturned: false,
    settled: false,
    ...over,
  };
}

describe('laneFor', () => {
  it('leaves a freshly worked, small, in-progress case alone', () => {
    expect(laneFor(signals())).toBeNull();
  });

  it('puts a missed instalment above everything else', () => {
    const lane = laneFor(
      signals({
        plan: { missed: 1, paid: 3, total: 8 },
        promise: { amount: 2_400, daysLate: 3 },
        agencyReturned: true,
        daysSinceContact: 90,
      }),
    );
    expect(lane).toBe('plan_broken');
  });

  it('surfaces a promise on the day it falls due, not before', () => {
    expect(laneFor(signals({ promise: { amount: 900, daysLate: 0 } }))).toBe('promise_due');
    expect(laneFor(signals({ promise: { amount: 900, daysLate: -1 } }))).toBeNull();
  });

  it('a running plan with nothing missed is not a lane', () => {
    expect(laneFor(signals({ plan: { missed: 0, paid: 2, total: 6 } }))).toBeNull();
  });

  it('flags a case the agency handed back', () => {
    expect(laneFor(signals({ agencyReturned: true }))).toBe('agency_returned');
  });

  it('asks for sign-off once the balance reaches zero', () => {
    expect(laneFor(signals({ settled: true, remaining: 0 }))).toBe('payment_posted');
  });

  it('needs BOTH agency gates, not either', () => {
    // Old enough, too small.
    expect(laneFor(signals({ daysPastDue: 200, remaining: 900, daysSinceContact: 1 }))).toBeNull();
    // Big enough, too young — and outside the warning window.
    expect(laneFor(signals({ daysPastDue: 30, remaining: 40_000, daysSinceContact: 1 }))).toBeNull();
    // Both.
    expect(laneFor(signals({ daysPastDue: 200, remaining: 40_000 }))).toBe('agency_threshold');
  });

  it('warns inside the window before the day threshold', () => {
    const nearly = DESK_POLICY.agencyMinDaysPastDue - DESK_POLICY.agencyWarnWindowDays + 1;
    expect(laneFor(signals({ daysPastDue: nearly, remaining: 40_000 }))).toBe('agency_threshold');
    expect(laneFor(signals({ daysPastDue: nearly - 5, remaining: 40_000, daysSinceContact: 1 }))).toBeNull();
  });

  it('never re-offers a case that is already with the agency or closed', () => {
    for (const stage of ['with_agency', 'closed_successfully', 'case_lost']) {
      expect(isAgencyDue({ daysPastDue: 400, remaining: 90_000, stage })).toBe(false);
      expect(laneFor(signals({ stage, daysPastDue: 400, remaining: 90_000, daysSinceContact: 1 }))).toBeNull();
    }
  });

  it('calls out an intake nobody has phoned', () => {
    expect(laneFor(signals({ daysSinceContact: null, daysSinceOpened: 5 }))).toBe('new_intake');
    // Handed off this morning: not yet anyone's failure.
    expect(laneFor(signals({ daysSinceContact: null, daysSinceOpened: 0 }))).toBeNull();
  });

  it('calls out a case that has gone quiet', () => {
    expect(laneFor(signals({ daysSinceContact: DESK_POLICY.silentAfterDays }))).toBe('silent');
    expect(laneFor(signals({ daysSinceContact: DESK_POLICY.silentAfterDays - 1 }))).toBeNull();
  });
});

describe('riskScore', () => {
  it('orders by money at stake before lane urgency', () => {
    const big = riskScore('silent', signals({ remaining: 50_000, daysPastDue: 200 }));
    const small = riskScore('plan_broken', signals({ remaining: 500, daysPastDue: 200 }));
    expect(big).toBeGreaterThan(small);
  });

  it('breaks a money tie on the lane', () => {
    const s = signals({ remaining: 10_000, daysPastDue: 100 });
    expect(riskScore('plan_broken', s)).toBeGreaterThan(riskScore('silent', s));
  });

  it('never returns zero for a case with no recorded debt', () => {
    expect(riskScore('silent', signals({ remaining: 0, daysPastDue: 0 }))).toBeGreaterThan(0);
  });
});

describe('agingBand', () => {
  it('maps each band edge to the band it opens', () => {
    expect(agingBand(0)).toBe(0);
    expect(agingBand(29)).toBe(0);
    expect(agingBand(30)).toBe(1);
    expect(agingBand(89)).toBe(1);
    expect(agingBand(90)).toBe(2);
    expect(agingBand(179)).toBe(2);
    expect(agingBand(180)).toBe(3);
    expect(agingBand(4000)).toBe(3);
  });
});

describe('daysBetween', () => {
  it('is negative for a date in the future', () => {
    const now = new Date('2026-08-19T12:00:00Z');
    expect(daysBetween(new Date('2026-08-12T12:00:00Z'), now)).toBe(7);
    expect(daysBetween(new Date('2026-08-26T12:00:00Z'), now)).toBe(-7);
  });
});

describe('scheduleDates', () => {
  it('steps a monthly plan by calendar month', () => {
    expect(scheduleDates('2026-09-02', 3, 'monthly')).toEqual([
      '2026-09-02',
      '2026-10-02',
      '2026-11-02',
    ]);
  });

  it('clamps a month-end start into a short month instead of rolling into the next one', () => {
    expect(scheduleDates('2026-01-31', 3, 'monthly')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
  });

  it('steps fortnightly and weekly plans by days', () => {
    expect(scheduleDates('2026-08-19', 3, 'fortnightly')).toEqual([
      '2026-08-19',
      '2026-09-02',
      '2026-09-16',
    ]);
    expect(scheduleDates('2026-08-19', 3, 'weekly')).toEqual([
      '2026-08-19',
      '2026-08-26',
      '2026-09-02',
    ]);
  });
});
