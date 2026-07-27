import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { hrDepartments, type HrDepartment, type NewHrDepartment } from '../db/schema/index.js';
import { resolveParentDepartmentId } from '../modules/hr/resolveDepartmentLink.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined, isUniqueViolation } from './util.js';

export interface HrDepartmentListOpts {
  q?: string;
  limit?: number;
  offset?: number;
}

export interface UpsertDepartmentFromZohoInput {
  zohoRecordId: string;
  name: string;
  code?: string | null;
  mailAlias?: string | null;
  leadName?: string | null;
  leadZohoId?: string | null;
  leadEmail?: string | null;
  parentName?: string | null;
  parentZohoId?: string | null;
  rawFields?: Record<string, unknown> | null;
}

export interface ManualDepartmentInput {
  name: string;
  code?: string | null;
  mailAlias?: string | null;
  leadName?: string | null;
  parentName?: string | null;
}

/**
 * hr_departments — tenant-scoped org units. Zoho sync upserts by (tenant, zoho_record_id);
 * manual rows have null zoho_record_id.
 */
export const hrDepartmentRepo = {
  async getById(ctx: TenantContext, id: string): Promise<HrDepartment | undefined> {
    const rows = await db
      .select()
      .from(hrDepartments)
      .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.id, id)))
      .limit(1);
    return firstOrUndefined(rows);
  },

  async findByZohoRecordId(
    ctx: TenantContext,
    zohoRecordId: string,
  ): Promise<HrDepartment | undefined> {
    const rows = await db
      .select()
      .from(hrDepartments)
      .where(
        and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.zohoRecordId, zohoRecordId)),
      )
      .limit(1);
    return firstOrUndefined(rows);
  },

  async list(ctx: TenantContext, opts: HrDepartmentListOpts = {}): Promise<HrDepartment[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const clauses = [eq(hrDepartments.tenantId, ctx.tenantId)];
    if (opts.q?.trim()) {
      const q = `%${opts.q.trim()}%`;
      clauses.push(
        or(
          ilike(hrDepartments.name, q),
          ilike(hrDepartments.code, q),
          ilike(hrDepartments.leadName, q),
          ilike(hrDepartments.parentName, q),
        )!,
      );
    }
    return db
      .select()
      .from(hrDepartments)
      .where(and(...clauses))
      .orderBy(asc(hrDepartments.name))
      .limit(limit)
      .offset(offset);
  },

  async count(ctx: TenantContext, opts: Omit<HrDepartmentListOpts, 'limit' | 'offset'> = {}): Promise<number> {
    const clauses = [eq(hrDepartments.tenantId, ctx.tenantId)];
    if (opts.q?.trim()) {
      const q = `%${opts.q.trim()}%`;
      clauses.push(
        or(
          ilike(hrDepartments.name, q),
          ilike(hrDepartments.code, q),
          ilike(hrDepartments.leadName, q),
          ilike(hrDepartments.parentName, q),
        )!,
      );
    }
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(hrDepartments)
      .where(and(...clauses));
    return rows[0]?.n ?? 0;
  },

  async createManual(ctx: TenantContext, input: ManualDepartmentInput): Promise<HrDepartment> {
    const parentName = input.parentName?.trim() || null;
    const parentId = parentName
      ? await resolveParentDepartmentId(ctx, { parentName })
      : null;
    const row: NewHrDepartment = {
      tenantId: ctx.tenantId,
      zohoRecordId: null,
      name: input.name.trim(),
      code: input.code?.trim() || null,
      mailAlias: input.mailAlias?.trim() || null,
      leadName: input.leadName?.trim() || null,
      parentName,
      parentId,
      source: 'manual',
      rawFields: null,
      lastSyncedAt: null,
    };
    const rows = await db.insert(hrDepartments).values(row).returning();
    return firstOrThrow(rows, 'hr_departments insert returned no row');
  },

  async update(
    ctx: TenantContext,
    id: string,
    patch: Partial<ManualDepartmentInput>,
  ): Promise<HrDepartment | undefined> {
    const updates: Partial<NewHrDepartment> = { updatedAt: new Date() };
    if (patch.name !== undefined) updates.name = patch.name.trim();
    if (patch.code !== undefined) updates.code = patch.code?.trim() || null;
    if (patch.mailAlias !== undefined) updates.mailAlias = patch.mailAlias?.trim() || null;
    if (patch.leadName !== undefined) updates.leadName = patch.leadName?.trim() || null;
    if (patch.parentName !== undefined) {
      const parentName = patch.parentName?.trim() || null;
      updates.parentName = parentName;
      updates.parentId = parentName
        ? await resolveParentDepartmentId(ctx, { parentName })
        : null;
    }

    const rows = await db
      .update(hrDepartments)
      .set(updates)
      .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.id, id)))
      .returning();
    return firstOrUndefined(rows);
  },

  async delete(ctx: TenantContext, id: string): Promise<boolean> {
    const rows = await db
      .delete(hrDepartments)
      .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.id, id)))
      .returning({ id: hrDepartments.id });
    return rows.length > 0;
  },

  async upsertFromZoho(
    ctx: TenantContext,
    input: UpsertDepartmentFromZohoInput,
  ): Promise<'inserted' | 'updated'> {
    const existing = await this.findByZohoRecordId(ctx, input.zohoRecordId);
    const parentId = await resolveParentDepartmentId(ctx, {
      ...(input.parentZohoId !== undefined ? { parentZohoId: input.parentZohoId } : {}),
      ...(input.parentName !== undefined ? { parentName: input.parentName } : {}),
    });
    const projected = {
      name: input.name.trim() || 'Untitled',
      code: input.code?.trim() || null,
      mailAlias: input.mailAlias?.trim() || null,
      leadName: input.leadName?.trim() || null,
      leadZohoId: input.leadZohoId?.trim() || null,
      leadEmail: input.leadEmail?.trim() || null,
      parentName: input.parentName?.trim() || null,
      parentZohoId: input.parentZohoId?.trim() || null,
      parentId,
      source: 'zoho_people' as const,
      rawFields: input.rawFields ?? null,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .update(hrDepartments)
        .set(projected)
        .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.id, existing.id)));
      return 'updated';
    }

    try {
      await db.insert(hrDepartments).values({
        tenantId: ctx.tenantId,
        zohoRecordId: input.zohoRecordId,
        ...projected,
      });
      return 'inserted';
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await this.findByZohoRecordId(ctx, input.zohoRecordId);
        if (raced) {
          await db
            .update(hrDepartments)
            .set(projected)
            .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.id, raced.id)));
          return 'updated';
        }
        // Name collision with a manual row — update by name if same tenant.
        const byName = await db
          .select()
          .from(hrDepartments)
          .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.name, projected.name)))
          .limit(1);
        const hit = firstOrUndefined(byName);
        if (hit) {
          await db
            .update(hrDepartments)
            .set({ ...projected, zohoRecordId: input.zohoRecordId })
            .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.id, hit.id)));
          return 'updated';
        }
      }
      throw err;
    }
  },

  /** Re-resolve parent_id for every department (run after a full Zoho department migrate). */
  async relinkParents(ctx: TenantContext): Promise<number> {
    const rows = await db
      .select({
        id: hrDepartments.id,
        parentZohoId: hrDepartments.parentZohoId,
        parentName: hrDepartments.parentName,
      })
      .from(hrDepartments)
      .where(eq(hrDepartments.tenantId, ctx.tenantId));
    let n = 0;
    for (const row of rows) {
      const parentId = await resolveParentDepartmentId(ctx, {
        ...(row.parentZohoId != null ? { parentZohoId: row.parentZohoId } : {}),
        ...(row.parentName != null ? { parentName: row.parentName } : {}),
      });
      await db
        .update(hrDepartments)
        .set({ parentId, updatedAt: new Date() })
        .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.id, row.id)));
      n += 1;
    }
    return n;
  },
};
