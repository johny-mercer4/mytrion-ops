import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../src/types/tenantContext.js';

interface RecordedCall {
  method: string;
  args: unknown[];
}

let calls: RecordedCall[] = [];

function makeBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  for (const method of ['select', 'from', 'where', 'groupBy', 'orderBy', 'limit', 'offset']) {
    builder[method] = record(method);
  }
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve([]).then(resolve);
  return builder;
}

vi.mock('../../src/db/client.js', () => ({ db: makeBuilder() }));

import { bulkChangeLogRepo } from '../../src/repos/bulkChangeLogRepo.js';

const dialect = new PgDialect();
const ctx: TenantContext = {
  tenantId: 'tenant-acme',
  userId: 'admin-1',
  audience: 'internal',
  role: 'admin',
  scopes: ['*'],
  departments: [],
  allDepartmentAccess: true,
  requestId: 'test',
};

describe('bulkChangeLogRepo tenant isolation', () => {
  beforeEach(() => {
    calls = [];
  });

  it('opens every batch read WHERE clause with ctx.tenantId', async () => {
    await bulkChangeLogRepo.list(ctx);
    await bulkChangeLogRepo.count(ctx);
    await bulkChangeLogRepo.findBatch(ctx, 'batch-1');

    const wheres = calls.filter((call) => call.method === 'where');
    expect(wheres).toHaveLength(3);
    for (const call of wheres) {
      const rendered = dialect.sqlToQuery(call.args[0] as never);
      expect(rendered.sql).toMatch(/"bulk_change_log"\."tenant_id" = \$1/);
      expect(rendered.params[0]).toBe(ctx.tenantId);
    }
  });
});

