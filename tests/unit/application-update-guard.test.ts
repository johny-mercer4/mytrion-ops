import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../src/types/tenantContext.js';

const { guardMock, fetchApplicationUpdateMock } = vi.hoisted(() => ({
  guardMock: vi.fn(),
  fetchApplicationUpdateMock: vi.fn(),
}));

vi.mock('../../src/modules/sales/wexApplicationGuard.js', () => ({
  assertWexApplicationActionAllowed: guardMock,
}));
vi.mock('../../src/integrations/salesCrmActions.js', () => ({
  createLead: vi.fn(),
  deleteInboxMessage: vi.fn(),
  fetchAnnouncements: vi.fn(),
  fetchApplicationUpdate: fetchApplicationUpdateMock,
  fetchInbox: vi.fn(),
}));

import { salesDelugeTouchpoints } from '../../src/modules/touchpoints/catalog/salesDeluge.js';

const ctx: TenantContext = {
  tenantId: 'octane',
  userId: '6227679000000000001',
  audience: 'internal',
  role: 'worker',
  scopes: ['touchpoints:invoke'],
  departments: ['sales'],
  allDepartmentAccess: false,
  requestId: 'req-wex-tasks',
};

function applicationUpdateHandler() {
  const touchpoint = salesDelugeTouchpoints.find((entry) => entry.key === 'application.update');
  if (!touchpoint || touchpoint.kind !== 'local') {
    throw new Error('application.update local handler is missing');
  }
  return touchpoint.handler;
}

describe('Application Update — WEX Tasks guard', () => {
  beforeEach(() => {
    guardMock.mockReset();
    fetchApplicationUpdateMock.mockReset();
  });

  it('checks live WEX state before fetching Zoho task records', async () => {
    guardMock.mockResolvedValue({ allowed: true });
    fetchApplicationUpdateMock.mockResolvedValue({ wexTasks: [] });

    await expect(applicationUpdateHandler()(ctx, { appId: 'app-123' })).resolves
      .toEqual({ wexTasks: [] });
    expect(guardMock).toHaveBeenCalledWith(
      'app-123',
      'Application Update — WEX Tasks',
    );
    expect(guardMock.mock.invocationCallOrder[0]).toBeLessThan(
      fetchApplicationUpdateMock.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('does not call Zoho when the application is blocked', async () => {
    guardMock.mockRejectedValue(new Error('Cards have already been sent.'));

    await expect(applicationUpdateHandler()(ctx, { appId: 'app-123' })).rejects
      .toThrow('Cards have already been sent');
    expect(fetchApplicationUpdateMock).not.toHaveBeenCalled();
  });
});
