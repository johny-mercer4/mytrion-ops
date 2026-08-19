/**
 * Submit is the handover — the Sales write gate, both halves of it.
 *
 * `assertSalesMayEdit` guards the application DATA and closes the moment Sales submits: the figures a
 * reviewer is underwriting (requested limit, card count, EIN, principals) must not move under them.
 * `assertSalesMayAttach` guards UPLOADS and stays open while the case is open, because that is the
 * whole mechanism of Pending Documents — the desk asks for the third bank statement and the agent
 * sends it without a second pass over the form.
 *
 * The two used to be ONE gate that allowed writes in `intake_submitted` and `pending_docs`, which
 * meant an agent could rewrite the limit on a case a credit agent was already reading.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applicationService } from '../../src/modules/verificationFlow/applicationService.js';
import { verificationFlowRepo } from '../../src/repos/verificationFlowRepo.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

vi.mock('../../src/repos/verificationFlowRepo.js', () => ({
  verificationFlowRepo: { findById: vi.fn() },
}));

const findById = vi.mocked(verificationFlowRepo.findById);

const AGENT = {
  tenantId: 't1',
  userId: 'zoho:agent-1',
  userName: 'Ria Ahmadi',
  role: 'worker',
  departments: ['sales'],
  scopes: [],
} as unknown as TenantContext;

const OTHER_AGENT = { ...AGENT, userId: 'zoho:agent-9' } as TenantContext;

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'vc_1',
    tenantId: 't1',
    verificationProcess: false,
    statusCode: 'intake_incomplete',
    closedAt: null,
    submittedByZohoUserId: null,
    ownerZohoUserId: null,
    zohoOwnerId: 'agent-1',
    ...over,
  };
}

beforeEach(() => {
  findById.mockReset();
});

describe('editing the application data', () => {
  it('allows it before submit', async () => {
    findById.mockResolvedValue(row() as never);
    await expect(applicationService.assertSalesMayEdit(AGENT, 'vc_1')).resolves.toBeTruthy();
  });

  it('refuses it once submitted, and names who can correct it', async () => {
    findById.mockResolvedValue(
      row({ verificationProcess: true, statusCode: 'intake_submitted' }) as never,
    );
    await expect(applicationService.assertSalesMayEdit(AGENT, 'vc_1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'VERIFICATION_LOCKED',
      message: expect.stringMatching(/Verification desk to correct it/),
    });
  });

  /**
   * The regression this exists for. Pending Documents is the desk asking for a FILE; it used to
   * reopen the entire form, so an agent could change the requested limit on a case under review.
   */
  it('still refuses it in Pending Documents — the ask is a file, not a form pass', async () => {
    findById.mockResolvedValue(
      row({ verificationProcess: true, statusCode: 'pending_docs' }) as never,
    );
    await expect(applicationService.assertSalesMayEdit(AGENT, 'vc_1')).rejects.toMatchObject({
      code: 'VERIFICATION_LOCKED',
    });
  });
});

describe('attaching a document', () => {
  it('is allowed in Pending Documents, which is the point of it', async () => {
    findById.mockResolvedValue(
      row({ verificationProcess: true, statusCode: 'pending_docs' }) as never,
    );
    await expect(applicationService.assertSalesMayAttach(AGENT, 'vc_1')).resolves.toBeTruthy();
  });

  it('is allowed on a submitted case the desk has not asked about yet', async () => {
    findById.mockResolvedValue(row({ verificationProcess: true, statusCode: 'in_review' }) as never);
    await expect(applicationService.assertSalesMayAttach(AGENT, 'vc_1')).resolves.toBeTruthy();
  });

  it('stops at a decided case', async () => {
    findById.mockResolvedValue(
      row({ verificationProcess: true, statusCode: 'approved', closedAt: '2026-08-18T09:00:00Z' }) as never,
    );
    await expect(applicationService.assertSalesMayAttach(AGENT, 'vc_1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'VERIFICATION_CASE_CLOSED',
    });
  });
});

describe('ownership, on both gates', () => {
  /** A cron-created application reaches its agent via `zohoOwnerId` — the Deal's owner. */
  it('recognises the Deal owner', async () => {
    findById.mockResolvedValue(row({ zohoOwnerId: 'agent-1' }) as never);
    await expect(applicationService.assertSalesOwns(AGENT, 'vc_1')).resolves.toBeTruthy();
  });

  it('recognises the assignee and the submitter too', async () => {
    findById.mockResolvedValue(row({ zohoOwnerId: null, ownerZohoUserId: 'agent-1' }) as never);
    await expect(applicationService.assertSalesOwns(AGENT, 'vc_1')).resolves.toBeTruthy();
    findById.mockResolvedValue(row({ zohoOwnerId: null, submittedByZohoUserId: 'agent-1' }) as never);
    await expect(applicationService.assertSalesOwns(AGENT, 'vc_1')).resolves.toBeTruthy();
  });

  it('refuses another agent’s application on the edit gate', async () => {
    findById.mockResolvedValue(row() as never);
    await expect(applicationService.assertSalesMayEdit(OTHER_AGENT, 'vc_1')).rejects.toMatchObject({
      statusCode: 403,
      code: 'VERIFICATION_NOT_YOUR_APPLICATION',
    });
  });

  /** The attach gate is looser about STATE, never about whose case it is. */
  it('refuses another agent’s application on the attach gate', async () => {
    findById.mockResolvedValue(row({ verificationProcess: true, statusCode: 'pending_docs' }) as never);
    await expect(applicationService.assertSalesMayAttach(OTHER_AGENT, 'vc_1')).rejects.toMatchObject({
      statusCode: 403,
      code: 'VERIFICATION_NOT_YOUR_APPLICATION',
    });
  });

  it('reports a missing application as not found, not as a permission failure', async () => {
    findById.mockResolvedValue(undefined as never);
    await expect(applicationService.assertSalesOwns(AGENT, 'vc_1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
