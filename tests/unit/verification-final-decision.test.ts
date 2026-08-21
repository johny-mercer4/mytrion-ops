/**
 * Phase 10 — what each of the seven outcomes requires before it can be recorded.
 *
 * The old `decide` asked for one thing: a limit, on approve. Everything else could be recorded with no
 * reason at all, against an SOP that says "record reason and conditions" and "record specific decline
 * reason" in as many words — and `pending_docs` could park a case with no record of what anyone was
 * waiting for, which left `resumeAfterDocuments` with no phase to return to.
 *
 * These tests pin each rule to the SOP line it comes from, and pin the two things that must NOT be
 * refused: a reduced limit, and a tier the policy cannot price.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const applyTransition = vi.fn();
const patchIntake = vi.fn();
const findRisk = vi.fn();
const listOutstandingRequests = vi.fn();
const listDocuments = vi.fn();
const blacklistCaseIdentifiers = vi.fn();
const detail = vi.fn();
const loadWorkable = vi.fn();

const CASE = {
  id: 'vc_test',
  phaseCode: 'p10_decision',
  applicantType: 'carrier',
  companyName: 'Acme Freight LLC',
};

vi.mock('../../src/repos/verificationFlowRepo.js', () => ({
  verificationFlowRepo: { applyTransition, patchIntake },
  listWhere: {},
}));
vi.mock('../../src/repos/verificationReviewRepo.js', () => ({
  verificationReviewRepo: { findRisk },
  toNumber: (v: unknown) => (v === null || v === undefined ? null : Number(v)),
}));
vi.mock('../../src/repos/verificationCaseAssetRepo.js', () => ({
  verificationCaseAssetRepo: { listOutstandingRequests, listDocuments },
}));
vi.mock('../../src/modules/verificationFlow/deskScreening.js', () => ({
  blacklistCaseIdentifiers,
}));
vi.mock('../../src/modules/verificationFlow/deskService.js', () => ({
  deskService: { detail },
  loadWorkable,
}));
vi.mock('../../src/modules/verificationFlow/applicationService.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/modules/verificationFlow/applicationService.js')>();
  return { ...actual, zohoFromCtx: () => 'zoho-desk' };
});

const { recordFinalDecision } = await import('../../src/modules/verificationFlow/deskDecision.js');

const ctx = { tenantId: 't1', userId: 'u1', userName: 'Reviewer' } as never;

/** The findings blob the transition was called with — where each arm records what it decided. */
const findings = (): Record<string, unknown> =>
  (applyTransition.mock.calls[0]![2] as { findings: Record<string, unknown> }).findings;

const transition = (): Record<string, unknown> =>
  applyTransition.mock.calls[0]![2] as Record<string, unknown>;

beforeEach(() => {
  for (const m of [
    applyTransition,
    patchIntake,
    findRisk,
    listOutstandingRequests,
    listDocuments,
    blacklistCaseIdentifiers,
    detail,
    loadWorkable,
  ]) {
    m.mockReset();
  }
  loadWorkable.mockResolvedValue(CASE);
  detail.mockResolvedValue({ ok: true });
  findRisk.mockResolvedValue({ recommendedLimit: '4000.00', riskTier: 'strong' });
  listOutstandingRequests.mockResolvedValue([]);
  listDocuments.mockResolvedValue([]);
  applyTransition.mockResolvedValue(undefined);
  blacklistCaseIdentifiers.mockResolvedValue({
    local: { added: 5, alreadyListed: 0 },
    platform: { available: true, attempted: 4, inserted: 4 },
  });
});

describe('approve — standard LOC', () => {
  it('refuses with no limit', async () => {
    await expect(recordFinalDecision(ctx, 'vc_test', { decision: 'approve' })).rejects.toThrow(
      /approved credit limit is required/i,
    );
    expect(applyTransition).not.toHaveBeenCalled();
  });

  it('refuses when Phase 9 never assessed the case', async () => {
    findRisk.mockResolvedValue(undefined);
    await expect(
      recordFinalDecision(ctx, 'vc_test', { decision: 'approve', approvedLimit: 4000 }),
    ).rejects.toThrow(/Phase 9 before approving/i);
  });

  it('records the limit on the case and closes it', async () => {
    await recordFinalDecision(ctx, 'vc_test', { decision: 'approve', approvedLimit: 4000 });
    expect(transition().closed).toBe(true);
    expect(transition().outcome).toBe('pass');
    expect(patchIntake).toHaveBeenCalledWith(ctx, 'vc_test', { approvedLimitAmount: '4000' });
  });

  it('allows a REDUCED limit with no reason — the SOP lets a manager approve one', async () => {
    await recordFinalDecision(ctx, 'vc_test', { decision: 'approve', approvedLimit: 1500 });
    expect(findings().exceptionOverRecommended).toBeUndefined();
  });

  it('refuses a limit ABOVE the recommendation with no reason', async () => {
    await expect(
      recordFinalDecision(ctx, 'vc_test', { decision: 'approve', approvedLimit: 9000 }),
    ).rejects.toThrow(/above the recommended limit/i);
  });

  it('records an over-recommended approval as a management exception', async () => {
    await recordFinalDecision(ctx, 'vc_test', {
      decision: 'approve',
      approvedLimit: 9000,
      note: 'Manager approved against the relationship',
    });
    expect(findings().exceptionOverRecommended).toBe(true);
    expect(findings().recommendedLimitAtDecision).toBe(4000);
  });

  it('claims no exception when the tier had no priceable factor', async () => {
    // The SOP leaves the moderate and weak factors to approved policy, so a tier can be assessed
    // with no limit to compare against. That is an absence, not a ceiling of zero.
    findRisk.mockResolvedValue({ recommendedLimit: null, riskTier: 'weak' });
    await recordFinalDecision(ctx, 'vc_test', { decision: 'approve', approvedLimit: 9000 });
    expect(findings().exceptionOverRecommended).toBeUndefined();
  });
});

describe('the outcomes that must carry a reason', () => {
  it.each([
    ['deposit_prepaid', /reason and the conditions/i],
    ['manager_review', /what is being referred/i],
    ['declined_customer', /specific reason the applicant gave/i],
    ['decline', /reason for the decline/i],
    ['decline_blacklist', /stored on the blacklist entry/i],
  ] as const)('refuses %s with none', async (decision, message) => {
    await expect(recordFinalDecision(ctx, 'vc_test', { decision })).rejects.toThrow(message);
    expect(applyTransition).not.toHaveBeenCalled();
  });

  it('treats whitespace as no reason at all', async () => {
    await expect(
      recordFinalDecision(ctx, 'vc_test', { decision: 'decline', note: '   ' }),
    ).rejects.toThrow(/reason for the decline/i);
  });
});

describe('deposit 1:1 / prepaid', () => {
  it('refuses without the arrangement — the status column cannot say which', async () => {
    await expect(
      recordFinalDecision(ctx, 'vc_test', { decision: 'deposit_prepaid', note: 'Thin file' }),
    ).rejects.toThrow(/1:1 deposit or a prepaid account/i);
  });

  it('records which arrangement it is, and the secured amount', async () => {
    await recordFinalDecision(ctx, 'vc_test', {
      decision: 'deposit_prepaid',
      note: 'Thin file, deposit agreed',
      instrument: 'deposit_1_1',
      approvedLimit: 2000,
    });
    expect(findings().instrument).toBe('deposit_1_1');
    expect(patchIntake).toHaveBeenCalledWith(ctx, 'vc_test', { approvedLimitAmount: '2000' });
  });
});

describe('pending documents', () => {
  it('refuses with nothing outstanding — there would be no phase to return to', async () => {
    await expect(
      recordFinalDecision(ctx, 'vc_test', { decision: 'pending_docs', note: 'Missing statements' }),
    ).rejects.toThrow(/Request the missing documents first/i);
  });

  it('records the phase the hold will return to, and keeps the case open', async () => {
    listOutstandingRequests.mockResolvedValue([
      { id: 'd1', requestedInPhase: 'p6_credit_banking', status: 'requested' },
    ]);
    listDocuments.mockResolvedValue([
      { id: 'd1', requestedInPhase: 'p6_credit_banking', status: 'requested' },
    ]);
    await recordFinalDecision(ctx, 'vc_test', {
      decision: 'pending_docs',
      note: 'Missing page 3',
    });
    expect(findings().returnPhase).toBe('p6_credit_banking');
    expect(findings().outstandingDocuments).toBe(1);
    expect(transition().closed).toBe(false);
  });
});

describe('the two outcomes that keep the case open', () => {
  it.each(['manager_review', 'pending_docs'] as const)('does not close on %s', async (decision) => {
    listOutstandingRequests.mockResolvedValue([{ id: 'd1', requestedInPhase: 'p4_authority' }]);
    listDocuments.mockResolvedValue([{ id: 'd1', requestedInPhase: 'p4_authority' }]);
    await recordFinalDecision(ctx, 'vc_test', { decision, note: 'Referred' });
    expect(transition().closed).toBe(false);
    expect(transition().phaseStatus).toBe('manager_review');
  });

  it.each(['approve', 'deposit_prepaid', 'declined_customer', 'decline', 'decline_blacklist'] as const)(
    'closes on %s',
    async (decision) => {
      await recordFinalDecision(ctx, 'vc_test', {
        decision,
        note: 'Reason recorded',
        approvedLimit: 4000,
        instrument: 'prepaid',
      });
      expect(transition().closed).toBe(true);
    },
  );
});

describe('decline + blacklist', () => {
  it('bans the applicant, with the recorded reason', async () => {
    await recordFinalDecision(ctx, 'vc_test', {
      decision: 'decline_blacklist',
      note: 'Confirmed intentional misrepresentation',
    });
    expect(blacklistCaseIdentifiers).toHaveBeenCalledWith(
      ctx,
      CASE,
      'Confirmed intentional misrepresentation',
    );
  });

  it('bans AFTER the decision is recorded, so a failed remote write cannot lose it', async () => {
    await recordFinalDecision(ctx, 'vc_test', { decision: 'decline_blacklist', note: 'Fraud' });
    expect(applyTransition.mock.invocationCallOrder[0]!).toBeLessThan(
      blacklistCaseIdentifiers.mock.invocationCallOrder[0]!,
    );
  });

  it('does not ban on a plain decline', async () => {
    await recordFinalDecision(ctx, 'vc_test', { decision: 'decline', note: 'Insufficient capacity' });
    expect(blacklistCaseIdentifiers).not.toHaveBeenCalled();
  });
});
