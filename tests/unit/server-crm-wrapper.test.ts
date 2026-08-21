import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/wrappers/serverCrmClient.js', () => ({
  crmGet: vi.fn(),
  crmPost: vi.fn(),
}));

import { crmGet } from '../../src/wrappers/serverCrmClient.js';
import { serverCrmWrapper } from '../../src/wrappers/serverCrmWrapper.js';

describe('serverCrmWrapper invoice reads', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requests the upstream maximum so all-time invoice lists are not page-truncated', async () => {
    vi.mocked(crmGet).mockResolvedValueOnce({ count: 0, data: [] });

    await serverCrmWrapper.getInvoices('5770757', { range: 'all_time' });

    expect(crmGet).toHaveBeenCalledWith('/api/salesMytrion/fetchInvoices', {
      carrierId: '5770757',
      range: 'all_time',
      limit: 5000,
    });
  });
});
