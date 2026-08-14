import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/verification/verificationCases.js', () => ({
  getVerificationCase: vi.fn(),
}));

vi.mock('../../src/integrations/creditPlatformClient.js', () => ({
  claimManualReview: vi.fn(async () => ({ ok: true })),
  releaseManualReview: vi.fn(async () => ({ ok: true })),
  parseBankStatements: vi.fn(async () => ({ ok: true })),
  runIsoftpullAll: vi.fn(async () => ({ ok: true })),
  runDecisionDeskStage: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../src/integrations/creditPlatformWriteDb.js', () => ({
  insertPlaidLinkAction: vi.fn(async () => ({ id: 99 })),
  isWriteConfigured: vi.fn(() => true),
}));

vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: vi.fn(async () => undefined),
}));

vi.mock('../../src/modules/verification/verificationCaseExtras.js', () => ({
  listRequestAttachments: vi.fn(async () => []),
}));

import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import {
  claimManualReview,
  releaseManualReview,
  runDecisionDeskStage,
} from '../../src/integrations/creditPlatformClient.js';
import { insertPlaidLinkAction } from '../../src/integrations/creditPlatformWriteDb.js';
import { getVerificationCase } from '../../src/modules/verification/verificationCases.js';
import {
  claimVerificationCase,
  generateVerificationPlaidLink,
  releaseVerificationCase,
  transferVerificationCaseUnavailable,
} from '../../src/modules/verification/verificationCaseQueue.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const getMock = vi.mocked(getVerificationCase);
const claimCp = vi.mocked(claimManualReview);
const releaseCp = vi.mocked(releaseManualReview);
const plaidInsert = vi.mocked(insertPlaidLinkAction);
const runStage = vi.mocked(runDecisionDeskStage);

const ctx: TenantContext = {
  tenantId: DEFAULT_TENANT_ID,
  userId: 'zoho:42',
  userName: 'Ada Lovelace',
  audience: 'internal',
  role: 'admin',
  scopes: [],
  departments: ['verification'],
  allDepartmentAccess: true,
  requestId: 'req_test',
};

const detail = {
  case: { id: 'vc_1', requestId: 'cp-req-1' },
  stages: [],
  catalog: [],
  attachments: [],
  readiness: null,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('verificationCaseQueue', () => {
  it('claims and releases over CP HTTP with the Horizon actor', async () => {
    getMock.mockResolvedValue(detail as never);
    await claimVerificationCase(ctx, 'vc_1');
    expect(claimCp).toHaveBeenCalledWith('cp-req-1', 'Ada Lovelace', undefined);
    expect(runStage).not.toHaveBeenCalled();

    await releaseVerificationCase(ctx, 'vc_1', 'done');
    expect(releaseCp).toHaveBeenCalledWith('cp-req-1', 'Ada Lovelace', 'done');
  });

  it('does not POST a CP transfer route', () => {
    expect(() => transferVerificationCaseUnavailable()).toThrow(/Decision Desk/);
    expect(claimCp).not.toHaveBeenCalled();
    expect(releaseCp).not.toHaveBeenCalled();
    expect(runStage).not.toHaveBeenCalled();
  });

  it('generates Plaid via inbox write-back, not HTTP stage run', async () => {
    getMock.mockResolvedValue(detail as never);
    const result = await generateVerificationPlaidLink(ctx, 'vc_1', true);
    expect(result).toEqual({ status: 'queued', inboxId: 99 });
    expect(plaidInsert).toHaveBeenCalledWith({
      requestId: 'cp-req-1',
      agent: 'mytrion:Ada Lovelace',
      regenerate: true,
    });
    expect(runStage).not.toHaveBeenCalled();
  });
});
