import { describe, expect, it } from 'vitest';
import { COLLECTION_STAGES, type ArrayReportRow, type CollectionCaseRow } from '@/api/collection';
import { accountStatusLabel, reportName } from './array/arrayModel';
import {
  BOARD_LANES,
  CASE_INVOICES_PAGE_SIZE,
  BOARD_LANES as LANES_FOR_SPINE,
  STAGE_PROGRESSION,
  caseName,
  laneOfStage,
  nextStage,
  milestoneState,
  daysTone,
  invoiceCacheKey,
  invoicePageOffset,
  invoicePanelKind,
  statusChip,
  statusOf,
} from './cases/casesModel';
import { money } from './collectionFormat';
import { caseRowFixture } from './caseRow.fixture';

function caseRow(over: Partial<CollectionCaseRow> = {}): CollectionCaseRow {
  return caseRowFixture({
    carrierId: '5776662',
    status: 'open',
    collectionStage: 'intake',
    displayName: 'Display',
    debtorCompanyName: 'SANGHA TRANS',
    totalDebtAmount: '90878.84',
    totalInvoiceAmount: '90878.84',
    totalAmountPaid: '0.00',
    issueInvoiceCount: 2,
    daysPastDue: 90,
    caseCreatedDate: '2026-01-01',
    ...over,
  });
}

describe('collection cases model', () => {
  it('prefers the company name over the display stamp', () => {
    expect(caseName(caseRow())).toBe('SANGHA TRANS');
    expect(caseName(caseRow({ debtorCompanyName: null }))).toBe('Display');
    expect(caseName(caseRow({ debtorCompanyName: null, displayName: null }))).toBe('Carrier 5776662');
  });

  it('maps scope tabs onto the status filter Verification uses', () => {
    expect(statusOf('open')).toBe('open');
    expect(statusOf('closed')).toBe('closed');
    expect(statusOf('all')).toBeUndefined();
  });

  it('closed chips name the reason, not just Closed', () => {
    const chip = statusChip(caseRow({ status: 'closed', closedReason: 'paid_in_full' }));
    expect(chip.label).toBe('Paid in full');
    expect(chip.intent).toBe('success');
  });

  it('days past due use the tint scale, not a raw colour', () => {
    expect(daysTone(30)).toBe('ok');
    expect(daysTone(90)).toBe('warn');
    expect(daysTone(180)).toBe('bad');
  });
});

describe('array model', () => {
  it('labels Metro 2 codes the desk already knows', () => {
    expect(accountStatusLabel('11')).toBe('Current');
    expect(accountStatusLabel('93')).toBe('Assigned to agency');
    expect(accountStatusLabel('99')).toBe('Status 99');
  });

  it('names a tradeline from company, then display, then person', () => {
    const row = {
      companyName: null,
      displayName: null,
      firstName: 'Luis',
      lastName: 'Natal',
      carrierId: '1',
    } as ArrayReportRow;
    expect(reportName(row)).toBe('Luis Natal');
  });
});

describe('case invoice panel', () => {
  it('treats a failed load with no cache as an error, not empty', () => {
    expect(invoicePanelKind({ loading: false, error: 'Backend issue', data: null })).toBe('error');
  });

  it('treats a successful zero-item payload as empty', () => {
    expect(invoicePanelKind({ loading: false, error: null, data: { items: [] } })).toBe('empty');
  });

  it('keeps last-good rows on a failed refresh', () => {
    expect(
      invoicePanelKind({
        loading: false,
        error: 'Backend issue',
        data: { items: [{ id: 'inv_1' }] },
      }),
    ).toBe('ready');
  });
});

describe('case invoice paging', () => {
  it('pages from total with a 50-row cap and a cache key scoped by case, page, and limit', () => {
    expect(CASE_INVOICES_PAGE_SIZE).toBe(50);
    expect(invoicePageOffset(1, CASE_INVOICES_PAGE_SIZE)).toBe(0);
    expect(invoicePageOffset(3, CASE_INVOICES_PAGE_SIZE)).toBe(100);
    expect(invoiceCacheKey('cc_1', 1, CASE_INVOICES_PAGE_SIZE)).toBe(
      'collection:case:cc_1:invoices:1:50',
    );
    expect(invoiceCacheKey('cc_1', 2, 50)).not.toBe(invoiceCacheKey('cc_1', 1, 50));
    expect(invoiceCacheKey('cc_1', 1, 50)).not.toBe(invoiceCacheKey('cc_2', 1, 50));
  });
});

describe('collection format', () => {
  it('does not render a missing amount as $0', () => {
    expect(money(null)).toBe('—');
    expect(money('not-a-number')).toBe('—');
  });
});

/**
 * The five board lanes must cover all eight stages, exactly once each.
 *
 * The board groups; the case spine and the data stay at eight. A stage that fell out of every
 * lane would vanish from the board silently — the cards would simply not be there — which is the
 * one failure mode this grouping introduces.
 */
describe('board lanes', () => {
  it('partitions COLLECTION_STAGES — every stage in exactly one lane', () => {
    const mapped = BOARD_LANES.flatMap((lane) => lane.stages);
    expect([...mapped].sort()).toEqual([...COLLECTION_STAGES].sort());
    expect(new Set(mapped).size).toBe(COLLECTION_STAGES.length);
  });

  it('routes every stage to a lane that actually exists', () => {
    const ids = new Set(BOARD_LANES.map((l) => l.id));
    for (const stage of COLLECTION_STAGES) {
      expect(ids.has(laneOfStage(stage)), stage).toBe(true);
    }
  });

  it('keeps the terminal stages out of the working lanes', () => {
    expect(laneOfStage('closed_successfully')).toBe('closed');
    expect(laneOfStage('case_lost')).toBe('closed');
    expect(laneOfStage('with_agency')).toBe('agency');
    expect(laneOfStage('small_claims')).toBe('agency');
  });

  it('keeps the no-contact ladder together and out of Working', () => {
    // The ladder is the early-funnel work the Today worklist exists to drive. It went missing
    // entirely when the enum only carried eight stages.
    for (const stage of ['nc_attempt_1', 'nc_attempt_2', 'nc_attempt_3', 'usps_letter'] as const) {
      expect(laneOfStage(stage), stage).toBe('chasing');
    }
    expect(laneOfStage('connected')).toBe('working');
    expect(laneOfStage('failed_promise')).toBe('working');
    expect(laneOfStage('legal_action')).toBe('agency');
    expect(laneOfStage('civil_court')).toBe('agency');
  });
});

/**
 * The spine's reading order and its done marks.
 *
 * The bug this covers: inferring "done" from position on a linear rail told the reader that a
 * case sitting on a payment plan had already been through agency placement, because the enum
 * happens to list `with_agency` first.
 */
describe('stage progression', () => {
  const laneById = (id: string) => {
    const lane = LANES_FOR_SPINE.find((l) => l.id === id);
    if (!lane) throw new Error(`no lane ${id}`);
    return lane;
  };

  it('holds exactly the enum stages, reordered', () => {
    expect([...STAGE_PROGRESSION].sort()).toEqual([...COLLECTION_STAGES].sort());
    expect(STAGE_PROGRESSION.indexOf('payment_plan')).toBeLessThan(
      STAGE_PROGRESSION.indexOf('with_agency'),
    );
    // The chase comes before the conversation it is trying to start.
    expect(STAGE_PROGRESSION.indexOf('nc_attempt_1')).toBeLessThan(
      STAGE_PROGRESSION.indexOf('connected'),
    );
  });

  it('never marks a milestone done that the case has not been through', () => {
    // On a plan, never placed. The agency milestone must NOT read as visited.
    const history = ['connected', 'payment_plan'] as const;
    expect(milestoneState('payment_plan', laneById('agency'), history)).toBe('todo');
    expect(milestoneState('payment_plan', laneById('plan'), [])).toBe('now');
    expect(milestoneState('payment_plan', laneById('working'), history)).toBe('done');
  });

  it('marks a milestone done from ANY stage inside it', () => {
    // A case that only ever reached USPS Letter has still been through the chase.
    expect(milestoneState('connected', laneById('chasing'), ['usps_letter'])).toBe('done');
    expect(milestoneState('connected', laneById('chasing'), [])).toBe('todo');
  });

  it('always treats intake as visited — every case starts there', () => {
    expect(milestoneState('with_agency', laneById('intake'), [])).toBe('done');
  });

  it('advances along the progression and stops at the end', () => {
    expect(nextStage('intake')).toBe('nc_attempt_1');
    expect(nextStage('nc_attempt_3')).toBe('usps_letter');
    expect(nextStage('usps_letter')).toBe('connected');
    expect(nextStage('connected')).toBe('payment_plan');
    expect(nextStage('closed_successfully')).toBe('case_lost');
    expect(nextStage('case_lost')).toBeNull();
  });
});
