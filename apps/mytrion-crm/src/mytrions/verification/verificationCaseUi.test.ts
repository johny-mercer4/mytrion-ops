import { describe, expect, it } from 'vitest';
import {
  billableRunGate,
  caseIdFromInboxSource,
  caseStatusLabel,
  caseStatusTone,
  groupStageCatalog,
  humanizeToken,
  isClosedCaseStatus,
  queueLabel,
  reviewOwnerLabel,
  stageDisplay,
  stageGroup,
} from './verificationCaseUi';

describe('verificationCaseUi', () => {
  it('parses a case id from an inbox source path', () => {
    expect(caseIdFromInboxSource('/verification/cases/case_abc123')).toBe('case_abc123');
    expect(caseIdFromInboxSource('https://app.example/verification/cases/abc-def-12')).toBe(
      'abc-def-12',
    );
    expect(caseIdFromInboxSource('/inbox')).toBeNull();
    expect(isClosedCaseStatus('approved')).toBe(true);
    expect(isClosedCaseStatus('new')).toBe(false);
  });

  it('maps status to a tinted pill and a human label', () => {
    expect(caseStatusLabel('awaiting_decision')).toBe('Hold');
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

  it('groups auto first-run stages ahead of manual', () => {
    const groups = groupStageCatalog([
      { id: 'stop_factor_pre' },
      { id: 'plaid_bs' },
      { id: 'blacklist' },
      { id: 'isoftpull' },
      { id: 'fmcsa' },
    ]);
    expect(groups.map((g) => g.id)).toEqual(['auto', 'manual']);
    expect(groups[0]?.title).toBe('Auto (first run)');
    expect(groups[0]?.hint).toContain('Does not claim');
    expect(groups[1]?.hint).toContain('HTTP Run claims');
    expect(groups[0]?.stages.map((s) => s.id)).toEqual(['stop_factor_pre', 'blacklist', 'fmcsa']);
    expect(groups[1]?.stages.map((s) => s.id)).toEqual(['plaid_bs', 'isoftpull']);
    expect(stageGroup('fmcsa')).toBe('auto');
    expect(stageGroup('creditsafe')).toBe('manual');
  });

  it('shows empty failed + NOT_FOUND as a no-hit, not an outage', () => {
    expect(
      stageDisplay({
        status: 'failed',
        result: { step_status: 'NOT_FOUND', no_hit: true },
        error: '',
      }),
    ).toMatchObject({
      label: 'No hit',
      tone: 'is-info',
      note: 'No match in FMCSA — not a pipeline outage.',
    });
    expect(stageDisplay({ status: 'failed', error: 'timeout' }).tone).toBe('is-bad');
  });

  it('labels auto vs claimed review owner', () => {
    expect(reviewOwnerLabel(null)).toEqual({ label: 'Auto (unclaimed)', claimed: false });
    expect(reviewOwnerLabel('analyst_1').claimed).toBe(true);
  });

  it('gates billable Run when readiness is missing or unpaid fields are missing', () => {
    expect(billableRunGate({ stageId: 'fmcsa', readinessAvailable: false }).blocked).toBe(false);
    expect(billableRunGate({ stageId: 'isoftpull', readinessAvailable: false }).blocked).toBe(true);
    expect(
      billableRunGate({
        stageId: 'plaid_bs',
        readinessAvailable: true,
        readiness: { ready: false, missing: ['email'], paid: true },
      }).reason,
    ).toContain('email');
    expect(
      billableRunGate({
        stageId: 'isoftpull',
        readinessAvailable: true,
        readiness: { ready: true, missing: [], paid: true, alreadyPaid: true },
      }).reason,
    ).toContain('Already paid');
    expect(
      billableRunGate({
        stageId: 'isoftpull',
        readinessAvailable: true,
        readiness: { ready: true, missing: [], paid: true, circuitOpen: true },
      }).reason,
    ).toContain('circuit');
    expect(
      billableRunGate({
        stageId: 'plaid_bs',
        readinessAvailable: false,
        plaidMode: 'bank_statement',
      }).blocked,
    ).toBe(false);
  });
});
