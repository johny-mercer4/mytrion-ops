import { describe, expect, it } from 'vitest';
import { maskSensitiveDigitRuns } from '../src/messagePrivacy.js';

describe('message-log digit redaction', () => {
  it('masks contiguous and formatted PAN/account values while keeping the last four', () => {
    expect(maskSensitiveDigitRuns('card 7083051234567890')).toBe(
      'card ************7890',
    );
    expect(maskSensitiveDigitRuns('card 7083 0512 3456 7890')).toBe(
      'card **** **** **** 7890',
    );
    expect(maskSensitiveDigitRuns('acct 7083-0512-3456-7890')).toBe(
      'acct ****-****-****-7890',
    );
  });

  it('does not mask ordinary short identifiers', () => {
    expect(maskSensitiveDigitRuns('unit 123456, phone 2025550199')).toBe(
      'unit 123456, phone 2025550199',
    );
  });
});
