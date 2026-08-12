import { describe, expect, it } from 'vitest';
import { cmpInvoiceStatus, filterClientInvoices, mapInvStatus, titleStatus } from './autoLive';
import { money, moneyExact } from './live';

describe('C-20 invoice status helpers', () => {
  it('titleStatus distinguishes PARTIALLY_PAID from PAID', () => {
    expect(titleStatus('PARTIALLY_PAID')).toBe('Partially Paid');
    expect(titleStatus('PAID')).toBe('Paid');
    expect(titleStatus('PENDING')).toBe('Pending');
    expect(titleStatus('CANCELLED')).toBe('Cancelled');
  });

  it('mapInvStatus passes CMP filter codes', () => {
    expect(mapInvStatus('PARTIALLY_PAID')).toBe('PARTIALLY_PAID');
    expect(mapInvStatus('Pending')).toBe('PENDING');
    expect(mapInvStatus('PAID')).toBe('PAID');
    expect(mapInvStatus('all')).toBeUndefined();
  });

  it('filterClientInvoices applies status and date window', () => {
    const rows = [
      { id: 1, status: 'PARTIALLY_PAID', invoice_date: '2026-08-01' },
      { id: 2, status: 'PAID', invoice_date: '2026-07-01' },
      { id: 3, status: 'PENDING', invoice_date: '2026-08-10' },
    ];
    expect(filterClientInvoices(rows, { status: 'PARTIALLY_PAID' })).toEqual([rows[0]]);
    expect(filterClientInvoices(rows, { from: '2026-08-01', to: '2026-08-31' }).map((r) => r.id)).toEqual([
      1, 3,
    ]);
  });

  it('cmpInvoiceStatus trusts CMP money over a contradicting CMP status', () => {
    // Says PAID, still owes: that is the 5815660 complaint.
    expect(cmpInvoiceStatus('PAID', 10_000, 33_495.62)).toBe('Partially Paid');
    // Says PAID, owes everything: nothing has been paid, so it is not "partially" anything.
    expect(cmpInvoiceStatus('PAID', 0, 1_200)).toBe('Pending');
    expect(cmpInvoiceStatus('PAID', 53_026.51, 0)).toBe('Paid');
    // Float noise is not a debt.
    expect(cmpInvoiceStatus('PAID', 100, 0.001)).toBe('Paid');
    // Every other status is CMP's word, untouched.
    expect(cmpInvoiceStatus('CANCELLED', 0, 500)).toBe('Cancelled');
    expect(cmpInvoiceStatus('PARTIALLY_PAID', 10, 90)).toBe('Partially Paid');
    expect(cmpInvoiceStatus('', 0, 0)).toBe('—');
  });

  it('moneyExact keeps the cents money rounds away', () => {
    expect(moneyExact(43_495.62)).toBe('$43,495.62');
    expect(money(43_495.62)).toBe('$43,496');
    expect(moneyExact(0)).toBe('$0.00');
    expect(moneyExact(-12.5)).toBe('-$12.50');
    expect(moneyExact('1234.5')).toBe('$1,234.50');
  });
});
