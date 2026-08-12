import { describe, expect, it } from 'vitest';
import type { PipelineSnapshot } from '@/api/verification';
import {
  creditDecisionKind,
  creditDecisionTone,
  creditVerificationNote,
  deskDecisionLabel,
  pipelineIsApproved,
  platformCreditLabel,
  wexStatusDisplay,
  zohoCreditDisplay,
} from './verificationFields';

describe('credit decision presentation', () => {
  it('treats declined-prepay as a warn path, not a hard reject', () => {
    expect(creditDecisionKind('Declined-Prepay/Secured Only')).toBe('declined_prepay');
    expect(creditDecisionTone('Declined-Prepay/Secured Only')).toBe('warn');
    expect(creditDecisionTone('Declined')).toBe('danger');
    expect(creditDecisionTone('Approved-Requested')).toBe('ok');
  });

  it('explains declined-prepay while verification is still in progress', () => {
    expect(
      creditVerificationNote({
        creditDecision: 'Declined-Prepay/Secured Only',
        verificationState: 'in_progress',
      }),
    ).toMatch(/prepay\/secured only/i);
    expect(
      creditVerificationNote({
        creditDecision: 'Approved-Requested',
        verificationState: 'approved',
      }),
    ).toBeNull();
  });
});

describe('WEX status display', () => {
  it('keeps the raw WEX value and only uses the bucket for tone/shorthand', () => {
    const wex = wexStatusDisplay('Pending Decision');
    expect(wex).toEqual({
      raw: 'Pending Decision',
      tone: 'muted',
      bucketLabel: 'Review',
    });
  });
});

describe('Zoho Credit Decision', () => {
  it('prints the raw picklist and a clear empty state', () => {
    expect(zohoCreditDisplay('Approved-Requested')).toEqual({
      text: 'Approved-Requested',
      tone: 'ok',
      empty: false,
    });
    expect(zohoCreditDisplay('Declined-Prepay/Secured Only')).toEqual({
      text: 'Declined-Prepay/Secured Only',
      tone: 'warn',
      empty: false,
    });
    expect(zohoCreditDisplay(null)).toEqual({ text: 'Not decided yet', tone: 'muted', empty: true });
    expect(zohoCreditDisplay('  ')).toEqual({ text: 'Not decided yet', tone: 'muted', empty: true });
  });
});

describe('verification desk label', () => {
  it('is a separate desk outcome, not the Credit Decision headline', () => {
    expect(deskDecisionLabel({ outcome: 'rejected', reason: 'Prepay required' })).toEqual({
      text: 'Prepay',
      tone: 'warn',
    });
    expect(deskDecisionLabel({ outcome: 'rejected', reason: 'Fraud' })).toEqual({
      text: 'Not Accepted',
      tone: 'danger',
    });
    expect(
      platformCreditLabel(
        { verificationState: 'in_progress', cpPaymentType: null, creditDecision: 'Approved-Requested' },
        { outcome: 'rejected', reason: 'Prepay required' },
      ),
    ).toEqual({ text: 'Prepay', tone: 'warn' });
  });
});

describe('approved pipeline collapse', () => {
  const snapshot = (over: Partial<PipelineSnapshot> = {}): PipelineSnapshot => ({
    requestId: 'req-1',
    status: 'APPROVED',
    updatedAt: null,
    stages: [
      { id: 'stop-factor-pre', order: 1, label: 'Pre Stop Factors', status: 'done' },
      { id: 'blacklist', order: 2, label: 'Black List Match', status: 'skipped' },
    ],
    decision: { outcome: 'loc' },
    requirements: [],
    events: [],
    attachments: [],
    source: 'credit_platform',
    ...over,
  });

  it('hides steps when the request is approved or every used stage succeeded', () => {
    expect(pipelineIsApproved(snapshot(), 'approved')).toBe(true);
    expect(pipelineIsApproved(snapshot(), 'in_progress')).toBe(true);
    expect(pipelineIsApproved(snapshot({ decision: { outcome: 'undecided' } }), 'in_progress')).toBe(false);
    expect(
      pipelineIsApproved(
        snapshot({
          decision: { outcome: 'loc' },
          stages: [{ id: 'stop-factor-pre', order: 1, label: 'Pre Stop Factors', status: 'pending' }],
        }),
        'in_progress',
      ),
    ).toBe(false);
  });
});
