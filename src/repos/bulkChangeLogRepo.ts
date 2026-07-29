import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  auditLog,
  bulkChangeLog,
  type BulkChangeEntry,
  type BulkChangeSnapshot,
} from '../db/schema/index.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import {
  isDataLoaderTable,
  type DataLoaderTable,
} from '../modules/dataLoader/allowlist.js';
import {
  assertBatchNotReverted,
  planRevertAction,
} from '../modules/dataLoader/revertPlan.js';
import type { TenantContext } from '../types/tenantContext.js';
import { normalizePagination } from './util.js';

type TransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface TableMeta {
  columns: readonly string[];
  tenantColumn: boolean;
}

const TABLE_META: Record<DataLoaderTable, TableMeta> = {
  client_news: {
    tenantColumn: true,
    columns: [
      'id',
      'tenant_id',
      'title',
      'body',
      'audience_scope',
      'carrier_ids',
      'roles',
      'severity',
      'pinned',
      'publish_at',
      'expires_at',
      'created_by',
      'created_at',
      'updated_at',
    ],
  },
  client_news_reads: {
    tenantColumn: false,
    columns: ['id', 'news_id', 'telegram_user_id', 'read_at'],
  },
  scope_risk_items: {
    tenantColumn: true,
    columns: [
      'id',
      'tenant_id',
      'node_id',
      'category',
      'label',
      'icon',
      'position',
      'created_at',
      'updated_at',
    ],
  },
  mytrion_calls: {
    tenantColumn: true,
    columns: [
      'id',
      'tenant_id',
      'caller_zoho_user_id',
      'phone_number',
      'call_time',
      'duration_seconds',
      'call_status',
      'source_type',
      'source_id',
      'session_id',
      'direction',
      'result',
      'created_at',
    ],
  },
};

export interface BulkChangeBatchSummary {
  batchId: string;
  tableName: string;
  dbUser: string;
  insertCount: number;
  updateCount: number;
  deleteCount: number;
  rowCount: number;
  createdAt: Date;
  revertedAt: Date | null;
}

export interface BulkChangeBatchFilter {
  limit?: number;
  offset?: number;
}

export interface RevertBatchResult {
  batchId: string;
  rowCount: number;
  tables: string[];
}

function quoted(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function tableSql(tableName: DataLoaderTable): SQL {
  return sql.raw(`public.${quoted(tableName)}`);
}

function tenantScope(meta: TableMeta, alias: string, tenantId: string): SQL {
  const safeAlias = sql.raw(quoted(alias));
  if (meta.tenantColumn) {
    return sql`${safeAlias}."tenant_id" = ${tenantId}`;
  }
  return sql`EXISTS (
    SELECT 1
    FROM public.client_news AS tenant_news
    WHERE tenant_news."tenant_id" = ${tenantId}
      AND tenant_news."id" = ${safeAlias}."news_id"
  )`;
}

async function currentSnapshot(
  tx: TransactionClient,
  tenantId: string,
  tableName: DataLoaderTable,
  rowPk: string,
): Promise<BulkChangeSnapshot | undefined> {
  const meta = TABLE_META[tableName];
  const rows = await tx.execute(sql`
    SELECT to_jsonb(target_row) AS row
    FROM ${tableSql(tableName)} AS target_row
    WHERE ${tenantScope(meta, 'target_row', tenantId)}
      AND target_row."id" = ${rowPk}
    FOR UPDATE
  `);
  const row = rows[0]?.row;
  return row && typeof row === 'object' && !Array.isArray(row)
    ? (row as BulkChangeSnapshot)
    : undefined;
}

async function deleteCurrent(
  tx: TransactionClient,
  tenantId: string,
  tableName: DataLoaderTable,
  rowPk: string,
): Promise<void> {
  const meta = TABLE_META[tableName];
  await tx.execute(sql`
    DELETE FROM ${tableSql(tableName)} AS target_row
    WHERE ${tenantScope(meta, 'target_row', tenantId)}
      AND target_row."id" = ${rowPk}
  `);
}

async function insertSnapshot(
  tx: TransactionClient,
  tenantId: string,
  tableName: DataLoaderTable,
  snapshot: BulkChangeSnapshot,
): Promise<void> {
  const meta = TABLE_META[tableName];
  const json = JSON.stringify(snapshot);
  const rows = await tx.execute(sql`
    INSERT INTO ${tableSql(tableName)}
    SELECT restored.*
    FROM jsonb_populate_record(NULL::${tableSql(tableName)}, ${json}::jsonb) AS restored
    WHERE ${tenantScope(meta, 'restored', tenantId)}
    RETURNING "id"
  `);
  if (rows.length !== 1) {
    throw new ConflictError(
      `Cannot restore ${tableName}: the journal row does not belong to this tenant.`,
    );
  }
}

async function updateFromSnapshot(
  tx: TransactionClient,
  tenantId: string,
  tableName: DataLoaderTable,
  rowPk: string,
  snapshot: BulkChangeSnapshot,
): Promise<void> {
  const meta = TABLE_META[tableName];
  const columns = sql.raw(meta.columns.map(quoted).join(', '));
  const restoredColumns = sql.raw(
    meta.columns.map((column) => `restored.${quoted(column)}`).join(', '),
  );
  const json = JSON.stringify(snapshot);
  const rows = await tx.execute(sql`
    UPDATE ${tableSql(tableName)} AS target_row
    SET (${columns}) = (
      SELECT ${restoredColumns}
      FROM jsonb_populate_record(NULL::${tableSql(tableName)}, ${json}::jsonb) AS restored
    )
    WHERE ${tenantScope(meta, 'target_row', tenantId)}
      AND target_row."id" = ${rowPk}
      AND EXISTS (
        SELECT 1
        FROM jsonb_populate_record(
          NULL::${tableSql(tableName)},
          ${json}::jsonb
        ) AS restored_scope
        WHERE ${tenantScope(meta, 'restored_scope', tenantId)}
      )
    RETURNING target_row."id"
  `);
  if (rows.length !== 1) {
    throw new ConflictError(`Cannot restore ${tableName}/${rowPk}: target row disappeared.`);
  }
}

async function invertRow(
  tx: TransactionClient,
  ctx: TenantContext,
  row: BulkChangeEntry,
): Promise<void> {
  if (!isDataLoaderTable(row.tableName)) {
    throw new ConflictError(`Cannot revert unapproved table ${row.tableName}.`);
  }
  const current = await currentSnapshot(tx, ctx.tenantId, row.tableName, row.rowPk);
  const action = planRevertAction(row, current);
  if (action.kind === 'delete') {
    await deleteCurrent(tx, ctx.tenantId, action.tableName, action.rowPk);
    return;
  }
  if (action.kind === 'insert') {
    await insertSnapshot(tx, ctx.tenantId, action.tableName, action.snapshot);
    return;
  }
  await updateFromSnapshot(tx, ctx.tenantId, action.tableName, action.rowPk, action.snapshot);
}

export const bulkChangeLogRepo = {
  async list(
    ctx: TenantContext,
    filter: BulkChangeBatchFilter = {},
  ): Promise<BulkChangeBatchSummary[]> {
    const { limit, offset } = normalizePagination(filter);
    return db
      .select({
        batchId: bulkChangeLog.batchId,
        tableName: sql<string>`string_agg(distinct ${bulkChangeLog.tableName}, ', ' order by ${bulkChangeLog.tableName})`,
        dbUser: sql<string>`string_agg(distinct ${bulkChangeLog.dbUser}, ', ' order by ${bulkChangeLog.dbUser})`,
        insertCount:
          sql<number>`count(*) filter (where ${bulkChangeLog.op} = 'insert')::int`,
        updateCount:
          sql<number>`count(*) filter (where ${bulkChangeLog.op} = 'update')::int`,
        deleteCount:
          sql<number>`count(*) filter (where ${bulkChangeLog.op} = 'delete')::int`,
        rowCount: sql<number>`count(*)::int`,
        createdAt: sql<Date>`max(${bulkChangeLog.createdAt})`,
        revertedAt: sql<Date | null>`max(${bulkChangeLog.revertedAt})`,
      })
      .from(bulkChangeLog)
      .where(eq(bulkChangeLog.tenantId, ctx.tenantId))
      .groupBy(bulkChangeLog.batchId)
      .orderBy(desc(sql`max(${bulkChangeLog.createdAt})`))
      .limit(limit)
      .offset(offset);
  },

  async count(ctx: TenantContext): Promise<number> {
    const rows = await db
      .select({
        count: sql<number>`count(distinct ${bulkChangeLog.batchId})::int`,
      })
      .from(bulkChangeLog)
      .where(eq(bulkChangeLog.tenantId, ctx.tenantId));
    return rows[0]?.count ?? 0;
  },

  async findBatch(ctx: TenantContext, batchId: string): Promise<BulkChangeEntry[]> {
    return db
      .select()
      .from(bulkChangeLog)
      .where(
        and(
          eq(bulkChangeLog.tenantId, ctx.tenantId),
          eq(bulkChangeLog.batchId, batchId),
        ),
      )
      .orderBy(desc(bulkChangeLog.createdAt), desc(bulkChangeLog.id));
  },

  async revert(ctx: TenantContext, batchId: string): Promise<RevertBatchResult> {
    return db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(bulkChangeLog)
        .where(
          and(
            eq(bulkChangeLog.tenantId, ctx.tenantId),
            eq(bulkChangeLog.batchId, batchId),
          ),
        )
        .orderBy(desc(bulkChangeLog.createdAt), desc(bulkChangeLog.id))
        .for('update');
      if (rows.length === 0) throw new NotFoundError('Data Loader batch not found.');
      assertBatchNotReverted(rows);

      await tx.execute(
        sql`SELECT set_config('mytrion.batch_id', ${`revert:${batchId}`}, true)`,
      );
      for (const row of rows) await invertRow(tx, ctx, row);

      const now = new Date();
      await tx
        .update(bulkChangeLog)
        .set({ revertedAt: now, revertedBy: ctx.userId })
        .where(
          and(
            eq(bulkChangeLog.tenantId, ctx.tenantId),
            eq(bulkChangeLog.batchId, batchId),
          ),
        );

      const tables = [...new Set(rows.map((row) => row.tableName))].sort();
      await tx.insert(auditLog).values({
        tenantId: ctx.tenantId,
        audience: ctx.audience,
        userId: ctx.userId,
        userName: ctx.userName ?? null,
        profile: ctx.profiles?.join(', ') ?? null,
        callerRole: ctx.callerRole ?? null,
        role: ctx.role,
        impersonatorUserId: ctx.impersonatorUserId ?? null,
        action: 'data_loader.revert',
        resourceType: 'bulk_change_log',
        resourceId: batchId,
        status: 'ok',
        requestId: ctx.requestId,
        detail: { rowCount: rows.length, tables },
      });

      return { batchId, rowCount: rows.length, tables };
    });
  },
};
