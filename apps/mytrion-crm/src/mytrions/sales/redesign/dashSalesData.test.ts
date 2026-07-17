import { describe, expect, it } from 'vitest';
import { cycleTotals, filterCompanies, filterTransactions, type SalesCompanyRow } from './dashSalesData';

const companies: SalesCompanyRow[] = [
  {
    carrierId: '1',
    name: 'Alpha',
    activeCards: 10,
    newCards: 2,
    uniqueCards: 8,
    status: 'active',
    daysSinceTx: 2,
  },
  {
    carrierId: '2',
    name: 'Beta',
    activeCards: 3,
    newCards: 0,
    uniqueCards: 1,
    status: 'stuck',
    daysSinceTx: 20,
  },
];

describe('filterCompanies', () => {
  it('filters by stuck status and sorts by display value', () => {
    const rows = filterCompanies({
      companies,
      statusFilter: 'stuck',
      barFilter: 'active',
      companyQ: '',
      selectedDates: null,
      dailyByCarrier: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Beta');
    expect(rows[0]?.displayValue).toBe(3);
  });
});

describe('filterTransactions / cycleTotals', () => {
  const tx = [
    { carrierId: '1', name: 'Alpha', newCards: 1, transactions: 5, volume: 100, discount: 2, total: 50 },
    { carrierId: '2', name: 'Beta', newCards: 0, transactions: 2, volume: 40, discount: 1, total: 20 },
  ];

  it('sums cycle totals unfiltered', () => {
    expect(cycleTotals(tx)).toEqual({ volume: 140, transactions: 7 });
  });

  it('filters tx by carrier search', () => {
    expect(filterTransactions({ transactions: tx, txQ: 'beta', selectedDates: null, dailyByCarrier: [] })).toHaveLength(
      1,
    );
  });
});
