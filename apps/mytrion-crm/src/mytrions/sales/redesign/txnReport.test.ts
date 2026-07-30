import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TXN_OPTS,
  groupTransactions,
  groupTxnRows,
  processTransactions,
  txnRangeParams,
  type TxnExportOptions,
} from './txnReport';

const transactions = groupTxnRows([
  {
    transaction_id: 'tx-1',
    transaction_date: '2026-07-03T10:30:00-04:00',
    card_number: '7083050000001111',
    driver_card_name: 'Alice Driver',
    driver_id: 'D-101',
    driver_unit: 'UNIT-1',
    location_id: 'LOC-10',
    location_name: "Love's #10",
    location_city: 'Dallas',
    location_state: 'TX',
    chain_name: "Love's",
    invoice_ref: 'INV-100',
    line_item_category: 'ULSD',
    line_item_amount: 120,
    line_item_fuel_quantity: 30,
  },
  {
    transaction_id: 'tx-1',
    transaction_date: '2026-07-03T10:30:00-04:00',
    card_number: '7083050000001111',
    driver_card_name: 'Alice Driver',
    driver_id: 'D-101',
    driver_unit: 'UNIT-1',
    location_id: 'LOC-10',
    location_name: "Love's #10",
    location_city: 'Dallas',
    location_state: 'TX',
    chain_name: "Love's",
    invoice_ref: 'INV-100',
    line_item_category: 'DEF',
    line_item_amount: 15,
    line_item_fuel_quantity: 5,
  },
  {
    transaction_id: 'tx-2',
    transaction_date: '2026-07-02T08:00:00-04:00',
    card_number: '7083050000002222',
    driver_card_name: 'Bob Smith',
    driver_id: 'D-202',
    driver_unit: 'UNIT-2',
    location_id: 'LOC-20',
    location_name: 'Pilot #20',
    location_city: 'Tulsa',
    location_state: 'OK',
    chain_name: 'Pilot',
    invoice_ref: 'INV-200',
    line_item_category: 'ULSD',
    line_item_amount: -42,
    line_item_fuel_quantity: -10,
  },
  {
    transaction_id: 'tx-3',
    transaction_date: '2026-07-04T12:00:00-04:00',
    card_number: '7083050000003333',
    driver_card_name: 'Carol Jones',
    driver_id: 'D-303',
    driver_unit: 'REEFER-3',
    location_id: 'LOC-30',
    location_name: "Love's #30",
    location_city: 'Fresno',
    location_state: 'CA',
    chain_name: "Love's",
    invoice_ref: 'INV-300',
    line_item_category: 'REEFER',
    line_item_amount: 75,
    line_item_fuel_quantity: 18,
  },
]);

function options(patch: Partial<TxnExportOptions> = {}): TxnExportOptions {
  return {
    ...DEFAULT_TXN_OPTS,
    ...patch,
    match: { ...DEFAULT_TXN_OPTS.match, ...(patch.match ?? {}) },
  };
}

describe('transaction report filters', () => {
  it('groups line items without duplicating a transaction total', () => {
    expect(transactions).toHaveLength(3);
    expect(transactions.find((row) => row.id === 'tx-1')).toMatchObject({
      fundedTotal: 135,
      fuelQuantity: 35,
    });
    expect(transactions.find((row) => row.id === 'tx-1')?.lineItems).toHaveLength(2);
  });

  it('applies negative, state, chain, and product filters', () => {
    expect(processTransactions(transactions, options({ negativeOnly: true })).map((row) => row.id)).toEqual(['tx-2']);
    expect(processTransactions(transactions, options({ stateProvince: 'tx' })).map((row) => row.id)).toEqual(['tx-1']);
    expect(processTransactions(transactions, options({ chainNames: ["Love's"] })).map((row) => row.id)).toEqual([
      'tx-3',
      'tx-1',
    ]);
    expect(processTransactions(transactions, options({ product: 'def' })).map((row) => row.id)).toEqual(['tx-1']);
  });

  it.each([
    ['cardNumber', '00001111', 'tx-1'],
    ['locationId', 'loc-20', 'tx-2'],
    ['driverName', 'carol', 'tx-3'],
    ['driverId', 'd-101', 'tx-1'],
    ['unit', 'unit-2', 'tx-2'],
    ['city', 'fres', 'tx-3'],
    ['invoice', 'inv-200', 'tx-2'],
  ] as const)('matches the %s field case-insensitively', (field, query, expectedId) => {
    const filtered = processTransactions(
      transactions,
      options({ match: { ...DEFAULT_TXN_OPTS.match, [field]: query } }),
    );
    expect(filtered.map((row) => row.id)).toEqual([expectedId]);
  });

  it('supports exact matching and both sort modes', () => {
    expect(
      processTransactions(
        transactions,
        options({
          exactMatch: true,
          match: { ...DEFAULT_TXN_OPTS.match, driverName: 'Alice' },
        }),
      ),
    ).toHaveLength(0);
    expect(
      processTransactions(
        transactions,
        options({
          exactMatch: true,
          match: { ...DEFAULT_TXN_OPTS.match, driverName: 'alice driver' },
        }),
      ).map((row) => row.id),
    ).toEqual(['tx-1']);
    expect(processTransactions(transactions, options()).map((row) => row.id)).toEqual(['tx-3', 'tx-1', 'tx-2']);
    expect(
      processTransactions(transactions, options({ sortBy: 'state_province' })).map((row) => row.locationState),
    ).toEqual(['CA', 'OK', 'TX']);
  });

  it('groups by card, driver, and state', () => {
    expect(groupTransactions(transactions, 'card_number').map((group) => group.key)).toHaveLength(3);
    expect(groupTransactions(transactions, 'driver').map((group) => group.key)).toEqual(['D-303', 'D-101', 'D-202']);
    expect(groupTransactions(transactions, 'state_province').map((group) => group.key)).toEqual(['CA', 'TX', 'OK']);
  });
});

describe('transaction ranges', () => {
  it('passes supported presets and validates custom ranges', () => {
    expect(txnRangeParams('quarter')).toEqual({ range: 'quarter' });
    expect(txnRangeParams('custom', { from: '2026-07-01', to: '2026-07-29' })).toEqual({
      range: 'custom',
      from: '2026-07-01',
      to: '2026-07-29',
    });
    expect(() => txnRangeParams('custom')).toThrow('Pick a start and end date');
  });

  it('maps six months to a bounded custom range', () => {
    const range = txnRangeParams('half_year');
    expect(range.range).toBe('custom');
    expect(range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
