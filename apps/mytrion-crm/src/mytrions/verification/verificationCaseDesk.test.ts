import { describe, expect, it } from 'vitest';
import {
  attachmentScopeLabel,
  CASE_EXPORT_COLUMNS,
  groupAttachments,
  ownerMatchesViewer,
  ownerScopeCount,
  paymentTone,
  statusBucketCount,
} from './verificationCaseDesk';
import type { VerificationCaseAggregates, VerificationCaseAttachment } from '../../api/verificationCases';

const aggregates: VerificationCaseAggregates = {
  open: 4,
  shared: 2,
  inProgress: 3,
  awaitingDecision: 1,
  unmatched: 2,
  total: 10,
  new: 4,
  approved: 1,
  rejected: 1,
  failed: 0,
  unclaimed: 6,
  mine: 2,
  stale: 1,
};

function file(id: string, scope: string): VerificationCaseAttachment {
  return { id, fileName: `${id}.pdf`, contentType: 'application/pdf', byteSize: 1024, scope, createdAt: null };
}

describe('verificationCaseDesk UI helpers', () => {
  it('counts status buckets and owner scopes from aggregates', () => {
    expect(statusBucketCount(undefined, 'new')).toBeNull();
    expect(statusBucketCount(aggregates, '')).toBe(10);
    expect(statusBucketCount(aggregates, 'new')).toBe(4);
    expect(statusBucketCount(aggregates, 'awaiting_decision')).toBe(1);
    expect(ownerScopeCount(aggregates, 'unclaimed')).toBe(6);
    expect(ownerScopeCount(aggregates, 'mine')).toBe(2);
    expect(ownerScopeCount(aggregates, 'others')).toBe(2);
  });

  it('groups bank statements vs analyst notes', () => {
    const groups = groupAttachments([
      file('1', 'sales_bank_statement'),
      file('2', 'analyst_note'),
    ]);
    expect(groups[0]?.label).toBe('Bank statements');
    expect(groups[0]?.files).toHaveLength(1);
    expect(groups[1]?.label).toBe('Analyst notes');
    expect(attachmentScopeLabel('sales_bank_statement')).toBe('Bank statement');
    expect(attachmentScopeLabel('analyst_note')).toBe('Analyst note');
  });

  it('tints LOC vs prepay and matches mine', () => {
    expect(paymentTone('LOC')).toBe('is-info');
    expect(paymentTone('Prepay')).toBe('is-on');
    expect(ownerMatchesViewer('Ada', 'ada')).toBe(true);
    expect(CASE_EXPORT_COLUMNS).toEqual([
      'Company',
      'Zoho id',
      'DOT',
      'Status',
      'Queue',
      'Owner',
      'Limit',
      'Payment',
      'Cycle',
    ]);
  });
});
