import { beforeEach, describe, expect, it, vi } from 'vitest';

const { scrubMock, auditMock } = vi.hoisted(() => ({
  scrubMock: vi.fn(),
  auditMock: vi.fn(async () => undefined),
}));
vi.mock('../../src/repos/auditRepo.js', () => ({
  auditRepo: { scrubTouchpointCardNumbers: scrubMock },
}));
vi.mock('../../src/modules/audit/auditLogger.js', () => ({ auditFromContext: auditMock }));

import { redactAuditParams } from '../../src/modules/audit/redactParams.js';
import { scrubStoredTouchpointPans } from '../../src/modules/audit/touchpointPanScrub.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const ctx = {
  tenantId: 'tenant-a', userId: 'system', audience: 'internal', role: 'admin', scopes: [],
  departments: [], allDepartmentAccess: true, requestId: 'test',
} as TenantContext;

beforeEach(() => vi.clearAllMocks());

describe('touchpoint audit PAN protection', () => {
  it('masks a PAN without mutating the dispatched params', () => {
    const params = { cardNumber: '7083051234', action: 'DEACTIVATE' };
    expect(redactAuditParams(params)).toEqual({ cardNumber: '•••• 1234', action: 'DEACTIVATE' });
    expect(params.cardNumber).toBe('7083051234');
  });

  it('runs bounded batches and audits only the scrub count', async () => {
    scrubMock.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    await expect(scrubStoredTouchpointPans(ctx, { batchSize: 2, maxRows: 10 })).resolves.toBe(3);
    expect(scrubMock).toHaveBeenNthCalledWith(1, ctx, 2);
    expect(scrubMock).toHaveBeenNthCalledWith(2, ctx, 2);
    expect(auditMock).toHaveBeenCalledWith(ctx, expect.objectContaining({
      action: 'admin.audit.touchpoint_pan_scrub',
      detail: { scrubbedRows: 3, boundedAt: 10 },
    }));
    expect(JSON.stringify(auditMock.mock.calls)).not.toContain('7083051234');
  });
});
