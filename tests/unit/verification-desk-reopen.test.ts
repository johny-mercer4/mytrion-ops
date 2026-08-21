/**
 * Reopening a phase — the desk's way back through a rail that only ever moved forward.
 *
 * A phase signed off on the wrong reading, or on facts a later correction changed, had no remedy short
 * of a database edit. What this pins is the POLICY, because the guards are the whole feature: a decided
 * case is out of reach, a phase that does not apply cannot be reopened, a reason is required, and
 * everything downstream is un-decided while the findings recorded on it survive.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deskService } from '../../src/modules/verificationFlow/deskService.js';
import { verificationCaseAssetRepo } from '../../src/repos/verificationCaseAssetRepo.js';
import { verificationFlowRepo } from '../../src/repos/verificationFlowRepo.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

vi.mock('../../src/repos/verificationFlowRepo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/repos/verificationFlowRepo.js')>();
  return {
    ...mod,
    verificationFlowRepo: { findById: vi.fn(), reopenTo: vi.fn() },
  };
});

vi.mock('../../src/repos/verificationCaseAssetRepo.js', () => ({
  verificationCaseAssetRepo: { reopenPhase: vi.fn() },
}));

const findById = vi.mocked(verificationFlowRepo.findById);
const reopenTo = vi.mocked(verificationFlowRepo.reopenTo);
const reopenPhaseRows = vi.mocked(verificationCaseAssetRepo.reopenPhase);

const AGENT = {
  tenantId: 't1',
  userId: 'zoho:credit-1',
  userName: 'Sarvar Asqarov',
  role: 'worker',
  departments: ['verification'],
  scopes: [],
} as unknown as TenantContext;

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'vc_1',
    tenantId: 't1',
    verificationProcess: true,
    statusCode: 'in_review',
    phaseCode: 'p6_credit_banking',
    closedAt: null,
    intakeMissing: [],
    applicantType: 'carrier',
    ...over,
  };
}

/** `detail` reads far more than this suite mocks; the guards run before it. */
const detailSpy = vi
  .spyOn(deskService, 'detail')
  .mockResolvedValue({ case: { id: 'vc_1' } } as never);

beforeEach(() => {
  findById.mockReset();
  reopenTo.mockReset();
  reopenPhaseRows.mockReset();
  detailSpy.mockClear();
  findById.mockResolvedValue(row() as never);
});

describe('what may be reopened', () => {
  it('sends the case back to the phase and un-decides it', async () => {
    await deskService.reopenPhase(AGENT, 'vc_1', 'p3_screening', { reason: 'Blacklist hit was a false match' });

    expect(reopenTo).toHaveBeenCalledWith(AGENT, 'vc_1', {
      phaseCode: 'p3_screening',
      statusCode: 'in_review',
      reason: 'Blacklist hit was a false match',
      actorZohoUserId: 'credit-1',
      actorName: 'Sarvar Asqarov',
    });
  });

  /**
   * A phase 5 sign-off was made on facts phase 3 has now reopened. Keeping it green would leave a rail
   * claiming five passes on a case that has re-entered the third.
   */
  it('un-decides every applicable phase after it, and nothing before', async () => {
    await deskService.reopenPhase(AGENT, 'vc_1', 'p3_screening', { reason: 'reworking screening' });

    const [, , input] = reopenPhaseRows.mock.calls[0]!;
    expect(input.phaseCode).toBe('p3_screening');
    expect(input.codesAfter).not.toContain('p1_intake');
    expect(input.codesAfter).not.toContain('p2_identity');
    expect(input.codesAfter).not.toContain('p3_screening');
    expect(input.codesAfter).toContain('p6_credit_banking');
    expect(input.codesAfter).toContain('p10_decision');
  });

  /**
   * A carrier skips no phases; an owner-operator skips Authority (4) and Highway (8). Resetting a phase
   * that does not apply would make it read as outstanding on a case that can never clear it.
   */
  it('leaves phases that do not apply out of the reset', async () => {
    findById.mockResolvedValue(row({ applicantType: 'owner_operator' }) as never);
    await deskService.reopenPhase(AGENT, 'vc_1', 'p2_identity', { reason: 'licence was the wrong person' });

    const [, , input] = reopenPhaseRows.mock.calls[0]!;
    expect(input.codesAfter).not.toContain('p4_authority');
    expect(input.codesAfter).not.toContain('p8_highway');
    expect(input.codesAfter).toContain('p3_screening');
  });

  it('rewrites the phase rows BEFORE moving the case', async () => {
    await deskService.reopenPhase(AGENT, 'vc_1', 'p3_screening', { reason: 'rework' });
    // A case pointed at a phase whose row still reads `passed` is a rail that contradicts itself; the
    // rows go first so no read in between can see that.
    expect(reopenPhaseRows.mock.invocationCallOrder[0]!).toBeLessThan(
      reopenTo.mock.invocationCallOrder[0]!,
    );
  });
});

describe('what may not', () => {
  it('refuses a decided case — un-approving a credit line is a separate act', async () => {
    findById.mockResolvedValue(row({ statusCode: 'approved', closedAt: new Date() }) as never);
    await expect(
      deskService.reopenPhase(AGENT, 'vc_1', 'p6_credit_banking', { reason: 'wrong limit' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'VERIFICATION_CASE_CLOSED' });
    expect(reopenTo).not.toHaveBeenCalled();
  });

  it('refuses a case still with Sales', async () => {
    findById.mockResolvedValue(row({ verificationProcess: false }) as never);
    await expect(
      deskService.reopenPhase(AGENT, 'vc_1', 'p1_intake', { reason: 'rework' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'VERIFICATION_INTAKE_INCOMPLETE' });
  });

  it('refuses a phase that does not apply to this applicant', async () => {
    findById.mockResolvedValue(row({ applicantType: 'owner_operator' }) as never);
    await expect(
      deskService.reopenPhase(AGENT, 'vc_1', 'p4_authority', { reason: 'rework' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'VERIFICATION_PHASE_NOT_APPLICABLE' });
    expect(reopenPhaseRows).not.toHaveBeenCalled();
  });

  it('refuses an unknown phase code', async () => {
    await expect(
      deskService.reopenPhase(AGENT, 'vc_1', 'p99_nonsense', { reason: 'rework' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  /** It withdraws work somebody else recorded, so the timeline has to say why. */
  it('refuses a blank reason', async () => {
    await expect(
      deskService.reopenPhase(AGENT, 'vc_1', 'p3_screening', { reason: '   ' }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VERIFICATION_REOPEN_REASON_REQUIRED' });
    expect(reopenTo).not.toHaveBeenCalled();
  });
});
