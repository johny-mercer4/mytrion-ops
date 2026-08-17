import { describe, expect, it } from 'vitest';
import { digitsOnly, normalizeCompany } from '../../src/modules/verification/carrierEnrich.js';

describe('digitsOnly', () => {
  it('keeps digits and drops punctuation / spaces', () => {
    expect(digitsOnly('(512) 555-0100')).toBe('5125550100');
    expect(digitsOnly('+1 512.555.0100')).toBe('15125550100');
    expect(digitsOnly('')).toBe('');
  });
});

describe('normalizeCompany', () => {
  it('lowercases, strips punctuation, and collapses spaces', () => {
    expect(normalizeCompany('  Acme, "Haul" (LLC)  ')).toBe('acme haul llc');
    expect(normalizeCompany("O'Brien / Sons.")).toBe('obrien sons');
  });
});
