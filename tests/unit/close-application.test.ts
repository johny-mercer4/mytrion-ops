import { beforeEach, describe, expect, it, vi } from 'vitest';

const { guardMock, browserRequestMock } = vi.hoisted(() => ({
  guardMock: vi.fn(),
  browserRequestMock: vi.fn(),
}));

vi.mock('../../src/modules/sales/wexApplicationGuard.js', () => ({
  assertWexApplicationActionAllowed: guardMock,
}));
vi.mock('../../src/integrations/browserAutomation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/integrations/browserAutomation.js')>();
  return { ...actual, browserAutomationRequest: browserRequestMock };
});

import { closeWexApplication } from '../../src/modules/browserAutomation/closeApplication.js';

const input = {
  assignedTo: 'WEX Owner',
  priority: 'High' as const,
  dueDate: '2026-07-31',
  status: 'Not Started',
};

describe('guarded Close Application automation', () => {
  beforeEach(() => {
    guardMock.mockReset();
    guardMock.mockResolvedValue({ allowed: true });
    browserRequestMock.mockReset();
  });

  it('verifies current state before starting browser automation', async () => {
    browserRequestMock.mockResolvedValue({ success: true });

    await expect(closeWexApplication('app-123', input)).resolves.toEqual({ success: true });
    expect(guardMock).toHaveBeenCalledWith('app-123', 'Close Application');
    expect(browserRequestMock).toHaveBeenCalledWith(
      'POST',
      '/wex/application/app-123/close',
      { body: input },
    );
    expect(guardMock.mock.invocationCallOrder[0]).toBeLessThan(
      browserRequestMock.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('does not start the browser when the WEX state is blocked', async () => {
    guardMock.mockRejectedValue(new Error('This application is Closed/Lost.'));

    await expect(closeWexApplication('app-123', input)).rejects.toThrow('Closed/Lost');
    expect(browserRequestMock).not.toHaveBeenCalled();
  });
});
