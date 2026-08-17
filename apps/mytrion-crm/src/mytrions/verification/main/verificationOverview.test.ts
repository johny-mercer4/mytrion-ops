/**
 * The Main page's arithmetic.
 *
 * These assert the two things a credit dashboard cannot get wrong: that a number reflects the rows
 * it claims to describe, and that "nothing has happened yet" stays null rather than becoming a
 * zero that reads as a result. The desk's live data has no decided cases at all, so the
 * no-decisions path is the one that actually ships today.
 */
import { describe, expect, it } from 'vitest';
import type { VerificationCaseRow, VerificationDeskAggregates } from '@/api/verificationFlow';
import { buildOverview, DECISION_SLA_DAYS, TREND_DAYS } from './verificationOverview';

const NOW = Date.parse('2026-08-17T12:00:00.000Z');
const DAY = 86_400_000;

/** `now` minus N days, as the ISO string the API sends. */
const daysAgo = (n: number): string => new Date(NOW - n * DAY).toISOString();

function row(over: Partial<VerificationCaseRow> & { id: string }): VerificationCaseRow {
  return {
    companyName: `Case ${over.id}`,
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    applicantType: 'carrier',
    ein: null,
    mc: null,
    dot: null,
    underwritingRoute: 'octane_internal',
    verificationProcess: true,
    phaseCode: 'p6_credit_banking',
    statusCode: 'in_review',
    trucksCount: null,
    fuelCardsRequested: null,
    requestedLimit: null,
    approvedLimitAmount: null,
    intakeMissing: [],
    submittedAt: daysAgo(1),
    ownerName: 'Daniel Okoye',
    ownerZohoUserId: null,
    closedAt: null,
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    ...over,
  };
}

const AGG: VerificationDeskAggregates = {
  total: 0,
  awaitingSales: 0,
  workable: 0,
  pendingDocs: 0,
  managerReview: 0,
  closed: 0,
};

const build = (
  rows: VerificationCaseRow[],
  aggregates: Partial<VerificationDeskAggregates> = {},
): ReturnType<typeof buildOverview> =>
  buildOverview({ rows, aggregates: { ...AGG, ...aggregates }, now: NOW });

describe('buildOverview', () => {
  it('reads the open and locked counts off the server counters, not the loaded page', () => {
    // Only one row is loaded; the counters describe the whole tenant and must win.
    const overview = build([row({ id: 'a' })], { awaitingSales: 6, workable: 3, total: 9 });
    expect(overview.openCount).toBe(9);
    expect(overview.awaitingSales).toBe(6);
  });

  it('has no median and no exposure until something has actually been decided', () => {
    const overview = build([row({ id: 'a' }), row({ id: 'b' })]);
    expect(overview.medianDaysToDecision).toBeNull();
    expect(overview.approvedExposureWeek).toBe(0);
    expect(overview.decided).toMatchObject({ week: 0, approved: 0, declined: 0, delta: 0 });
    expect(overview.decisions).toEqual([]);
  });

  it('counts this week against last week, and splits approved from declined', () => {
    const overview = build([
      row({ id: 'a', statusCode: 'approved', closedAt: daysAgo(1), approvedLimitAmount: '12000' }),
      row({ id: 'b', statusCode: 'approved', closedAt: daysAgo(3), approvedLimitAmount: '65000' }),
      row({ id: 'c', statusCode: 'declined', closedAt: daysAgo(4) }),
      row({ id: 'd', statusCode: 'approved', closedAt: daysAgo(9), approvedLimitAmount: '5000' }),
    ]);

    expect(overview.decided).toMatchObject({
      week: 3,
      approved: 2,
      declined: 1,
      previousWeek: 1,
      delta: 2,
    });
    // Last week's $5,000 approval is outside the window and must not be added in.
    expect(overview.approvedExposureWeek).toBe(77_000);
  });

  it('measures time to decision from intake completion, not from case creation', () => {
    const overview = build([
      // Sat with Sales for 20 days, decided 2 days after submission. The desk took 2, not 22.
      row({ id: 'a', statusCode: 'approved', createdAt: daysAgo(22), submittedAt: daysAgo(4), closedAt: daysAgo(2) }),
    ]);
    expect(overview.medianDaysToDecision).toBe(2);
  });

  it('ranks a past-SLA locked case above manager review, and says why', () => {
    const overview = build([
      row({ id: 'fresh', createdAt: daysAgo(0), statusCode: 'in_review' }),
      row({ id: 'manager', createdAt: daysAgo(2), statusCode: 'manager_review', requestedLimit: '150000' }),
      row({
        id: 'locked',
        createdAt: daysAgo(9),
        submittedAt: null,
        verificationProcess: false,
        statusCode: 'intake_incomplete',
        intakeMissing: ['ein', 'mc'],
      }),
    ]);

    expect(overview.needsToday.map((n) => n.id)).toEqual(['locked', 'manager', 'fresh']);
    expect(overview.needsToday[0]).toMatchObject({ tone: 'danger', ageDays: 9 });
    expect(overview.needsToday[0]!.why).toBe(
      `9 days waiting on Sales — past the ${DECISION_SLA_DAYS}-day SLA`,
    );
    expect(overview.needsToday[1]!.why).toBe('Manager review — $150,000 requested');
  });

  it('does not claim a case is past SLA on the day it arrives', () => {
    const overview = build([row({ id: 'a', createdAt: daysAgo(DECISION_SLA_DAYS) })]);
    expect(overview.pastSla).toBe(0);
    expect(build([row({ id: 'a', createdAt: daysAgo(DECISION_SLA_DAYS + 1) })]).pastSla).toBe(1);
  });

  it('buckets open cases by age and leaves decided ones out of it', () => {
    const overview = build([
      row({ id: 'a', createdAt: daysAgo(0) }),
      row({ id: 'b', createdAt: daysAgo(3) }),
      row({ id: 'c', createdAt: daysAgo(6) }),
      row({ id: 'd', createdAt: daysAgo(20) }),
      row({ id: 'closed', createdAt: daysAgo(30), closedAt: daysAgo(1), statusCode: 'approved' }),
    ]);
    expect(overview.aging.map((b) => b.count)).toEqual([1, 1, 1, 1]);
  });

  it('places open cases on their phase and flags the ones nobody can move', () => {
    const overview = build([
      row({ id: 'a', phaseCode: 'p1_intake', verificationProcess: false, statusCode: 'intake_incomplete' }),
      row({ id: 'b', phaseCode: 'p6_credit_banking' }),
      row({ id: 'c', phaseCode: 'p6_credit_banking' }),
      row({ id: 'closed', phaseCode: 'p10_decision', closedAt: daysAgo(1), statusCode: 'approved' }),
    ]);

    const byCode = Object.fromEntries(overview.pipeline.map((p) => [p.code, p]));
    expect(overview.pipeline).toHaveLength(10);
    expect(byCode.p1_intake).toMatchObject({ count: 1, blocked: true, order: 1, label: 'Intake' });
    expect(byCode.p6_credit_banking).toMatchObject({ count: 2, blocked: false });
    // A decided case has left the queue; the phase it ended on must not still show it.
    expect(byCode.p10_decision).toMatchObject({ count: 0, blocked: false });
  });

  it('returns one trend point per day, each measuring its own tile', () => {
    const overview = build([
      row({ id: 'old', createdAt: daysAgo(30) }),
      row({ id: 'new', createdAt: daysAgo(1) }),
      row({ id: 'gone', createdAt: daysAgo(30), closedAt: daysAgo(5), statusCode: 'approved', approvedLimitAmount: '9000' }),
    ]);

    for (const series of Object.values(overview.trend)) {
      expect(series).toHaveLength(TREND_DAYS);
    }
    // Oldest point: `old` and `gone` were open, `new` did not exist yet.
    expect(overview.trend.open[0]).toBe(2);
    // Newest: `gone` has closed, so two remain.
    expect(overview.trend.open[TREND_DAYS - 1]).toBe(2);
    expect(overview.trend.approvedExposure.reduce((a, b) => a + b, 0)).toBe(9000);
  });

  it('names an applicant that has no company on its people, and never renders blank', () => {
    const overview = build([
      row({ id: 'a', companyName: null, firstName: 'Sardor', lastName: 'Sobirov' }),
      row({ id: 'b', companyName: null, firstName: null, lastName: null }),
    ]);
    expect(overview.needsToday.map((n) => n.name)).toContain('Sardor Sobirov');
    expect(overview.needsToday.map((n) => n.name)).toContain('Untitled application');
  });

  it('shows at most five rows in each list', () => {
    const open = Array.from({ length: 9 }, (_, i) => row({ id: `o${i}`, createdAt: daysAgo(i) }));
    const closed = Array.from({ length: 9 }, (_, i) =>
      row({ id: `c${i}`, statusCode: 'approved', closedAt: daysAgo(1), approvedLimitAmount: '1000' }),
    );
    const overview = build([...open, ...closed]);
    expect(overview.needsToday).toHaveLength(5);
    expect(overview.decisions).toHaveLength(5);
    // The cap is on what is DISPLAYED — the totals still count everything.
    expect(overview.decided.week).toBe(9);
  });
});
