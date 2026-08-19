import { describe, expect, it } from 'vitest';
import { COLLECTION_STAGES, type ArrayReportRow, type CollectionCaseRow } from '@/api/collection';
import { accountStatusLabel, reportName } from './array/arrayModel';
import {
  BOARD_LANES,
  CASE_INVOICES_PAGE_SIZE,
  caseName,
  laneOfStage,
  daysTone,
  invoiceCacheKey,
  invoicePageOffset,
  invoicePanelKind,
  statusChip,
  statusOf,
} from './cases/casesModel';
import { money } from './collectionFormat';

function caseRow(over: Partial<CollectionCaseRow> = {}): CollectionCaseRow {
  return {
    id: 'cc_1',
    carrierId: '5776662',
    status: 'open',
    collectionStage: 'intake',
    displayName: 'Display',
    debtorCompanyName: 'SANGHA TRANS',
    debtorFullName: null,
    debtorEmail: null,
    debtorSecondaryEmail: null,
    debtorPhone: null,
    debtorCellPhone: null,
    debtorAddress: null,
    debtorCity: null,
    debtorState: null,
    debtorZipCode: null,
    debtorMcDot: null,
    debtorDateOfBirth: null,
    totalDebtAmount: '90878.84',
    totalInvoiceAmount: '90878.84',
    totalAmountPaid: '0.00',
    issueInvoiceCount: 2,
    daysPastDue: 90,
    firstDelinquentDate: null,
    placementDate: null,
    caseCreatedDate: '2026-01-01',
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
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
});
