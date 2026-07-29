import { beforeEach, describe, expect, it, vi } from 'vitest';

const { browserRequest, createInbox, audit, guard } = vi.hoisted(() => ({
  browserRequest: vi.fn(),
  createInbox: vi.fn(async () => ({ message: {}, delivered: 0 })),
  audit: vi.fn(async () => undefined),
  guard: vi.fn(),
}));

vi.mock('../../src/integrations/browserAutomation.js', () => ({
  browserAutomationRequest: browserRequest,
}));
vi.mock('../../src/modules/inbox/service.js', () => ({
  createInboxMessage: createInbox,
}));
vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: audit,
}));
vi.mock('../../src/modules/sales/wexApplicationGuard.js', () => ({
  assertWexApplicationActionAllowed: guard,
}));

import {
  runBocaRequest,
  submitBocaRequest,
} from '../../src/modules/browserAutomation/bocaRequest.js';
import { payloadToContext, salesBocaRequestJob } from '../../src/modules/jobs/catalog.js';

const payload = salesBocaRequestJob.schema.parse({
  ctx: {
    tenantId: 'octane',
    userId: '6227679000000000001',
    audience: 'internal',
    role: 'worker',
    scopes: ['touchpoints:invoke'],
    departments: ['sales'],
    allDepartmentAccess: false,
    userName: 'Sales Agent',
    email: 'agent@example.com',
    requestId: 'req-boca-1',
  },
  requestKey: 'boca-req-boca-1-app-123',
  appId: 'app-123',
  assignedTo: 'WEX Owner',
  priority: 'High',
  dueDate: '2026-07-30',
  status: 'Not Started',
});

describe('queued BOCA completion', () => {
  beforeEach(() => {
    browserRequest.mockReset();
    guard.mockReset();
    guard.mockResolvedValue({ allowed: true });
    createInbox.mockClear();
    audit.mockClear();
  });

  it('runs the long WEX action and notifies the requesting agent on success', async () => {
    browserRequest.mockResolvedValue({ success: true, status: 'Submitted' });

    await expect(runBocaRequest(payload)).resolves.toMatchObject({ success: true });

    expect(browserRequest).toHaveBeenCalledWith('POST', '/wex/boca/app-123', {
      body: {
        assignedTo: 'WEX Owner',
        priority: 'High',
        dueDate: '2026-07-30',
        status: 'Not Started',
      },
    });
    expect(createInbox).toHaveBeenCalledWith(
      expect.objectContaining({ userId: payload.ctx.userId }),
      expect.objectContaining({
        ownerZohoUserId: payload.ctx.userId,
        subject: 'BOCA request completed',
        tag: 'C-27',
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: payload.ctx.userId }),
      expect.objectContaining({ action: 'sales.boca_request.completed', status: 'ok' }),
    );
  });

  it('records a failure inbox event instead of leaving the UI waiting forever', async () => {
    browserRequest.mockRejectedValue(new Error('browser service timeout'));

    await expect(runBocaRequest(payload)).resolves.toMatchObject({
      success: false,
      error: 'browser service timeout',
    });
    expect(createInbox).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        subject: 'BOCA request failed',
        priority: 'high',
        content: expect.stringContaining('browser service timeout'),
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('re-checks WEX state in the worker and never starts a newly blocked request', async () => {
    guard.mockRejectedValue(new Error('Cards have already been sent.'));

    await expect(runBocaRequest(payload)).resolves.toMatchObject({
      success: false,
      error: 'Cards have already been sent.',
    });
    expect(browserRequest).not.toHaveBeenCalled();
    expect(createInbox).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        subject: 'BOCA request failed',
        content: expect.stringContaining('Cards have already been sent'),
      }),
    );
  });

  it('rejects a blocked application before accepting a queue request', async () => {
    guard.mockRejectedValue(new Error('This application is Closed/Lost.'));

    await expect(submitBocaRequest(payloadToContext(payload.ctx), {
      appId: payload.appId,
      assignedTo: payload.assignedTo,
      priority: payload.priority,
      dueDate: payload.dueDate,
      status: payload.status,
    })).rejects.toThrow('Closed/Lost');
    expect(browserRequest).not.toHaveBeenCalled();
  });
});
