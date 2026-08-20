import { describe, expect, it, vi } from 'vitest';

vi.mock('./transport', async () => {
  const actual = await vi.importActual<typeof import('./transport')>('./transport');
  return { ...actual, request: vi.fn() };
});

import { fetchSalesMytrionUsage } from './analytics';
import { request } from './transport';

describe('Sales Mytrion usage API', () => {
  it('sends date filters without View-as impersonation headers', async () => {
    vi.mocked(request).mockResolvedValueOnce({});
    await fetchSalesMytrionUsage({
      fresh: true,
      range: 'custom',
      from: '2026-08-01',
      to: '2026-08-17',
    });
    expect(request).toHaveBeenCalledWith('GET', '/analytics/mytrion/sales', {
      query: { fresh: '1', range: 'custom', from: '2026-08-01', to: '2026-08-17' },
      impersonate: false,
    });
  });
});
