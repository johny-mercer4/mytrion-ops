import { describe, expect, it } from 'vitest';
import {
  cycleTotals,
  filterActivity,
  filterCompanies,
  filterTransactions,
  mapSalesDash,
  txTotals,
  type SalesActivityPoint,
  type SalesCompanyRow,
  type SalesDailyCarrierRow,
} from './dashSalesData';

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
  {
    carrierId: '3',
    name: 'Gamma',
    activeCards: 5,
    newCards: 1,
    uniqueCards: 4,
    status: 'inactive',
    daysSinceTx: 12,
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

  it('All mode keeps per-metric cards and sorts by unique', () => {
    const rows = filterCompanies({
      companies,
      statusFilter: null,
      barFilter: 'all',
      companyQ: '',
      selectedDates: null,
      dailyByCarrier: [],
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]?.name).toBe('Alpha');
    expect(rows[0]?.activeCards).toBe(10);
    expect(rows[0]?.newCards).toBe(2);
    expect(rows[0]?.uniqueCards).toBe(8);
  });

  it('searches by carrier name', () => {
    const rows = filterCompanies({
      companies,
      statusFilter: null,
      barFilter: 'active',
      companyQ: 'gam',
      selectedDates: null,
      dailyByCarrier: [],
    });
    expect(rows.map((r) => r.name)).toEqual(['Gamma']);
  });
});

describe('filterTransactions / cycleTotals / txTotals', () => {
  const tx = [
    { carrierId: '1', name: 'Alpha', newCards: 1, transactions: 5, volume: 100.5, discount: 2, total: 50 },
    { carrierId: '2', name: 'Beta', newCards: 0, transactions: 2, volume: 40.25, discount: 1, total: 20 },
  ];

  it('sums cycle totals unfiltered', () => {
    expect(cycleTotals(tx)).toEqual({ volume: 140.75, transactions: 7 });
  });

  it('filters tx by carrier search', () => {
    expect(filterTransactions({ transactions: tx, txQ: 'beta', selectedDates: null, dailyByCarrier: [] })).toHaveLength(
      1,
    );
  });

  it('day selection aggregates dailyByCarrier into tx rows', () => {
    const daily: SalesDailyCarrierRow[] = [
      {
        date: '2026-07-01',
        carrierId: '1',
        name: 'Alpha',
        activeCards: 2,
        newCards: 1,
        uniqueCards: 2,
        transactions: 3,
        volume: 10,
        discount: 1,
        total: 5,
      },
      {
        date: '2026-07-01',
        carrierId: '2',
        name: 'Beta',
        activeCards: 1,
        newCards: 0,
        uniqueCards: 1,
        transactions: 1,
        volume: 4,
        discount: 0,
        total: 2,
      },
      {
        date: '2026-07-02',
        carrierId: '1',
        name: 'Alpha',
        activeCards: 2,
        newCards: 0,
        uniqueCards: 2,
        transactions: 2,
        volume: 6,
        discount: 0.5,
        total: 3,
      },
    ];
    const rows = filterTransactions({
      transactions: tx,
      txQ: '',
      selectedDates: new Set(['2026-07-01']),
      dailyByCarrier: daily,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe('Alpha');
    expect(rows[0]?.volume).toBe(10);
    expect(rows[0]?.transactions).toBe(3);
    const totals = txTotals(rows);
    expect(totals?.volume).toBe(14);
    expect(totals?.transactions).toBe(4);
  });
});

describe('filterActivity', () => {
  it('History returns all sorted by date', () => {
    const activity: SalesActivityPoint[] = [
      { date: '2026-07-02', label: 'Jul 2', transactions: 2, activeCards: 1, newCards: 0, volume: 1 },
      { date: '2026-06-01', label: 'Jun 1', transactions: 1, activeCards: 1, newCards: 0, volume: 1 },
    ];
    const rows = filterActivity(activity, 'all');
    expect(rows.map((r) => r.date)).toEqual(['2026-06-01', '2026-07-02']);
  });
});

describe('mapSalesDash', () => {
  it('maps Deluge-shaped payload into UI rows', () => {
    const raw = mapSalesDash({
      cycle: { start: '2026-06-26', end: '2026-07-25' },
      kpi: { active_companies: 46, active_companies_pct: '24.9', new_cards_cycle: 8 },
      cardsByCompany: [
        {
          carrier_id: 'c1',
          carrier_name: 'ZURVAN INC',
          active_cards: 19,
          new_cards: 2,
          unique_cards: 5,
          company_status: 'active',
          days_since_tx: 0,
        },
      ],
      cardActivity: [
        {
          activity_month: '2026-07-01',
          month_label: 'Jul 1',
          transactions: 106,
          active_cards: 85,
          new_cards: 2,
          volume: 1200,
        },
      ],
      transactions: [
        {
          carrier_id: 'c1',
          carrier_name: 'ZURVAN INC',
          new_cards: 2,
          transactions: 67,
          volume: 8094.67,
          discount: 20.1,
          total: 124.1,
        },
      ],
      dailyTransactionsByCarrier: [
        {
          date: '2026-07-01',
          carrier_id: 'c1',
          carrier_name: 'ZURVAN INC',
          active_cards: 10,
          new_cards: 1,
          unique_cards: 3,
          transactions: 5,
          volume: 100,
          discount: 1,
          total: 10,
        },
      ],
    });
    expect(raw.cycle).toEqual({ start: '2026-06-26', end: '2026-07-25' });
    expect(raw.kpi.active_companies).toBe(46);
    expect(raw.kpiText.active_companies_pct).toBe('24.9');
    expect(raw.companies[0]?.name).toBe('ZURVAN INC');
    expect(raw.companies[0]?.daysSinceTx).toBe(0);
    expect(raw.activity[0]?.transactions).toBe(106);
    expect(raw.transactions[0]?.volume).toBe(8094.67);
    expect(raw.dailyByCarrier).toHaveLength(1);
  });
});
