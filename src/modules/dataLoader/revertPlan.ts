import { isDeepStrictEqual } from 'node:util';
import type {
  BulkChangeEntry,
  BulkChangeSnapshot,
} from '../../db/schema/bulk_change_log.js';
import { ConflictError } from '../../lib/errors.js';
import { isDataLoaderTable, type DataLoaderTable } from './allowlist.js';

export type RevertAction =
  | { kind: 'delete'; tableName: DataLoaderTable; rowPk: string }
  | {
      kind: 'insert' | 'update';
      tableName: DataLoaderTable;
      rowPk: string;
      snapshot: BulkChangeSnapshot;
    };

function requiredSnapshot(
  value: BulkChangeSnapshot | null,
  label: 'before' | 'after',
  row: BulkChangeEntry,
): BulkChangeSnapshot {
  if (value === null) {
    throw new ConflictError(
      `Cannot revert ${row.tableName}/${row.rowPk}: journal ${label}-image is missing.`,
    );
  }
  return value;
}

export function assertBatchNotReverted(rows: readonly BulkChangeEntry[]): void {
  if (rows.some((row) => row.revertedAt !== null)) {
    throw new ConflictError('This Data Loader batch was already reverted.');
  }
}

export function planRevertAction(
  row: BulkChangeEntry,
  current: BulkChangeSnapshot | undefined,
): RevertAction {
  if (!isDataLoaderTable(row.tableName)) {
    throw new ConflictError(`Cannot revert unapproved table ${row.tableName}.`);
  }

  if (row.op === 'delete') {
    if (current !== undefined) {
      throw new ConflictError(
        `Cannot revert ${row.tableName}/${row.rowPk}: a row now exists at the deleted key.`,
      );
    }
    return {
      kind: 'insert',
      tableName: row.tableName,
      rowPk: row.rowPk,
      snapshot: requiredSnapshot(row.before, 'before', row),
    };
  }

  const after = requiredSnapshot(row.after, 'after', row);
  if (current === undefined || !isDeepStrictEqual(current, after)) {
    throw new ConflictError(
      `Cannot revert ${row.tableName}/${row.rowPk}: the row changed after this batch.`,
    );
  }

  if (row.op === 'insert') {
    return { kind: 'delete', tableName: row.tableName, rowPk: row.rowPk };
  }
  return {
    kind: 'update',
    tableName: row.tableName,
    rowPk: row.rowPk,
    snapshot: requiredSnapshot(row.before, 'before', row),
  };
}

