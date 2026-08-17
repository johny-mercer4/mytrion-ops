import { describe, expect, it } from 'vitest';
import { mapRequestStatus } from '../../src/modules/verification/caseSync.js';
import {
  normalizeDeskStageId,
  normalizeDeskStageStatus,
} from '../../src/modules/verification/verificationStages.js';

describe('mapRequestStatus', () => {
  it('maps credit-platform request statuses onto verification_cases.status', () => {
    expect(mapRequestStatus('REJECTED')).toBe('rejected');
    expect(mapRequestStatus('FAILED')).toBe('failed');
    expect(mapRequestStatus('ENGINE_ERROR')).toBe('failed');
    expect(mapRequestStatus('COMPLETED')).toBe('approved');
    expect(mapRequestStatus('REVIEW')).toBe('awaiting_decision');
    expect(mapRequestStatus('RUNNING')).toBe('in_progress');
    expect(mapRequestStatus('QUEUED')).toBe('in_progress');
    expect(mapRequestStatus('unknown')).toBe('new');
    expect(mapRequestStatus(null)).toBe('new');
  });
});

describe('decision desk stage normalize', () => {
  it('aliases hyphenated / short stage ids', () => {
    expect(normalizeDeskStageId('stop-factor-pre')).toBe('stop_factor_pre');
    expect(normalizeDeskStageId('plaid')).toBe('plaid_bs');
    expect(normalizeDeskStageId('nope')).toBeNull();
  });

  it('maps flow statuses onto verification_case_stages.status', () => {
    expect(normalizeDeskStageStatus('ready')).toBe('ready');
    expect(normalizeDeskStageStatus('done')).toBe('approved');
    expect(normalizeDeskStageStatus('pass')).toBe('approved');
    expect(normalizeDeskStageStatus('skipped')).toBe('skipped');
    expect(normalizeDeskStageStatus('error')).toBe('failed');
    expect(normalizeDeskStageStatus('')).toBe('pending');
  });
});
