import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../src/types/tenantContext.js';
import { registeredMiniAppCompanyRepo } from '../../src/repos/registeredMiniAppCompanyRepo.js';

const ctx: TenantContext = {
  tenantId: 'tenant-a',
  userId: 'gateway',
  audience: 'customer',
  role: 'fleet_manager',
  scopes: [],
  departments: [],
  allDepartmentAccess: false,
  requestId: 'req-1',
};

describe('registeredMiniAppCompanyRepo tenant predicates', () => {
  it('places tenant and Telegram identity in SQL before LIMIT 1', async () => {
    const limit = vi.fn(async () => []);
    const where = vi.fn((_predicate: SQL) => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const client = { select };

    // This deliberately minimal fluent client exercises only the repository query under test.
    await registeredMiniAppCompanyRepo.findByTelegramUserId(
      ctx,
      '9001',
      client as unknown as Parameters<
        typeof registeredMiniAppCompanyRepo.findByTelegramUserId
      >[2], // Test double: structurally incomplete by design; never reaches a real database.
    );

    const predicate = where.mock.calls[0]?.[0];
    if (!predicate) throw new Error('Repository did not supply a SQL predicate');
    const query = new PgDialect().sqlToQuery(predicate);
    expect(query.sql).toContain('"registered_mini_app_companies"."tenant_id"');
    expect(query.sql).toContain(
      '"registered_mini_app_companies"."telegram_user_id"',
    );
    expect(query.params).toEqual(['tenant-a', '9001']);
    expect(limit).toHaveBeenCalledWith(1);
  });
});
