/**
 * Sales Open Pool daily claim cap (2/UTC day).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

vi.mock('../../src/db/client.js', () => ({
  db: {
    select: vi.fn(),
  },
}));

import { db } from '../../src/db/client.js';
import {
  assertUnderOpenPoolDailyCap,
  countOpenPoolClaimsToday,
  OPEN_POOL_MAX_CLAIMS_PER_DAY,
} from '../../src/modules/retention/openPoolCaps.js';

const dbMock = vi.mocked(db, true);

function ctx(): TenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: 'zoho:s1',
    audience: 'internal',
    role: 'worker',
    scopes: ['*'],
    departments: ['sales'],
    allDepartmentAccess: false,
    requestId: 'test',
  };
}

describe('openPoolCaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts approved claims today', async () => {
    dbMock.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ n: 1 }]),
      }),
    } as never);
    await expect(countOpenPoolClaimsToday(ctx(), 'agent-1')).resolves.toBe(1);
  });

  it('throws at daily cap', async () => {
    dbMock.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ n: OPEN_POOL_MAX_CLAIMS_PER_DAY }]),
      }),
    } as never);
    await expect(assertUnderOpenPoolDailyCap(ctx(), 'agent-1')).rejects.toMatchObject({
      code: 'RETENTION_OPEN_POOL_DAILY_CAP',
      statusCode: 429,
    });
  });

  it('allows under cap', async () => {
    dbMock.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ n: 1 }]),
      }),
    } as never);
    await expect(assertUnderOpenPoolDailyCap(ctx(), 'agent-1')).resolves.toEqual({
      used: 1,
      remaining: 1,
    });
  });
});
