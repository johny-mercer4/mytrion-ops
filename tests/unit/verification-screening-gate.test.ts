/**
 * WHO MAY SCREEN, AND WHEN. Phase 3 is the one desk call a RED case allows.
 *
 * `loadWorkable` refuses a case Sales has not submitted, and for every decision on the desk that is
 * correct — a reviewer must not sign off on a file that is still being typed. It was wrong for the ban
 * list. Screening needs a name, an email, a phone and an authority number, and all four arrive with
 * the Deal; making the check wait for intake to complete means an agent can spend a week collecting
 * documents for an applicant who was banned the entire time. `loadScreenable` is the narrower gate:
 * intake completeness is not required, a DECISION on the case still is.
 *
 * The split is the whole point of these tests. `runScreening` observes; `setScreeningVerdict` decides.
 * Letting the second one through on a red case would put a verdict — and, through
 * `decline_blacklist`, a decline and a Collections notification — on a file Sales has not finished.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deskService } from '../../src/modules/verificationFlow/deskService.js';
import { verificationFlowRepo } from '../../src/repos/verificationFlowRepo.js';
import { verificationScreeningRepo } from '../../src/repos/verificationScreeningRepo.js';
import { runCaseScreening } from '../../src/modules/verificationFlow/deskScreening.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

vi.mock('../../src/repos/verificationFlowRepo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/repos/verificationFlowRepo.js')>();
  return { ...mod, verificationFlowRepo: { findById: vi.fn() } };
});

vi.mock('../../src/modules/verificationFlow/deskScreening.js', () => ({
  runCaseScreening: vi.fn(),
  blacklistCaseIdentifiers: vi.fn(),
}));

vi.mock('../../src/repos/verificationScreeningRepo.js', () => ({
  verificationScreeningRepo: { setVerdict: vi.fn() },
}));

const findById = vi.mocked(verificationFlowRepo.findById);
const screen = vi.mocked(runCaseScreening);
const setVerdict = vi.mocked(verificationScreeningRepo.setVerdict);

const AGENT = {
  tenantId: 't1',
  userId: 'zoho:credit-1',
  userName: 'Sarvar Asqarov',
  role: 'worker',
  departments: ['verification'],
  scopes: [],
} as unknown as TenantContext;

/** A case Sales has NOT submitted: red, two items outstanding, undecided. */
function redCase(over: Record<string, unknown> = {}) {
  return {
    id: 'vc_1',
    tenantId: 't1',
    verificationProcess: false,
    intakeMissing: ['Bank statements', 'Driver licence'],
    closedAt: null,
    statusCode: 'intake_incomplete',
    phaseCode: 'p1_intake',
    ...over,
  };
}

const detailSpy = vi
  .spyOn(deskService, 'detail')
  .mockResolvedValue({ case: { id: 'vc_1' } } as never);

beforeEach(() => {
  findById.mockReset();
  screen.mockReset();
  setVerdict.mockReset();
  detailSpy.mockClear();
  setVerdict.mockResolvedValue({ id: 'hit_1' } as never);
});

describe('screening a case Sales has not finished', () => {
  it('RUNS — a banned applicant is worth knowing about before the document chase', async () => {
    findById.mockResolvedValue(redCase() as never);
    await deskService.runScreening(AGENT, 'vc_1');
    expect(screen).toHaveBeenCalledTimes(1);
    const [, row] = screen.mock.calls[0]!;
    expect(row.verificationProcess).toBe(false);
  });

  it('still runs once intake IS complete — the gate was relaxed, not inverted', async () => {
    findById.mockResolvedValue(redCase({ verificationProcess: true, intakeMissing: [] }) as never);
    await deskService.runScreening(AGENT, 'vc_1');
    expect(screen).toHaveBeenCalledTimes(1);
  });

  /**
   * A verdict is a decision, and `confirmed` on a blacklist hit is what drives Decline + Blacklist +
   * inform Collections. That must not be reachable on a file Sales is still filling in.
   */
  it('REFUSES a verdict on the same case, with the intake-incomplete refusal', async () => {
    findById.mockResolvedValue(redCase() as never);
    await expect(
      deskService.setScreeningVerdict(AGENT, 'vc_1', 'hit_1', { verdict: 'confirmed' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'VERIFICATION_INTAKE_INCOMPLETE' });
    expect(setVerdict).not.toHaveBeenCalled();
  });

  it('names how many items are outstanding, so the refusal is actionable', async () => {
    findById.mockResolvedValue(redCase() as never);
    await expect(
      deskService.setScreeningVerdict(AGENT, 'vc_1', 'hit_1', { verdict: 'confirmed' }),
    ).rejects.toThrow(/2 item\(s\) outstanding/);
  });
});

describe('what screening still refuses', () => {
  /** Re-screening a decided case would rewrite the findings the decision was recorded against. */
  it('refuses a DECIDED case, complete or not', async () => {
    findById.mockResolvedValue(
      redCase({ verificationProcess: true, closedAt: new Date('2026-08-11T10:00:00Z') }) as never,
    );
    await expect(deskService.runScreening(AGENT, 'vc_1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'VERIFICATION_CASE_CLOSED',
    });
    expect(screen).not.toHaveBeenCalled();
  });

  it('refuses a case that does not exist', async () => {
    findById.mockResolvedValue(undefined as never);
    await expect(deskService.runScreening(AGENT, 'vc_1')).rejects.toMatchObject({ statusCode: 404 });
  });

  /** Tenant isolation is the repo's job, but the gate must not reach past it. */
  it('reads the case through the tenant-scoped repo, never by bare id', async () => {
    findById.mockResolvedValue(redCase() as never);
    await deskService.runScreening(AGENT, 'vc_1');
    expect(findById).toHaveBeenCalledWith(AGENT, 'vc_1');
  });
});
