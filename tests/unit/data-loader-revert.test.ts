import { describe, expect, it } from 'vitest';
import type { BulkChangeEntry } from '../../src/db/schema/bulk_change_log.js';
import {
  assertBatchNotReverted,
  planRevertAction,
} from '../../src/modules/dataLoader/revertPlan.js';

function entry(overrides: Partial<BulkChangeEntry>): BulkChangeEntry {
  return {
    id: 'bcl_1',
    tenantId: 'octane',
    audience: null,
    batchId: 'batch_1',
    tableName: 'scope_risk_items',
    rowPk: 'ri_1',
    op: 'update',
    before: { id: 'ri_1', tenant_id: 'octane', label: 'Before' },
    after: { id: 'ri_1', tenant_id: 'octane', label: 'After' },
    dbUser: 'mytrion_loader',
    revertedAt: null,
    revertedBy: null,
    createdAt: new Date('2026-07-29T00:00:00Z'),
    ...overrides,
  };
}

describe('Data Loader revert planning', () => {
  it('inverts an insert with a delete', () => {
    const row = entry({
      op: 'insert',
      before: null,
      after: { id: 'ri_1', tenant_id: 'octane', label: 'Created' },
    });
    expect(planRevertAction(row, row.after ?? undefined)).toEqual({
      kind: 'delete',
      tableName: 'scope_risk_items',
      rowPk: 'ri_1',
    });
  });

  it('inverts a delete by re-inserting the before-image', () => {
    const row = entry({ op: 'delete', after: null });
    expect(planRevertAction(row, undefined)).toEqual({
      kind: 'insert',
      tableName: 'scope_risk_items',
      rowPk: 'ri_1',
      snapshot: row.before,
    });
  });

  it('inverts an update by restoring the before-image', () => {
    const row = entry({});
    expect(planRevertAction(row, row.after ?? undefined)).toEqual({
      kind: 'update',
      tableName: 'scope_risk_items',
      rowPk: 'ri_1',
      snapshot: row.before,
    });
  });

  it('refuses a batch that was already reverted', () => {
    expect(() =>
      assertBatchNotReverted([entry({ revertedAt: new Date(), revertedBy: 'admin_1' })]),
    ).toThrow(/already reverted/i);
  });

  it('refuses to overwrite a row that drifted after the batch', () => {
    const row = entry({});
    expect(() =>
      planRevertAction(row, { id: 'ri_1', tenant_id: 'octane', label: 'Later edit' }),
    ).toThrow(/changed after this batch/i);
  });
});

