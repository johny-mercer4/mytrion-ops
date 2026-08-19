/**
 * The worklist's sentences.
 *
 * Every row on Today states one thing: why it is there and what happens if nobody acts. These
 * are the only user-facing strings in the module that are composed rather than written, so they
 * are the ones that can silently come out wrong — "1 instalments missed", a promise described as
 * late when it is due today, a plural that does not agree.
 */
import { describe, expect, it } from 'vitest';
import type { CollectionCaseRow } from '@/api/collection';
import type { DeskPolicy, WorklistItem, WorklistLane } from '@/api/collectionDesk';
import { LANES, itemName, laneAction, laneMeta, laneSentence } from './worklistCopy';

const POLICY: DeskPolicy = {
  agencyMinDaysPastDue: 180,
  agencyMinRemaining: 5000,
  agencyWarnWindowDays: 14,
  promiseGraceDays: 5,
  silentAfterDays: 30,
  intakeUncontactedDays: 2,
  agingBands: [30, 90, 180],
};

function caseRow(over: Partial<CollectionCaseRow> = {}): CollectionCaseRow {
  return {
    id: 'cc_1',
    carrierId: '5104821',
    status: 'open',
    collectionStage: 'connected',
    displayName: null,
    debtorCompanyName: 'Redline Freight LLC',
    debtorFullName: null,
    debtorEmail: null,
    debtorSecondaryEmail: null,
    debtorPhone: null,
    debtorCellPhone: null,
    debtorAddress: null,
    debtorCity: null,
    debtorState: null,
    debtorZipCode: null,
    debtorMcDot: 'MC-847213',
    debtorDateOfBirth: null,
    totalDebtAmount: '26120',
    totalInvoiceAmount: '38420',
    totalAmountPaid: '12300',
    issueInvoiceCount: 11,
    daysPastDue: 214,
    firstDelinquentDate: null,
    placementDate: null,
    caseCreatedDate: '2026-01-12',
    closedAt: null,
    closedReason: null,
    zohoDealId: null,
    zohoRecordId: null,
    agencyTransferDate: null,
    firstCollectionAgency: null,
    assigneeUserId: null,
    currency: 'USD',
    reopenCount: 0,
    lastSyncedAt: null,
    createdAt: '2026-01-12T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...over,
  };
}

function item(lane: WorklistLane, over: Partial<WorklistItem> = {}): WorklistItem {
  return {
    case: caseRow(),
    lane,
    score: 1,
    lastContact: null,
    daysSinceContact: null,
    promise: null,
    plan: null,
    agencyReturned: false,
    daysToAgency: -34,
    ...over,
  };
}

describe('lane metadata', () => {
  it('covers every lane the API can return, with a distinct tone each', () => {
    const tones = new Set(LANES.map((l) => l.tone));
    expect(LANES).toHaveLength(7);
    expect(tones.size).toBe(7);
    for (const lane of LANES) {
      expect(laneMeta(lane.id).id).toBe(lane.id);
      expect(laneAction(lane.id).label).toBeTruthy();
    }
  });
});

describe('laneSentence', () => {
  it('agrees its plurals on a single missed instalment', () => {
    const one = laneSentence(
      item('plan_broken', { plan: { planId: 'p', paid: 3, missed: 1, total: 8 } }),
      POLICY,
    );
    expect(one).toContain('1 instalment missed');
    expect(one).not.toContain('1 instalments');

    const two = laneSentence(
      item('plan_broken', { plan: { planId: 'p', paid: 2, missed: 2, total: 8 } }),
      POLICY,
    );
    expect(two).toContain('2 instalments missed');
  });

  it('distinguishes a promise due today from a late one', () => {
    const today = laneSentence(
      item('promise_due', {
        promise: {
          id: 'clp_1',
          caseId: 'cc_1',
          amount: '4800',
          dueDate: '2026-08-19',
          status: 'open',
          note: null,
          createdByName: null,
          createdAt: '2026-08-12T00:00:00.000Z',
          daysLate: 0,
        },
      }),
      POLICY,
    );
    expect(today).toContain('today');
    expect(today).not.toContain('late');

    const late = laneSentence(
      item('promise_due', {
        promise: {
          id: 'clp_1',
          caseId: 'cc_1',
          amount: '2400',
          dueDate: '2026-08-16',
          status: 'open',
          note: null,
          createdByName: null,
          createdAt: '2026-08-01T00:00:00.000Z',
          daysLate: 3,
        },
      }),
      POLICY,
    );
    expect(late).toContain('3 days late');
  });

  it('quotes the policy thresholds rather than hardcoding them', () => {
    const past = laneSentence(item('agency_threshold', { daysToAgency: -20 }), POLICY);
    expect(past).toContain('180 days');
    expect(past).toContain('$5,000');

    const soon = laneSentence(item('agency_threshold', { daysToAgency: 1 }), POLICY);
    expect(soon).toContain('in 1 day');
    expect(soon).not.toContain('in 1 days');
  });

  it('names the last outcome on a silent case, and copes when there was none', () => {
    const withOutcome = laneSentence(
      item('silent', {
        daysSinceContact: 41,
        lastContact: { occurredAt: '2026-07-09T00:00:00.000Z', channel: 'call', outcome: 'voicemail' },
      }),
      POLICY,
    );
    expect(withOutcome).toContain('41 days');
    expect(withOutcome).toContain('voicemail');

    const without = laneSentence(item('silent', { daysSinceContact: 33 }), POLICY);
    expect(without).toContain('33 days');
    expect(without.endsWith('.')).toBe(true);
  });

  it('says something for every lane — no row ever renders an empty reason', () => {
    for (const lane of LANES) {
      const sentence = laneSentence(item(lane.id, { plan: { planId: 'p', paid: 0, missed: 1, total: 4 } }), POLICY);
      expect(sentence.length, lane.id).toBeGreaterThan(20);
    }
  });
});

describe('itemName', () => {
  it('falls back through company, display name, person, then the carrier id', () => {
    expect(itemName(item('silent'))).toBe('Redline Freight LLC');
    expect(
      itemName(item('silent', { case: caseRow({ debtorCompanyName: null, displayName: 'Display Co' }) })),
    ).toBe('Display Co');
    expect(
      itemName(
        item('silent', {
          case: caseRow({ debtorCompanyName: null, displayName: null, debtorFullName: 'Marcus O' }),
        }),
      ),
    ).toBe('Marcus O');
    expect(
      itemName(
        item('silent', {
          case: caseRow({ debtorCompanyName: '  ', displayName: null, debtorFullName: null }),
        }),
      ),
    ).toBe('Carrier 5104821');
  });
});
