/**
 * The fields Zoho stores flat and this schema derives.
 *
 * The point of these is that the derived answer matches what Zoho would have had in the column,
 * so a collector reading the Mytrion record sees the same thing they saw in the CRM.
 */
import { describe, expect, it } from 'vitest';
import { buildCaseDossier, type DossierInputs } from '../../src/modules/collection/caseDossier.js';

const NOW = new Date('2026-08-20T12:00:00Z');

function inputs(over: Partial<DossierInputs> = {}): DossierInputs {
  return {
    totalDebtAmount: '10000',
    totalAmountPaid: '0',
    currentAgency: null,
    promise: null,
    plan: null,
    lastContact: null,
    contactStats: null,
    lastStageChangeAt: null,
    caseUpdatedAt: '2026-08-19T09:00:00.000Z',
    caseCreatedDate: '2026-04-10',
    ...over,
  };
}

describe('promise and plan mirrors', () => {
  it('speaks Zoho’s words for a promise', () => {
    expect(buildCaseDossier(inputs({ promise: { dueDate: '2026-09-01', status: 'open' } }), NOW))
      .toMatchObject({ promiseStatus: 'Pending', promiseToPayDate: '2026-09-01' });
    expect(buildCaseDossier(inputs({ promise: { dueDate: '2026-07-01', status: 'kept' } }), NOW))
      .toMatchObject({ promiseStatus: 'Kept' });
    expect(buildCaseDossier(inputs({ promise: { dueDate: '2026-07-01', status: 'broken' } }), NOW))
      .toMatchObject({ promiseStatus: 'Failed' });
  });

  it('reads a weekly plan the way Zoho’s four columns did', () => {
    const d = buildCaseDossier(
      inputs({
        plan: {
          frequency: 'weekly',
          instalmentAmount: '250.00',
          instalments: [
            { dueDate: '2026-08-01', status: 'paid' },
            { dueDate: '2026-08-08', status: 'missed' },
            { dueDate: '2026-08-15', status: 'scheduled' },
            { dueDate: '2026-08-22', status: 'scheduled' },
          ],
        },
      }),
      NOW,
    );
    expect(d.paymentPlanCreated).toBe(true);
    expect(d.paymentPlanType).toBe('Weekly');
    expect(d.weeklyPaymentAmount).toBe('250.00');
    // The next payment EXPECTED, not the one already missed.
    expect(d.nextPaymentDueDate).toBe('2026-08-15');
  });

  it('calls a cadence Zoho has no word for Custom, rather than rounding it', () => {
    const plan = { frequency: 'fortnightly', instalmentAmount: '500', instalments: [] };
    const d = buildCaseDossier(inputs({ plan }), NOW);
    expect(d.paymentPlanType).toBe('Custom');
    expect(d.weeklyPaymentAmount).toBeNull();
  });

  it('reports no plan as no plan, not as an empty one', () => {
    const d = buildCaseDossier(inputs(), NOW);
    expect(d.paymentPlanCreated).toBe(false);
    expect(d.paymentPlanType).toBeNull();
    expect(d.nextPaymentDueDate).toBeNull();
  });
});

describe('contact mirrors', () => {
  it('translates the desk’s channels and outcomes into Zoho’s labels', () => {
    const d = buildCaseDossier(
      inputs({
        lastContact: { channel: 'sms', outcome: 'wrong_number', occurredAt: '2026-08-18T10:00:00.000Z' },
        contactStats: { attempts: 7, firstContactAt: '2026-05-02T08:30:00.000Z' },
      }),
      NOW,
    );
    expect(d).toMatchObject({
      contactMethod: 'SMS',
      contactResult: 'Wrong Number',
      totalContactAttempts: 7,
      firstContactDate: '2026-05-02',
      lastActivityDate: '2026-08-18T10:00:00.000Z',
    });
  });

  it('folds voicemail into No Answer, which is what Zoho offered', () => {
    const d = buildCaseDossier(
      inputs({ lastContact: { channel: 'call', outcome: 'voicemail', occurredAt: '2026-08-01T00:00:00.000Z' } }),
      NOW,
    );
    expect(d.contactResult).toBe('No Answer');
  });

  it('falls back to the case’s own timestamp when nothing has been logged', () => {
    const d = buildCaseDossier(inputs(), NOW);
    expect(d.lastActivityDate).toBe('2026-08-19T09:00:00.000Z');
    expect(d.totalContactAttempts).toBe(0);
    expect(d.firstContactDate).toBeNull();
  });
});

describe('stage clock', () => {
  it('counts from the last stage move', () => {
    const d = buildCaseDossier(inputs({ lastStageChangeAt: '2026-08-05T14:00:00.000Z' }), NOW);
    expect(d.lastStageChangeDate).toBe('2026-08-05');
    expect(d.daysInCurrentStage).toBe(15);
  });

  it('counts from the day the case opened when the stage has never moved', () => {
    // A case sitting in Intake since April has been there since April, not since today.
    const d = buildCaseDossier(inputs(), NOW);
    expect(d.lastStageChangeDate).toBeNull();
    expect(d.daysInCurrentStage).toBe(132);
  });
});

describe('the formula fields Zoho would not hand over', () => {
  it('computes remaining, the agency cut, and the all-in figure', () => {
    const d = buildCaseDossier(
      inputs({ totalDebtAmount: '10000', totalAmountPaid: '2500', currentAgency: 'Trust Altus' }),
      NOW,
    );
    expect(d.totalRemainingAmount).toBe('7500.00');
    expect(d.agencyFee).toBe('1500.00');
    expect(d.totalDebtWithFee).toBe('11500.00');
  });

  it('floors remaining at zero — an overpayment is a credit question, not a debt', () => {
    const d = buildCaseDossier(inputs({ totalDebtAmount: '100', totalAmountPaid: '250' }), NOW);
    expect(d.totalRemainingAmount).toBe('0.00');
  });

  it('leaves the fee null for an agency with no known rate, and does not inflate the total', () => {
    const d = buildCaseDossier(inputs({ currentAgency: 'GG&R' }), NOW);
    expect(d.agencyFee).toBeNull();
    expect(d.totalDebtWithFee).toBe('10000.00');
  });
});
