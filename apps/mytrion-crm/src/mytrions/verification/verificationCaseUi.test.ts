import { describe, expect, it } from 'vitest';
import { caseStatusLabel, caseStatusTone, humanizeToken, queueLabel } from './verificationCaseUi';

describe('verificationCaseUi', () => {
  it('maps status to a tinted pill and a human label', () => {
    expect(caseStatusLabel('awaiting_decision')).toBe('Awaiting decision');
    expect(caseStatusTone('awaiting_decision')).toBe('is-warn');
    expect(caseStatusTone('approved')).toBe('is-on');
    expect(caseStatusTone('rejected')).toBe('is-bad');
    expect(caseStatusTone('failed')).toBe('is-bad');
    expect(caseStatusTone('in_progress')).toBe('is-info');
    expect(caseStatusTone('new')).toBe('is-mute');
  });

  it('labels queue and humanizes tokens without schema names', () => {
    expect(queueLabel('shared')).toBe('Shared');
    expect(queueLabel('personal')).toBe('Personal');
    expect(humanizeToken('awaiting_documents')).toBe('awaiting documents');
    expect(humanizeToken(null)).toBe('—');
  });
});
