import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../src/types/tenantContext.js';

interface RecordedCall {
  method: string;
  args: unknown[];
}

let calls: RecordedCall[] = [];
let rows: unknown[] = [];

function makeBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return builder;
  };
  for (const method of [
    'select', 'from', 'where', 'limit', 'orderBy', 'insert', 'values',
    'onConflictDoUpdate', 'returning', 'delete',
  ]) {
    builder[method] = record(method);
  }
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return builder;
}

vi.mock('../../src/db/client.js', () => ({ db: makeBuilder() }));

import { loyaltyClientOverrideRepo } from '../../src/repos/loyaltyClientOverrideRepo.js';

const ctx: TenantContext = {
  tenantId: 'tenant-acme', userId: 'manager-1', audience: 'internal', role: 'admin',
  scopes: ['*'], departments: ['management'], allDepartmentAccess: true, requestId: 'test',
};
const dialect = new PgDialect();

beforeEach(() => {
  calls = [];
  rows = [];
});

describe('loyaltyClientOverrideRepo tenant isolation', () => {
  it('scopes get and remove by both tenant and carrier', async () => {
    await loyaltyClientOverrideRepo.get(ctx, 'carrier-7');
    await loyaltyClientOverrideRepo.remove(ctx, 'carrier-7');

    const wheres = calls.filter((call) => call.method === 'where');
    expect(wheres).toHaveLength(2);
    for (const call of wheres) {
      const query = dialect.sqlToQuery(call.args[0] as never);
      expect(query.sql).toContain('"loyalty_client_overrides"."tenant_id" = $1');
      expect(query.sql).toContain('"loyalty_client_overrides"."carrier_id" = $2');
      expect(query.params).toEqual(['tenant-acme', 'carrier-7']);
    }
  });

  it('writes the tenant from context and uses the tenant/carrier conflict key', async () => {
    rows = [{ id: 'lco-1' }];
    await loyaltyClientOverrideRepo.upsert(ctx, {
      carrierId: 'carrier-7', companyName: 'Acme', enterpriseMode: null,
      enterpriseGoldTargetGallons: null, enabledRewardIds: [], note: null,
      updatedBy: 'Manager',
    });

    expect(calls.find((call) => call.method === 'values')?.args[0]).toMatchObject({
      tenantId: 'tenant-acme', carrierId: 'carrier-7', enabledRewardIds: [],
    });
    const conflict = calls.find((call) => call.method === 'onConflictDoUpdate')?.args[0] as {
      target?: unknown[];
    };
    expect(conflict.target).toHaveLength(2);
  });
});
