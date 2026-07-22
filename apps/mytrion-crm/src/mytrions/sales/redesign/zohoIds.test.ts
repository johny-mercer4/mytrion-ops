import { describe, expect, it } from 'vitest';
import { zohoIdSuffix, zohoIdsMatch } from './zohoIds';

describe('zohoIdSuffix', () => {
  it('takes the last 12 digits, zero-padded', () => {
    expect(zohoIdSuffix('6227679000000676062')).toBe('000000676062');
    expect(zohoIdSuffix('676062')).toBe('000000676062');
  });

  it('strips non-digits before slicing', () => {
    expect(zohoIdSuffix('zoho:6227679000000676062')).toBe('000000676062');
  });

  it("returns '' when there are no digits", () => {
    expect(zohoIdSuffix('Frank Harrison')).toBe('');
    expect(zohoIdSuffix('')).toBe('');
  });
});

describe('zohoIdsMatch', () => {
  it('matches the same record across different org prefixes (the WS ownerId skew)', () => {
    expect(zohoIdsMatch('6227679000000676062', '9915231000000676062')).toBe(true);
  });

  it('pad-matches ids shorter than 12 digits', () => {
    expect(zohoIdsMatch('676062', '6227679000000676062')).toBe(true);
  });

  it('rejects different records', () => {
    expect(zohoIdsMatch('6227679000000676062', '6227679000000112233')).toBe(false);
  });

  it('falls back to trimmed exact match when either side has no digits', () => {
    expect(zohoIdsMatch(' Frank Harrison ', 'Frank Harrison')).toBe(true);
    expect(zohoIdsMatch('Frank Harrison', 'Dan Brown')).toBe(false);
  });

  it('never matches empties', () => {
    expect(zohoIdsMatch('', '6227679000000676062')).toBe(false);
    expect(zohoIdsMatch('', '')).toBe(false);
  });
});
