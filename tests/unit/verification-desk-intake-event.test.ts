/**
 * The desk's "Save corrections" has to reach the Phase log.
 *
 * WHY THIS EXISTS. The log is composed from `verification_case_events`, and correcting the
 * application was the one mutation on a case that wrote none: `verificationFlowRepo.patchIntake`
 * writes columns and nothing else, and `setGate` appends only when the gate actually FLIPS. So a
 * reviewer who fixed an EIN on a still-incomplete case saw the Phase log unchanged and had no way to
 * tell the save had landed. `CaseAside.eventText` has rendered an `intake_saved` row since the log
 * was built — there was simply no writer.
 *
 * The second half of the contract is that an UNCHANGED save writes nothing. The intake route accepts
 * `{}` as a no-op read, and the desk's pane submits only the fields it edited, so appending
 * unconditionally would file an event every time somebody re-typed a value that was already there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { patchIntakeMock, appendEventMock } = vi.hoisted(() => ({
  patchIntakeMock: vi.fn(),
  appendEventMock: vi.fn(),
}));

vi.mock('../../src/repos/verificationFlowRepo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/repos/verificationFlowRepo.js')>();
  return {
    ...mod,
    verificationFlowRepo: {
      ...mod.verificationFlowRepo,
      patchIntake: patchIntakeMock,
      appendEvent: appendEventMock,
    },
  };
});

import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { saveIntakeCorrection } from '../../src/modules/verificationFlow/deskIntake.js';
import type { VerificationCase } from '../../src/db/schema/index.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const ctx: TenantContext = {
  tenantId: DEFAULT_TENANT_ID,
  userId: 'zoho:272001',
  userName: 'Sarvar Asqarov',
  audience: 'internal',
  role: 'admin',
  scopes: [],
  departments: ['verification'],
  allDepartmentAccess: true,
  requestId: 'req_test',
};

/**
 * Only the columns this module reads. The cast is the test's own claim about that — a full
 * `verification_cases` row is ~70 columns and none of the rest reaches `saveIntakeCorrection`.
 */
function caseRow(over: Record<string, unknown> = {}): VerificationCase {
  return {
    id: 'vc_1',
    phaseCode: 'p1_intake',
    statusCode: 'intake_incomplete',
    ein: '11-1111111',
    dot: null,
    trucksCount: 3,
    ...over,
  } as unknown as VerificationCase;
}

beforeEach(() => {
  patchIntakeMock.mockReset();
  appendEventMock.mockReset();
});

describe('saveIntakeCorrection', () => {
  it('appends an intake_saved event when the write moved a column', async () => {
    const before = caseRow();
    patchIntakeMock.mockResolvedValue(caseRow({ ein: '22-2222222' }));

    await saveIntakeCorrection(ctx, before, { ein: '22-2222222' });

    expect(patchIntakeMock).toHaveBeenCalledWith(ctx, 'vc_1', { ein: '22-2222222' });
    expect(appendEventMock).toHaveBeenCalledTimes(1);
    expect(appendEventMock.mock.calls[0]?.[1]).toMatchObject({
      caseId: 'vc_1',
      eventType: 'intake_saved',
      fromPhase: 'p1_intake',
      toPhase: 'p1_intake',
      fromStatus: 'intake_incomplete',
      toStatus: 'intake_incomplete',
      // The zoho: prefix is stripped, so the actor joins on the same id every other event uses.
      actorZohoUserId: '272001',
      actorName: 'Sarvar Asqarov',
      notes: 'One application field corrected by the desk.',
    });
  });

  it('counts the fields that actually moved, not the fields submitted', async () => {
    const before = caseRow({ ein: '11-1111111', dot: '123456', trucksCount: 3 });
    // `trucksCount` was re-submitted unchanged; only two of the three are corrections.
    patchIntakeMock.mockResolvedValue(
      caseRow({ ein: '22-2222222', dot: '999999', trucksCount: 3 }),
    );

    await saveIntakeCorrection(ctx, before, { ein: '22-2222222', dot: '999999', trucksCount: 3 });

    expect(appendEventMock.mock.calls[0]?.[1]).toMatchObject({
      notes: '2 application fields corrected by the desk.',
    });
  });

  it('writes NO event when nothing changed', async () => {
    const before = caseRow();
    patchIntakeMock.mockResolvedValue(caseRow());

    await saveIntakeCorrection(ctx, before, { ein: '11-1111111' });

    expect(patchIntakeMock).toHaveBeenCalledTimes(1);
    expect(appendEventMock).not.toHaveBeenCalled();
  });

  it('writes NO event for the empty patch the route accepts as a no-op read', async () => {
    patchIntakeMock.mockResolvedValue(caseRow());

    await saveIntakeCorrection(ctx, caseRow(), {});

    expect(appendEventMock).not.toHaveBeenCalled();
  });

  /**
   * A null and an empty string are the same absence to the form, and `nullableText` maps '' to null
   * before it reaches here — so clearing an already-empty field must not read as a correction.
   */
  it('treats a cleared empty field as unchanged', async () => {
    const before = caseRow({ dot: null });
    patchIntakeMock.mockResolvedValue(caseRow({ dot: null }));

    await saveIntakeCorrection(ctx, before, { dot: null });

    expect(appendEventMock).not.toHaveBeenCalled();
  });

  it('does not append when the update found no row', async () => {
    patchIntakeMock.mockResolvedValue(undefined);

    await saveIntakeCorrection(ctx, caseRow(), { ein: '22-2222222' });

    expect(appendEventMock).not.toHaveBeenCalled();
  });
});
