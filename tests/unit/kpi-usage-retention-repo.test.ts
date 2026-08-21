import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../src/types/tenantContext.js';

const execute = vi.hoisted(() => vi.fn(async (_query: unknown): Promise<unknown[]> => []));

vi.mock('../../src/db/client.js', () => ({
  db: {
    transaction: async (run: (tx: { execute: typeof execute }) => Promise<unknown>) =>
      run({ execute }),
  },
}));

import { kpiUsageRetentionRepo } from '../../src/repos/kpiUsageRetentionRepo.js';

const ctx: TenantContext = {
  tenantId: 'tenant-acme',
  userId: 'scheduler',
  audience: 'internal',
  role: 'admin',
  scopes: ['*'],
  departments: ['sales'],
  allDepartmentAccess: false,
  requestId: 'retention-test',
};

describe('usage raw retention gate', () => {
  beforeEach(() => execute.mockClear());

  it('requires the matching source watermark to be complete before deleting', async () => {
    await kpiUsageRetentionRepo.deleteRolledUpRaw(
      ctx,
      new Date('2026-05-20T04:00:00.000Z'),
      'America/New_York',
      100,
    );

    const dialect = new PgDialect();
    const activity = dialect.sqlToQuery(execute.mock.calls[1]?.[0] as never);
    const presence = dialect.sqlToQuery(execute.mock.calls[2]?.[0] as never);
    expect(activity.sql).toContain(`"source_watermarks" ->> 'usage.activity' like 'complete@%'`);
    expect(presence.sql).toContain(`"source_watermarks" ->> 'usage.presence' like 'complete@%'`);
    expect(activity.params).toContain('tenant-acme');
    expect(activity.params).toContain('2026-05-20T04:00:00.000Z');
    expect(presence.params).toContain('tenant-acme');
  });
});
