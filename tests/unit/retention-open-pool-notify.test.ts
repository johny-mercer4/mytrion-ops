import { describe, expect, it } from 'vitest';
import {
  formatOpenPoolNotifyDetail,
  openPoolEntryReasonLabel,
  type OpenPoolEntryReason,
} from '../../src/modules/retention/notify.js';

describe('openPoolEntryReasonLabel', () => {
  const cases: Array<[OpenPoolEntryReason, string]> = [
    ['out_of_reach', 'after 5 Out of Reach attempts'],
    ['reached', 'after 5 BD with no new transaction (Reached)'],
    ['reclaim', "after the new owner's 3 BD window with no transaction"],
    ['phase2', 'from Retention Phase 2 (10 BD watch or no response)'],
  ];

  it.each(cases)('%s → readable label', (reason, label) => {
    expect(openPoolEntryReasonLabel(reason)).toBe(label);
  });
});

describe('formatOpenPoolNotifyDetail', () => {
  it('includes reason for OoR entry', () => {
    expect(
      formatOpenPoolNotifyDetail({
        caseId: 'c1',
        carrierId: 'CAR-9',
        reason: 'out_of_reach',
      }),
    ).toContain('after 5 Out of Reach attempts');
  });

  it('includes reason for Reached entry (not OoR copy)', () => {
    const detail = formatOpenPoolNotifyDetail({
      caseId: 'c2',
      carrierId: 'CAR-2',
      reason: 'reached',
    });
    expect(detail).toContain('Reached');
    expect(detail).not.toContain('Out of Reach');
    expect(detail).toContain('claim within 3 BD');
  });
});
