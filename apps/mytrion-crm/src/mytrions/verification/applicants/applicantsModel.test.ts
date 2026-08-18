/**
 * The queue's vocabulary and arithmetic.
 *
 * Three of these pin bugs the old queue actually shipped: a status rendered from a field the detail
 * endpoint never sends, a route read from a column nothing writes, and an "All" tab that counted
 * decided cases into the desk's working set.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VerificationCaseRow } from '@/api/verificationFlow';
import {
  ageDays,
  blockedOn,
  caseInitials,
  caseName,
  DECISION_SLA_DAYS,
  EMPTY_FILTERS,
  inScope,
  PHASE_SHORT,
  routeLabel,
  routeOf,
  selectRows,
  statusLabel,
  STATUS_LABEL,
  type Scope,
} from './applicantsModel';

const NOW = Date.parse('2026-08-17T12:00:00.000Z');
const DAY = 86_400_000;
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
    underwritingRoute: null,
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
    zohoOwnerId: 'zoho-deal-owner',
    zohoOwnerName: 'Daniel Okoye',
    closedAt: null,
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    ...over,
  };
}

const query = (over: Partial<Parameters<typeof selectRows>[1]> = {}): Parameters<typeof selectRows>[1] => ({
  scope: 'open' as Scope,
  search: '',
  filters: EMPTY_FILTERS,
  sortKey: 'age',
  sortDir: 'desc',
  wexCardCutoff: 20,
  slaDays: DECISION_SLA_DAYS,
  now: NOW,
  ...over,
});

describe('status vocabulary', () => {
  it('names every status the state machine can reach', () => {
    // The seed lives in the backend; a status added there must not surface here as snake_case.
    const schema = readFileSync(
      join(process.cwd(), '../../src/db/schema/verification_flow.ts'),
      'utf8',
    );
    const block = /export const VERIFICATION_STATUS = \{([\s\S]*?)\} as const;/.exec(schema)?.[1] ?? '';
    const codes = [...block.matchAll(/:\s*'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(codes.length).toBeGreaterThanOrEqual(12);
    expect(codes.filter((c) => !STATUS_LABEL[c])).toEqual([]);
  });

  it('names every phase the catalog can reach', () => {
    const phases = readFileSync(
      join(process.cwd(), '../../src/db/schema/verification_flow.ts'),
      'utf8',
    );
    const block = /export const VERIFICATION_PHASE = \{([\s\S]*?)\} as const;/.exec(phases)?.[1] ?? '';
    const codes = [...block.matchAll(/:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]!);
    expect(codes).toHaveLength(10);
    expect(codes.filter((c) => !PHASE_SHORT[c])).toEqual([]);
  });

  it('falls back to the map when the server sends no label — the detail endpoint never does', () => {
    // `deskService.detail` does not join verification_statuses, so statusLabel is undefined there.
    expect(statusLabel({ statusCode: 'declined' })).toBe('Declined');
    // The list endpoint DOES stitch one; the server's word wins when it is present.
    expect(statusLabel({ statusCode: 'declined', statusLabel: 'Declined by desk' })).toBe(
      'Declined by desk',
    );
  });
});

describe('identity', () => {
  it('names a person when there is no company, and never renders blank', () => {
    expect(caseName(row({ id: 'a', companyName: null, firstName: 'Sardor', lastName: 'Sobirov' }))).toBe(
      'Sardor Sobirov',
    );
    expect(caseName(row({ id: 'b', companyName: null, firstName: null, lastName: null }))).toBe(
      'Untitled application',
    );
  });

  it('takes two initials, and copes with one word or none', () => {
    expect(caseInitials(row({ id: 'a', companyName: 'Trans-M LLC' }))).toBe('TL');
    expect(caseInitials(row({ id: 'b', companyName: 'Highline' }))).toBe('HI');
    // "Untitled application" → first letter of each of the first two words.
    expect(caseInitials(row({ id: 'c', companyName: null, firstName: null, lastName: null }))).toBe(
      'UA',
    );
  });
});

describe('underwriting route', () => {
  it('derives from the card count, because the stored column is never written', () => {
    // A sales-origin case has underwritingRoute NULL; trusting it showed every case as "not set".
    expect(routeOf({ fuelCardsRequested: 34, underwritingRoute: null }, 20)).toBe('wex');
    expect(routeOf({ fuelCardsRequested: 18, underwritingRoute: null }, 20)).toBe('octane_internal');
    expect(routeOf({ fuelCardsRequested: 20, underwritingRoute: null }, 20)).toBe('octane_internal');
  });

  it('says so when the question has not been answered', () => {
    expect(routeOf({ fuelCardsRequested: null, underwritingRoute: null }, 20)).toBeNull();
    expect(routeLabel(null)).toBe('Route not set');
  });

  it('falls back to the stored value while the policy is still loading', () => {
    expect(routeOf({ fuelCardsRequested: 34, underwritingRoute: 'wex' }, null)).toBe('wex');
  });
});

describe('scopes', () => {
  const decided = row({ id: 'done', closedAt: daysAgo(1), statusCode: 'approved' });
  const locked = row({ id: 'locked', verificationProcess: false, statusCode: 'intake_incomplete' });
  const docs = row({ id: 'docs', statusCode: 'pending_docs' });

  it('keeps decided cases out of the desk working set', () => {
    expect(inScope(decided, 'open')).toBe(false);
    expect(inScope(locked, 'open')).toBe(true);
    expect(inScope(decided, 'closed')).toBe(true);
  });

  it('puts a case in exactly the states it is in', () => {
    expect(inScope(locked, 'awaiting_sales')).toBe(true);
    expect(inScope(locked, 'workable')).toBe(false);
    expect(inScope(docs, 'pending_docs')).toBe(true);
    expect(inScope(docs, 'workable')).toBe(true);
  });
});

describe('blocked-on sentence', () => {
  it('escalates a locked case once its clock has run out', () => {
    const late = row({
      id: 'a',
      verificationProcess: false,
      createdAt: daysAgo(9),
      intakeMissing: ['ein'],
    });
    expect(blockedOn(late, DECISION_SLA_DAYS, NOW)).toBe(
      `9 days waiting — past the ${DECISION_SLA_DAYS}-day SLA`,
    );
  });

  // The owner column names the agent; this column says what is missing. Restoring a
  // "Waiting on Sales —" prefix here puts the same nine characters on every row again.
  it('counts what is outstanding, with the right plural', () => {
    const one = row({ id: 'a', verificationProcess: false, createdAt: daysAgo(1), intakeMissing: ['ein'] });
    expect(blockedOn(one, DECISION_SLA_DAYS, NOW)).toBe('1 item outstanding');
    const many = { ...one, intakeMissing: ['ein', 'mc'] };
    expect(blockedOn(many, DECISION_SLA_DAYS, NOW)).toBe('2 items outstanding');
  });

  it('says intake has not started rather than "0 items outstanding"', () => {
    const legacy = row({ id: 'a', verificationProcess: false, createdAt: daysAgo(1), intakeMissing: [] });
    expect(blockedOn(legacy, DECISION_SLA_DAYS, NOW)).toBe('Intake not started');
  });
});

/**
 * The queue's owner column, its search and its sort all mean the SALES agent — the Deal's owner.
 * Reading `ownerName` instead named the Verification desk's own credit agent on any case whose Deal
 * arrived unowned in Zoho.
 */
describe('the queue reads the Sales owner, not the assignee', () => {
  const reassigned = row({
    id: 'a',
    ownerName: 'Sarvar Asqarov',
    zohoOwnerName: 'Robert Toms',
    zohoOwnerId: '6227679000138228393',
  });

  it('searches the Deal owner — an agent typing their own name gets their cases', () => {
    const q = (search: string) =>
      selectRows([reassigned], {
        scope: 'open',
        search,
        filters: EMPTY_FILTERS,
        sortKey: 'age',
        sortDir: 'desc',
        wexCardCutoff: null,
        slaDays: DECISION_SLA_DAYS,
        now: NOW,
      });
    expect(q('robert')).toHaveLength(1);
    // The assignee must NOT match, or a credit agent's name pulls up Sales' work.
    expect(q('sarvar')).toHaveLength(0);
  });

  it('sorts by the Sales owner instead of silently falling through to age', () => {
    const rows = [
      row({ id: 'z', zohoOwnerName: 'Zara Ali', createdAt: daysAgo(9) }),
      row({ id: 'a', zohoOwnerName: 'Adam Fell', createdAt: daysAgo(1) }),
    ];
    const sorted = selectRows(rows, {
      scope: 'open',
      search: '',
      filters: EMPTY_FILTERS,
      sortKey: 'owner',
      sortDir: 'asc',
      wexCardCutoff: null,
      slaDays: DECISION_SLA_DAYS,
      now: NOW,
    });
    expect(sorted.map((r) => r.id)).toEqual(['a', 'z']);
  });
});

describe('selectRows', () => {
  const rows = [
    row({ id: 'a', createdAt: daysAgo(9), verificationProcess: false, statusCode: 'intake_incomplete', phaseCode: 'p1_intake' }),
    row({ id: 'b', createdAt: daysAgo(2), companyName: 'Bluebird Logistics', fuelCardsRequested: 34 }),
    row({ id: 'c', createdAt: daysAgo(0), companyName: 'Cascade Haul', applicantType: 'company' }),
    row({ id: 'closed', createdAt: daysAgo(30), closedAt: daysAgo(1), statusCode: 'approved' }),
  ];

  it('sorts oldest first by default and leaves decided cases out', () => {
    expect(selectRows(rows, query()).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by name ascending when asked', () => {
    const out = selectRows(rows, query({ sortKey: 'name', sortDir: 'asc' }));
    // Lexicographic on the lowercased name: "cascade haul" sorts before "case a" at the 4th char.
    expect(out.map((r) => r.companyName)).toEqual(['Bluebird Logistics', 'Cascade Haul', 'Case a']);
  });

  it('filters on the DERIVED route, not the stored column', () => {
    expect(selectRows(rows, query({ filters: { ...EMPTY_FILTERS, route: 'wex' } })).map((r) => r.id)).toEqual(
      ['b'],
    );
    // Cards not set → "not set", even though the stored column is null for all of them.
    expect(
      selectRows(rows, query({ filters: { ...EMPTY_FILTERS, route: 'none' } })).map((r) => r.id),
    ).toEqual(['a', 'c']);
  });

  it('filters by applicant type and by stage', () => {
    expect(
      selectRows(rows, query({ filters: { ...EMPTY_FILTERS, type: 'company' } })).map((r) => r.id),
    ).toEqual(['c']);
    expect(
      selectRows(rows, query({ filters: { ...EMPTY_FILTERS, stage: 'intake' } })).map((r) => r.id),
    ).toEqual(['a']);
  });

  it('splits inside-SLA from past-SLA at the threshold, not around it', () => {
    const late = selectRows(rows, query({ filters: { ...EMPTY_FILTERS, age: 'late' } }));
    expect(late.map((r) => r.id)).toEqual(['a']);
    const inside = selectRows(rows, query({ filters: { ...EMPTY_FILTERS, age: 'inside' } }));
    expect(inside.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('searches the name, the owner and the untyped identifiers on the wire', () => {
    expect(selectRows(rows, query({ search: 'bluebird' })).map((r) => r.id)).toEqual(['b']);
    expect(selectRows(rows, query({ search: 'okoye' })).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    const withEin: VerificationCaseRow[] = [{ ...rows[1]!, ein: '84-3392017' }];
    expect(selectRows(withEin, query({ search: '3392017' }))).toHaveLength(1);
  });

  it('measures age in whole days from creation', () => {
    expect(ageDays(rows[0]!, NOW)).toBe(9);
    expect(ageDays(rows[2]!, NOW)).toBe(0);
  });
});
