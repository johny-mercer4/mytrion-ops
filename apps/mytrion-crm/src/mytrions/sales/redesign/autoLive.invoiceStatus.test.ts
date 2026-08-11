import { describe, expect, it } from 'vitest';
import { mapInvStatus, titleStatus } from './autoLive';

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
});
