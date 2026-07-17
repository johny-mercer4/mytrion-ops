import { describe, expect, it } from 'vitest';
import { debtorsSummary, filterDebtors, type DebtorCard } from './dashDebtorsData';

function card(over: Partial<DebtorCard> & { invoices: DebtorCard['invoices'] }): DebtorCard {
  return {
    id: '1',
    companyName: 'Acme',
    dealName: 'Acme Deal',
    carrierId: '10428',
    stage: 'Closed Won',
    worstStatus: 'pending',
    invoiceCount: over.invoices.length,
    totalOwed: 0,
    totalPaid: 0,
    totalRemaining: 0,
    maxDebtDays: 0,
    hasPending: false,
    hasPartial: false,
    isHardDebtor: false,
    ...over,
  };
}

describe('filterDebtors', () => {
  it('hides debtors whose invoices are all under 2 days', () => {
    const list = filterDebtors(
      [
        card({
          invoices: [
            {
              invoiceId: 'a',
              dateFrom: '',
              dateTo: '',
              createDate: '',
              debtDays: 1,
              status: 'pending',
              remaining: 100,
              total: 100,
            },
          ],
        }),
      ],
      '',
    );
    expect(list).toHaveLength(0);
  });

  it('recomputes hard flag from max debt days >= 15', () => {
    const list = filterDebtors(
      [
        card({
          invoices: [
            {
              invoiceId: 'a',
              dateFrom: '',
              dateTo: '',
              createDate: '',
              debtDays: 20,
              status: 'pending',
              remaining: 500,
              total: 800,
            },
            {
              invoiceId: 'b',
              dateFrom: '',
              dateTo: '',
              createDate: '',
              debtDays: 1,
              status: 'pending',
              remaining: 50,
              total: 50,
            },
          ],
        }),
      ],
      '',
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.invoiceCount).toBe(1);
    expect(list[0]?.totalRemaining).toBe(500);
    expect(list[0]?.isHardDebtor).toBe(true);
  });

  it('summary counts pending / partial / hard', () => {
    const list = filterDebtors(
      [
        card({
          id: '1',
          invoices: [
            {
              invoiceId: 'a',
              dateFrom: '',
              dateTo: '',
              createDate: '',
              debtDays: 5,
              status: 'pending',
              remaining: 100,
              total: 100,
            },
          ],
        }),
        card({
          id: '2',
          companyName: 'Beta',
          carrierId: '9',
          invoices: [
            {
              invoiceId: 'c',
              dateFrom: '',
              dateTo: '',
              createDate: '',
              debtDays: 16,
              status: 'partially_paid',
              remaining: 200,
              total: 400,
            },
          ],
        }),
      ],
      '',
    );
    expect(debtorsSummary(list)).toEqual({
      totalRemaining: 300,
      pendingCount: 1,
      partialCount: 1,
      hardCount: 1,
      largestDebt: 200,
    });
  });
});
