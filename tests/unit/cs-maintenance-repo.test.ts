/**
 * maintenanceCaseRepo — the SQL drizzle actually builds.
 *
 * Two of these assertions guard silent failures rather than crashes:
 *   - the unit-number predicate must stay character-identical to the expression index in
 *     0079_maintenance_cases.sql, or the index quietly stops being used and search degrades to a
 *     seq scan as the table grows;
 *   - every ORDER BY must end in `id`, or offset paging skips and duplicates rows whenever cases
 *     share a date — the failure that cost the referral drain 680 of 687 records.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface RecordedCall {
  method: string;
  args: unknown[];
}

let calls: RecordedCall[] = [];
let resultRows: unknown[] = [];

/** Chainable stand-in for the drizzle builder: records every call, thenable so `await` resolves. */
function makeBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  for (const method of [
    'select',
    'selectDistinct',
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    'groupBy',
    'insert',
    'values',
    'onConflictDoUpdate',
    'returning',
    'update',
    'set',
  ]) {
    builder[method] = record(method);
  }
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resultRows).then(resolve);
  return builder;
}

vi.mock('../../src/db/client.js', () => ({ db: makeBuilder() }));

import { maintenanceCaseRepo } from '../../src/repos/maintenanceCaseRepo.js';

const dialect = new PgDialect();

const rendered = (method: string): Array<{ sql: string; params: unknown[] }> =>
  calls
    .filter((c) => c.method === method)
    .map((c) => {
      const query = dialect.sqlToQuery(c.args[0] as never);
      return { sql: query.sql, params: query.params as unknown[] };
    });

beforeEach(() => {
  calls = [];
  resultRows = [];
});

describe('search predicate', () => {
  it('normalizes the unit number with the EXACT expression the index is built on', () => {
    // 0079_maintenance_cases.sql:
    //   CREATE INDEX maintenance_cases_unit_norm_idx
    //     ON maintenance_cases (lower(regexp_replace("unit_number", '[^a-zA-Z0-9]', '', 'g')));
    // Any drift here (a different character class, a missing 'g') makes the index unusable.
    void maintenanceCaseRepo.listPage({ search: 'T-1042' });
    const sql = rendered('where').map((w) => w.sql).join(' ');
    expect(sql).toContain(`lower(regexp_replace("maintenance_cases"."unit_number", '[^a-zA-Z0-9]', '', 'g'))`);
  });

  it('searches both company columns — the module Name and the linked Account label', () => {
    // 2,714 records: 2,714 have `name`, only 2,500 have the Account lookup. Searching one misses rows.
    void maintenanceCaseRepo.listPage({ search: 'acme' });
    const sql = rendered('where').map((w) => w.sql).join(' ');
    expect(sql).toContain('"company_name"');
    expect(sql).toContain('"name"');
  });

  it('treats a digits-only query as an identifier: exact + prefix carrier match', () => {
    void maintenanceCaseRepo.listPage({ search: '578' });
    const where = rendered('where')[0];
    expect(where?.sql).toContain('"carrier_id"');
    expect(where?.sql).toContain('like');
    expect(where?.params).toContain('578');
    expect(where?.params).toContain('578%');
  });

  it('does NOT attempt a carrier match for a non-numeric query', () => {
    void maintenanceCaseRepo.listPage({ search: 'acme' });
    const where = rendered('where')[0];
    expect(where?.params).not.toContain('acme%');
  });

  it('leaves the WHERE clause off entirely when nothing is filtered', () => {
    void maintenanceCaseRepo.listPage({});
    for (const w of calls.filter((c) => c.method === 'where')) {
      expect(w.args[0]).toBeUndefined();
    }
  });
});

describe('picklist filters are exact, never substring', () => {
  it('uses IN for status and case type', () => {
    // A substring match would fold "PMs" into "PMs / Mechanical" and "PMs and CARB", so the tab
    // count and the rows beneath it would disagree.
    void maintenanceCaseRepo.listPage({ status: ['In Process'], caseType: ['PMs'] });
    const sql = rendered('where')[0]?.sql ?? '';
    expect(sql).toContain('in (');
    expect(sql).not.toContain('like');
  });
});

describe('ordering', () => {
  const sorts = ['date', 'created', 'amount', 'company', 'carrier'] as const;

  for (const sort of sorts) {
    for (const dir of ['asc', 'desc'] as const) {
      it(`sort=${sort} dir=${dir} ends in id so the order is total`, () => {
        void maintenanceCaseRepo.listPage({ sort, dir });
        const order = rendered('orderBy')[0]?.sql ?? '';
        expect(order).toMatch(/"maintenance_cases"\."id" (asc|desc)$/i);
      });
    }
  }
});

describe('pagination bounds', () => {
  it('caps perPage at 100 — cards are far more expensive per row than table rows', () => {
    void maintenanceCaseRepo.listPage({ perPage: 5000 });
    expect(calls.find((c) => c.method === 'limit')?.args[0]).toBe(100);
  });

  it('floors page at 1 so a negative page cannot produce a negative offset', () => {
    void maintenanceCaseRepo.listPage({ page: -3, perPage: 24 });
    expect(calls.find((c) => c.method === 'offset')?.args[0]).toBe(0);
  });

  it('defaults to 24 per page', () => {
    void maintenanceCaseRepo.listPage({});
    expect(calls.find((c) => c.method === 'limit')?.args[0]).toBe(24);
  });
});

describe('upsertMany', () => {
  const row = (zohoRecordId: string) => ({ zohoRecordId, name: 'ACME' });

  it('conflicts on zoho_record_id, restricted to non-null (Mytrion rows have none)', () => {
    void maintenanceCaseRepo.upsertMany([row('1')]);
    const conflict = calls.find((c) => c.method === 'onConflictDoUpdate')?.args[0] as {
      target?: unknown;
      targetWhere?: unknown;
      set?: Record<string, unknown>;
    };
    expect(conflict.target).toBeDefined();
    expect(dialect.sqlToQuery(conflict.targetWhere as never).sql).toMatch(/is not null/i);
  });

  it('never clobbers the columns an agent owns', () => {
    // A re-import refreshes Zoho facts. If it also reset created_by/updated_by, every re-run would
    // erase the record of who touched a case in Mytrion.
    void maintenanceCaseRepo.upsertMany([row('1')]);
    const set = (calls.find((c) => c.method === 'onConflictDoUpdate')?.args[0] as {
      set: Record<string, unknown>;
    }).set;
    for (const forbidden of ['createdByUserId', 'createdByName', 'updatedByUserId', 'updatedByName', 'id']) {
      expect(set).not.toHaveProperty(forbidden);
    }
    // …but it must refresh the source facts and the sync stamp.
    for (const required of ['status', 'totalAmount', 'ownerName', 'raw', 'syncedAt']) {
      expect(set).toHaveProperty(required);
    }
  });

  it('skips a row an agent has edited in Mytrion instead of overwriting it from Zoho', () => {
    // Keeping created_by/updated_by out of `set` is NOT sufficient. Without this predicate the audit
    // columns survive while every business column is replaced by Zoho's frozen value — so the row
    // reads as though the agent themselves reverted their own correction. Zoho is never synced, so
    // its copy is the stale one by definition.
    void maintenanceCaseRepo.upsertMany([row('1')]);
    const conflict = calls.find((c) => c.method === 'onConflictDoUpdate')?.args[0] as {
      setWhere?: unknown;
    };
    expect(conflict.setWhere).toBeDefined();
    const { sql } = dialect.sqlToQuery(conflict.setWhere as never);
    expect(sql).toMatch(/updated_by_user_id"?\s+is null/i);
    // Unqualified — `excluded.updated_by_user_id` is the INCOMING row and is always null here, which
    // would make the predicate vacuously true and the guard useless.
    expect(sql).not.toMatch(/excluded/i);
  });

  it('chunks the write instead of issuing one statement per row', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => row(String(i)));
    const res = await maintenanceCaseRepo.upsertMany(rows, { chunkSize: 200 });
    expect(calls.filter((c) => c.method === 'insert')).toHaveLength(2);
    expect(res.chunks).toBe(2);
  });

  it('clamps chunkSize into 1..500', async () => {
    const rows = Array.from({ length: 600 }, (_, i) => row(String(i)));
    await maintenanceCaseRepo.upsertMany(rows, { chunkSize: 100_000 });
    expect(calls.filter((c) => c.method === 'insert')).toHaveLength(2); // 500 + 100
  });

  it('is a no-op on an empty batch', async () => {
    const res = await maintenanceCaseRepo.upsertMany([]);
    expect(res).toEqual({ written: 0, skipped: 0, chunks: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe('facets', () => {
  it('computes the status counts WITHOUT the status filter applied', async () => {
    // Otherwise selecting a tab collapses every other tab's count to zero and the chrome becomes
    // useless for navigating.
    await maintenanceCaseRepo.facets({ status: ['Completed'], caseType: ['PMs'] });
    const groupBys = calls.filter((c) => c.method === 'groupBy');
    expect(groupBys.length).toBe(3);

    const wheres = rendered('where');
    // The grand-total query keeps every filter; the status facet must have dropped its own.
    const statusFacetWhere = wheres[0]?.sql ?? '';
    expect(statusFacetWhere).not.toContain('"status"');
    expect(statusFacetWhere).toContain('"case_type"');
  });
});

describe('update', () => {
  it('always stamps updated_at, so a patch cannot leave the row looking untouched', () => {
    void maintenanceCaseRepo.update('mtc_abc', { status: 'Completed' });
    const set = calls.find((c) => c.method === 'set')?.args[0] as Record<string, unknown>;
    expect(set.updatedAt).toBeInstanceOf(Date);
  });
});
