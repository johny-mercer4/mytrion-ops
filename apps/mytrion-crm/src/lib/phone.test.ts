import { describe, expect, it } from 'vitest';
import { formatPhone } from './phone';

describe('formatPhone', () => {
  it('formats a bare 10-digit number', () => {
    expect(formatPhone('7029894445')).toBe('(702) 989-4445');
  });

  it('formats regardless of source punctuation', () => {
    expect(formatPhone('(702) 989-4445')).toBe('(702) 989-4445');
    expect(formatPhone('702-989-4445')).toBe('(702) 989-4445');
  });

  it('strips a leading country-code 1 on an 11-digit number', () => {
    expect(formatPhone('17029894445')).toBe('(702) 989-4445');
    expect(formatPhone('+1 (702) 989-4445')).toBe('(702) 989-4445');
  });

  it('falls back to the raw trimmed value when the digit count matches neither shape', () => {
    expect(formatPhone('12345')).toBe('12345');
    expect(formatPhone(' 12345 ')).toBe('12345');
  });

  it('returns an empty string for empty/blank/nullish input', () => {
    expect(formatPhone('')).toBe('');
    expect(formatPhone('   ')).toBe('');
    expect(formatPhone(null)).toBe('');
    expect(formatPhone(undefined)).toBe('');
  });
});
