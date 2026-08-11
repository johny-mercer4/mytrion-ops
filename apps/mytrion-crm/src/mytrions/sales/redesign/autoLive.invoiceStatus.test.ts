import { describe, expect, it } from 'vitest';
import { filterClientInvoices, mapInvStatus, titleStatus } from './autoLive';

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
});
