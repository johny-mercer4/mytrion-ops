import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { hrDepartments, type HrDepartment, type NewHrDepartment } from '../db/schema/index.js';
import { ConflictError } from '../lib/errors.js';
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
  /** Rich-text (markdown) purpose of the department — what a card and the canvas node detail show. */
  description?: string | null;
  /** A lucide component name, shape-validated at the route. Unknown names fall back in the UI. */
  icon?: string | null;
  /** A Horizon tone token name (e.g. 'tone-sky'), never a raw colour. */
  iconColor?: string | null;
}

/**
 * Everything except `raw_fields`.
 *
 * `db.select()` on this table drags the full Zoho People department payload along with every row. No
 * read path uses it, and on the employees table the same mistake is what makes the directory slow, so
 * both list projections are explicit. Add a column here when you add one to the DTO — not before.
 */
const DEPT_COLUMNS = {
  id: hrDepartments.id,
  tenantId: hrDepartments.tenantId,
  zohoRecordId: hrDepartments.zohoRecordId,
  name: hrDepartments.name,
  code: hrDepartments.code,
  mailAlias: hrDepartments.mailAlias,
  leadName: hrDepartments.leadName,
  leadZohoId: hrDepartments.leadZohoId,
  leadEmail: hrDepartments.leadEmail,
  parentName: hrDepartments.parentName,
  parentZohoId: hrDepartments.parentZohoId,
  parentId: hrDepartments.parentId,
  description: hrDepartments.description,
  icon: hrDepartments.icon,
  iconColor: hrDepartments.iconColor,
  canvasX: hrDepartments.canvasX,
  canvasY: hrDepartments.canvasY,
  source: hrDepartments.source,
  lastSyncedAt: hrDepartments.lastSyncedAt,
  createdAt: hrDepartments.createdAt,
  updatedAt: hrDepartments.updatedAt,
} as const;

/** A department row without the `raw_fields` bag — what every read path returns. */
export type HrDepartmentRow = Omit<HrDepartment, 'rawFields'>;

/**
 * hr_departments — tenant-scoped org units. Zoho sync upserts by (tenant, zoho_record_id);
 * manual rows have null zoho_record_id.
 */
export const hrDepartmentRepo = {
  async getById(ctx: TenantContext, id: string): Promise<HrDepartmentRow | undefined> {
    const rows = await db
      .select(DEPT_COLUMNS)
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

  /** Exact name lookup — the department name is unique per tenant. */
  async findByName(ctx: TenantContext, name: string): Promise<HrDepartmentRow | undefined> {
    const n = name.trim();
    if (!n) return undefined;
    const rows = await db
      .select(DEPT_COLUMNS)
      .from(hrDepartments)
      .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.name, n)))
      .limit(1);
    return firstOrUndefined(rows);
  },

  async list(ctx: TenantContext, opts: HrDepartmentListOpts = {}): Promise<HrDepartmentRow[]> {
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
      .select(DEPT_COLUMNS)
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

  async createManual(ctx: TenantContext, input: ManualDepartmentInput): Promise<HrDepartmentRow> {
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
      description: input.description?.trim() || null,
      icon: input.icon?.trim() || null,
      iconColor: input.iconColor?.trim() || null,
      source: 'manual',
      rawFields: null,
      lastSyncedAt: null,
    };
    try {
      const rows = await db.insert(hrDepartments).values(row).returning(DEPT_COLUMNS);
      return firstOrThrow(rows, 'hr_departments insert returned no row');
    } catch (err) {
      /**
       * `hr_departments_tenant_name_uk` makes the name unique per tenant, and re-adding an existing
       * department is an ordinary mistake — it was surfacing as a 500 INTERNAL_ERROR, which reads as
       * "the app is broken" rather than "that name is taken".
       */
      if (isUniqueViolation(err)) {
        throw new ConflictError(`A department named “${row.name}” already exists`);
      }
      throw err;
    }
  },

  async update(
    ctx: TenantContext,
    id: string,
    patch: Partial<ManualDepartmentInput>,
  ): Promise<HrDepartmentRow | undefined> {
    const updates: Partial<NewHrDepartment> = { updatedAt: new Date() };
    if (patch.name !== undefined) updates.name = patch.name.trim();
    if (patch.code !== undefined) updates.code = patch.code?.trim() || null;
    if (patch.mailAlias !== undefined) updates.mailAlias = patch.mailAlias?.trim() || null;
    if (patch.leadName !== undefined) updates.leadName = patch.leadName?.trim() || null;
    if (patch.description !== undefined) updates.description = patch.description?.trim() || null;
    if (patch.icon !== undefined) updates.icon = patch.icon?.trim() || null;
    if (patch.iconColor !== undefined) updates.iconColor = patch.iconColor?.trim() || null;
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
      .returning(DEPT_COLUMNS);
    return firstOrUndefined(rows);
  },

  /**
   * Move a department under another one BY ID — what dragging a node on the org canvas does.
   *
   * Separate from `update()` because the canvas has no name to work from and must not go through the
   * name-resolution path: `parent_name` is kept in sync here from the target row so the two columns
   * never disagree. A null `parentId` promotes the department to a root.
   *
   * Returns undefined when either row is missing in this tenant, so a cross-tenant id is a no-op
   * rather than a silent re-parent.
   */
  async setParent(
    ctx: TenantContext,
    id: string,
    parentId: string | null,
  ): Promise<HrDepartmentRow | undefined> {
    let parentName: string | null = null;
    if (parentId) {
      if (parentId === id) return undefined; // a department cannot be its own parent
      const parent = await this.getById(ctx, parentId);
      if (!parent) return undefined;
      parentName = parent.name;
    }
    const rows = await db
      .update(hrDepartments)
      .set({ parentId, parentName, updatedAt: new Date() })
      .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.id, id)))
      .returning(DEPT_COLUMNS);
    return firstOrUndefined(rows);
  },

  /**
   * Persist a dragged canvas position. Deliberately does NOT touch `updated_at`: a node nudge is a
   * per-viewer layout preference, and letting it bump the row's timestamp would make "last changed"
   * useless for spotting real edits to a department.
   */
  async setCanvasPosition(
    ctx: TenantContext,
    id: string,
    pos: { x: number; y: number } | null,
  ): Promise<boolean> {
    const rows = await db
      .update(hrDepartments)
      .set({
        canvasX: pos ? Math.round(pos.x) : null,
        canvasY: pos ? Math.round(pos.y) : null,
      })
      .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.id, id)))
      .returning({ id: hrDepartments.id });
    return rows.length > 0;
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
