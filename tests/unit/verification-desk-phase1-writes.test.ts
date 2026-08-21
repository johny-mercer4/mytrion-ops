/**
 * Desk Phase-1 writes must open the gate. Attaching the last required file used to leave
 * Pass locked because upload never called refreshGate with submitting: true.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshGate = vi.fn();
const detail = vi.fn();
const publish = vi.fn();

vi.mock('../../src/modules/verificationFlow/applicationService.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/modules/verificationFlow/applicationService.js')>();
  return {
    ...actual,
    applicationService: { ...actual.applicationService, refreshGate },
    zohoFromCtx: () => 'zoho-desk',
  };
});

vi.mock('../../src/modules/verificationFlow/deskService.js', () => ({
  deskService: { detail: (...args: unknown[]) => detail(...args) },
}));

vi.mock('../../src/modules/verification/caseNotify.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/verification/caseNotify.js')>();
  return { ...actual, publishVerificationApplicationEvent: publish };
});

const { afterDeskDocumentUpload, afterDeskDocumentRemove } = await import(
  '../../src/modules/verificationFlow/deskPhase1Writes.js'
);

describe('afterDeskDocumentUpload', () => {
  beforeEach(() => {
    refreshGate.mockReset();
    detail.mockReset();
    publish.mockReset();
    refreshGate.mockResolvedValue({});
    detail.mockResolvedValue({
      case: { id: 'vc_1', verificationOwnerZohoUserId: 'credit-1', verificationProcess: true },
    });
  });

  it('re-evaluates intake as a submit so the last file can unlock Pass', async () => {
    const ctx = { userId: 'u1', userName: 'Credit', tenantId: 'octane' };
    await afterDeskDocumentUpload(ctx as never, 'vc_1');
    expect(refreshGate).toHaveBeenCalledWith(
      ctx,
      'vc_1',
      expect.objectContaining({ submitting: true, actor: 'zoho-desk' }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 'vc_1',
        type: 'verification.application.documents_uploaded',
        verificationOwnerZohoUserId: 'credit-1',
      }),
    );
  });

  it('re-evaluates intake after a remove so a required file can lock the case again', async () => {
    const ctx = { userId: 'u1', userName: 'Credit', tenantId: 'octane' };
    await afterDeskDocumentRemove(ctx as never, 'vc_1');
    expect(refreshGate).toHaveBeenCalledWith(
      ctx,
      'vc_1',
      expect.objectContaining({ submitting: true, actor: 'zoho-desk' }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 'vc_1',
        type: 'verification.application.updated',
        title: 'Application document removed',
      }),
    );
  });
});
