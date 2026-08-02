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
  for (const method of ['select', 'from', 'where', 'limit', 'orderBy', 'insert', 'values', 'returning']) {
    builder[method] = record(method);
  }
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return builder;
}

vi.mock('../../src/db/client.js', () => ({ db: makeBuilder() }));

import { verificationSalesResponseRepo } from '../../src/repos/verificationSalesResponseRepo.js';

const ctx: TenantContext = {
  tenantId: 'tenant-acme',
  userId: 'sales-1',
  audience: 'internal',
  role: 'worker',
  scopes: [],
  departments: ['sales'],
  allDepartmentAccess: false,
  requestId: 'test',
};
const dialect = new PgDialect();

beforeEach(() => {
  calls = [];
  rows = [];
});

describe('verificationSalesResponseRepo tenant isolation', () => {
  it('scopes event lookup and request history by tenant', async () => {
    await verificationSalesResponseRepo.findByEvent(ctx, 'request-7', 'event-3');
    await verificationSalesResponseRepo.listForRequest(ctx, 'request-7');

    const wheres = calls.filter((call) => call.method === 'where');
    expect(wheres).toHaveLength(2);
    for (const call of wheres) {
      const query = dialect.sqlToQuery(call.args[0] as never);
      expect(query.sql).toContain('"verification_sales_responses"."tenant_id" = $1');
      expect(query.sql).toContain('"verification_sales_responses"."request_id" = $2');
      expect(query.params.slice(0, 2)).toEqual(['tenant-acme', 'request-7']);
    }
  });

  it('takes tenant identity from context when writing a response', async () => {
    rows = [{ id: 'vsr-1' }];
    await verificationSalesResponseRepo.create(ctx, {
      requestId: 'request-7',
      dealId: '7001',
      externalEventId: 'event-3',
      ownerZohoUserId: 'sales-1',
      responseValues: { dot_number: '1234567' },
      note: null,
      attachmentName: null,
      attachmentContentType: null,
      attachmentSizeBytes: null,
      zohoNoteId: 'note-1',
      syncWarning: null,
    });

    expect(calls.find((call) => call.method === 'values')?.args[0]).toMatchObject({
      tenantId: 'tenant-acme',
      requestId: 'request-7',
      externalEventId: 'event-3',
    });
  });
});
