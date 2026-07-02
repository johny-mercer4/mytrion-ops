import { and, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { fileAssets, type FileAsset, type NewFileAsset } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

/**
 * Read RBAC for files — mirrors the knowledge retriever's filter, plus ownership:
 * allDepartmentAccess/bypass → unrestricted (within tenant); otherwise the file must be
 * department-NULL (tenant-global), in one of the caller's departments, or owned by them.
 * Exported for offline SQL assertions in the RBAC suite.
 */
export function fileVisibilityFilter(ctx: TenantContext): SQL | undefined {
  if (ctx.allDepartmentAccess || ctx.bypassRbac) return undefined;
  const dept = fileAssets.departmentAccess;
  const deptOk =
    ctx.departments.length === 0 ? isNull(dept) : or(isNull(dept), inArray(dept, ctx.departments));
  return or(deptOk, eq(fileAssets.ownerUserId, ctx.userId));
}

export const fileRepo = {
  async create(ctx: TenantContext, input: Omit<NewFileAsset, 'tenantId'>): Promise<FileAsset> {
    const [row] = await db
      .insert(fileAssets)
      .values({ ...input, tenantId: ctx.tenantId })
      .returning();
    if (!row) throw new Error('insert into file_assets returned no row');
    return row;
  },

  /** Visible-to-caller lookup (tenant + visibility filter + not deleted). */
  buildFindQuery(ctx: TenantContext, id: string) {
    return db
      .select()
      .from(fileAssets)
      .where(
        and(
          eq(fileAssets.tenantId, ctx.tenantId),
          eq(fileAssets.id, id),
          eq(fileAssets.status, 'ready'),
          fileVisibilityFilter(ctx),
        ),
      )
      .limit(1);
  },

  async findVisible(ctx: TenantContext, id: string): Promise<FileAsset | undefined> {
    const rows = await this.buildFindQuery(ctx, id);
    return rows[0];
  },

  async listVisible(ctx: TenantContext, limit = 50): Promise<FileAsset[]> {
    return db
      .select()
      .from(fileAssets)
      .where(
        and(
          eq(fileAssets.tenantId, ctx.tenantId),
          eq(fileAssets.status, 'ready'),
          fileVisibilityFilter(ctx),
        ),
      )
      .orderBy(desc(fileAssets.createdAt))
      .limit(limit);
  },

  /** Soft delete (owner or admin); the storage object is removed by the caller. */
  async markDeleted(ctx: TenantContext, id: string): Promise<FileAsset | undefined> {
    const conditions = [
      eq(fileAssets.tenantId, ctx.tenantId),
      eq(fileAssets.id, id),
      eq(fileAssets.status, 'ready'),
    ];
    if (!ctx.allDepartmentAccess && !ctx.bypassRbac) {
      conditions.push(eq(fileAssets.ownerUserId, ctx.userId));
    }
    const rows = await db
      .update(fileAssets)
      .set({ status: 'deleted' })
      .where(and(...conditions))
      .returning();
    return rows[0];
  },
};
