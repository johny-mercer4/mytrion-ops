import { describe, expect, it } from 'vitest';
import { HARD_DEBT_DAYS, summarizeCmpDebtors } from '../../src/integrations/salesDashboards.js';

describe('summarizeCmpDebtors', () => {
  const emptyFallback = {
    totalDebtors: 0,
    totalHardDebtors: 0,
    totalDebtAmount: 0,
    largestDebtor: {},
  };

  it('drops invoices under 2 days / under $1 and recomputes hard at 15d', () => {
    const out = summarizeCmpDebtors(
      [
        {
          company_name: 'Acme',
          carrier_id: '1',
          worst_status: 'pending',
          invoices: [
            { debt_days: 1, remaining_amount: 900, status: 'pending' },
            { debt_days: 20, remaining_amount: 500, status: 'pending' },
            { debt_days: 10, remaining_amount: 0.5, status: 'pending' },
          ],
        },
      ],
      { ...emptyFallback, totalDebtors: 1, totalDebtAmount: 1400.5, totalHardDebtors: 1 },
    );
    expect(out.totalDebtors).toBe(1);
    expect(out.totalDebtAmount).toBe(500);
    expect(out.totalHardDebtors).toBe(1);
    expect(HARD_DEBT_DAYS).toBe(15);
  });

  it('excludes carriers whose invoices are all too fresh', () => {
    const out = summarizeCmpDebtors(
      [
        {
          company_name: 'Fresh Co',
          carrier_id: '2',
          invoices: [{ debt_days: 1, remaining_amount: 200, status: 'pending' }],
        },
      ],
      { ...emptyFallback, totalDebtors: 1, totalDebtAmount: 200 },
    );
    expect(out.totalDebtors).toBe(0);
    expect(out.totalDebtAmount).toBe(0);
    expect(out.totalHardDebtors).toBe(0);
  });

  it('falls back to CMP totals when no invoice detail is present', () => {
    const out = summarizeCmpDebtors([], {
      totalDebtors: 5,
      totalHardDebtors: 5,
      totalDebtAmount: 19312,
      largestDebtor: { deal_name: 'Top' },
    });
    expect(out.totalDebtors).toBe(5);
    expect(out.totalHardDebtors).toBe(5);
    expect(out.totalDebtAmount).toBe(19312);
  });
});
