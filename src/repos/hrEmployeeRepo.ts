import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { hrEmployees, type HrEmployee, type NewHrEmployee } from '../db/schema/index.js';
import { resolveDepartmentId } from '../modules/hr/resolveDepartmentLink.js';
import type { TenantContext } from '../types/tenantContext.js';
import { hrDepartmentRepo } from './hrDepartmentRepo.js';
import { firstOrThrow, firstOrUndefined, isUniqueViolation } from './util.js';

export interface HrEmployeeListOpts {
  q?: string;
  status?: string;
  department?: string;
  departmentId?: string;
  limit?: number;
  offset?: number;
}

export interface UpsertFromZohoInput {
  zohoRecordId: string;
  employeeId?: string | null;
  firstName: string;
  lastName: string;
  email?: string | null;
  department?: string | null;
  departmentZohoId?: string | null;
  designation?: string | null;
  location?: string | null;
  status?: string | null;
  role?: string | null;
  dateOfJoining?: string | null;
  mobile?: string | null;
  reportingTo?: string | null;
  reportingToZohoId?: string | null;
  photoUrl?: string | null;
  rawFields?: Record<string, unknown> | null;
}

export interface ManualEmployeeInput {
  employeeId?: string | null;
  firstName: string;
  lastName: string;
  email?: string | null;
  departmentId?: string | null;
  department?: string | null;
  designation?: string | null;
  location?: string | null;
  status?: string | null;
  role?: string | null;
  dateOfJoining?: string | null;
  mobile?: string | null;
  reportingTo?: string | null;
}

/**
 * hr_employees — tenant-scoped directory. Every query filters `tenant_id`. Zoho sync upserts by
 * (tenant, zoho_record_id); manual rows have null zoho_record_id. `department_id` links to
 * hr_departments when resolvable.
 */
export const hrEmployeeRepo = {
  async getById(ctx: TenantContext, id: string): Promise<HrEmployee | undefined> {
    const rows = await db
      .select()
      .from(hrEmployees)
      .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.id, id)))
      .limit(1);
    return firstOrUndefined(rows);
  },

  async findByZohoRecordId(
    ctx: TenantContext,
    zohoRecordId: string,
  ): Promise<HrEmployee | undefined> {
    const rows = await db
      .select()
      .from(hrEmployees)
      .where(
        and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.zohoRecordId, zohoRecordId)),
      )
      .limit(1);
    return firstOrUndefined(rows);
  },

  async list(ctx: TenantContext, opts: HrEmployeeListOpts = {}): Promise<HrEmployee[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const clauses = [eq(hrEmployees.tenantId, ctx.tenantId)];
    if (opts.status?.trim()) {
      clauses.push(eq(hrEmployees.status, opts.status.trim()));
    }
    if (opts.departmentId?.trim()) {
      clauses.push(eq(hrEmployees.departmentId, opts.departmentId.trim()));
    } else if (opts.department?.trim()) {
      clauses.push(ilike(hrEmployees.department, `%${opts.department.trim()}%`));
    }
    if (opts.q?.trim()) {
      const q = `%${opts.q.trim()}%`;
      clauses.push(
        or(
          ilike(hrEmployees.firstName, q),
          ilike(hrEmployees.lastName, q),
          ilike(hrEmployees.email, q),
          ilike(hrEmployees.employeeId, q),
        )!,
      );
    }
    return db
      .select()
      .from(hrEmployees)
      .where(and(...clauses))
      .orderBy(asc(hrEmployees.lastName), asc(hrEmployees.firstName))
      .limit(limit)
      .offset(offset);
  },

  async count(
    ctx: TenantContext,
    opts: Omit<HrEmployeeListOpts, 'limit' | 'offset'> = {},
  ): Promise<number> {
    const clauses = [eq(hrEmployees.tenantId, ctx.tenantId)];
    if (opts.status?.trim()) clauses.push(eq(hrEmployees.status, opts.status.trim()));
    if (opts.departmentId?.trim()) {
      clauses.push(eq(hrEmployees.departmentId, opts.departmentId.trim()));
    } else if (opts.department?.trim()) {
      clauses.push(ilike(hrEmployees.department, `%${opts.department.trim()}%`));
    }
    if (opts.q?.trim()) {
      const q = `%${opts.q.trim()}%`;
      clauses.push(
        or(
          ilike(hrEmployees.firstName, q),
          ilike(hrEmployees.lastName, q),
          ilike(hrEmployees.email, q),
          ilike(hrEmployees.employeeId, q),
        )!,
      );
    }
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(hrEmployees)
      .where(and(...clauses));
    return rows[0]?.n ?? 0;
  },

  /** Distinct designation labels for the HR picklist (no separate table). */
  async listDesignationPicklist(ctx: TenantContext): Promise<string[]> {
    const rows = await db
      .select({ designation: hrEmployees.designation })
      .from(hrEmployees)
      .where(
        and(
          eq(hrEmployees.tenantId, ctx.tenantId),
          sql`${hrEmployees.designation} is not null`,
          sql`trim(${hrEmployees.designation}) <> ''`,
        ),
      )
      .groupBy(hrEmployees.designation)
      .orderBy(asc(hrEmployees.designation));
    return rows.map((r) => r.designation!).filter(Boolean);
  },

  async createManual(ctx: TenantContext, input: ManualEmployeeInput): Promise<HrEmployee> {
    const link = await resolveDepartmentLinkForManual(ctx, input);
    const row: NewHrEmployee = {
      tenantId: ctx.tenantId,
      zohoRecordId: null,
      employeeId: input.employeeId?.trim() || null,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email?.trim() || null,
      departmentId: link.departmentId,
      department: link.departmentName,
      departmentZohoId: null,
      designation: input.designation?.trim() || null,
      location: input.location?.trim() || null,
      status: input.status?.trim() || 'Active',
      role: input.role?.trim() || null,
      dateOfJoining: input.dateOfJoining?.trim() || null,
      mobile: input.mobile?.trim() || null,
      reportingTo: input.reportingTo?.trim() || null,
      source: 'manual',
      rawFields: null,
      lastSyncedAt: null,
    };
    const rows = await db.insert(hrEmployees).values(row).returning();
    return firstOrThrow(rows, 'hr_employees insert returned no row');
  },

  async update(
    ctx: TenantContext,
    id: string,
    patch: Partial<ManualEmployeeInput>,
  ): Promise<HrEmployee | undefined> {
    const updates: Partial<NewHrEmployee> = { updatedAt: new Date() };
    if (patch.employeeId !== undefined) updates.employeeId = patch.employeeId?.trim() || null;
    if (patch.firstName !== undefined) updates.firstName = patch.firstName.trim();
    if (patch.lastName !== undefined) updates.lastName = patch.lastName.trim();
    if (patch.email !== undefined) updates.email = patch.email?.trim() || null;
    if (patch.departmentId !== undefined || patch.department !== undefined) {
      const link = await resolveDepartmentLinkForManual(ctx, {
        ...(patch.departmentId !== undefined ? { departmentId: patch.departmentId } : {}),
        ...(patch.department !== undefined ? { department: patch.department } : {}),
      });
      updates.departmentId = link.departmentId;
      updates.department = link.departmentName;
    }
    if (patch.designation !== undefined) updates.designation = patch.designation?.trim() || null;
    if (patch.location !== undefined) updates.location = patch.location?.trim() || null;
    if (patch.status !== undefined) updates.status = patch.status?.trim() || 'Active';
    if (patch.role !== undefined) updates.role = patch.role?.trim() || null;
    if (patch.dateOfJoining !== undefined) {
      updates.dateOfJoining = patch.dateOfJoining?.trim() || null;
    }
    if (patch.mobile !== undefined) updates.mobile = patch.mobile?.trim() || null;
    if (patch.reportingTo !== undefined) updates.reportingTo = patch.reportingTo?.trim() || null;

    const rows = await db
      .update(hrEmployees)
      .set(updates)
      .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.id, id)))
      .returning();
    return firstOrUndefined(rows);
  },

  async delete(ctx: TenantContext, id: string): Promise<boolean> {
    const rows = await db
      .delete(hrEmployees)
      .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.id, id)))
      .returning({ id: hrEmployees.id });
    return rows.length > 0;
  },

  async upsertFromZoho(ctx: TenantContext, input: UpsertFromZohoInput): Promise<'inserted' | 'updated'> {
    const existing = await this.findByZohoRecordId(ctx, input.zohoRecordId);
    const link = await resolveDepartmentId(ctx, {
      ...(input.departmentZohoId !== undefined
        ? { departmentZohoId: input.departmentZohoId }
        : {}),
      ...(input.department !== undefined ? { departmentName: input.department } : {}),
    });
    const projected = {
      employeeId: input.employeeId?.trim() || null,
      firstName: input.firstName.trim() || 'Unknown',
      lastName: input.lastName.trim() || 'Unknown',
      email: input.email?.trim() || null,
      departmentId: link.departmentId,
      department: link.departmentName ?? (input.department?.trim() || null),
      departmentZohoId: input.departmentZohoId?.trim() || null,
      designation: input.designation?.trim() || null,
      location: input.location?.trim() || null,
      status: input.status?.trim() || 'Active',
      role: input.role?.trim() || null,
      dateOfJoining: input.dateOfJoining?.trim() || null,
      mobile: input.mobile?.trim() || null,
      reportingTo: input.reportingTo?.trim() || null,
      reportingToZohoId: input.reportingToZohoId?.trim() || null,
      photoUrl: input.photoUrl?.trim() || null,
      source: 'zoho_people' as const,
      rawFields: input.rawFields ?? null,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .update(hrEmployees)
        .set(projected)
        .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.id, existing.id)));
      return 'updated';
    }

    try {
      await db.insert(hrEmployees).values({
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
            .update(hrEmployees)
            .set(projected)
            .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.id, raced.id)));
          return 'updated';
        }
      }
      throw err;
    }
  },
};

async function resolveDepartmentLinkForManual(
  ctx: TenantContext,
  input: { departmentId?: string | null; department?: string | null },
): Promise<{ departmentId: string | null; departmentName: string | null }> {
  if (input.departmentId !== undefined && input.departmentId !== null) {
    const id = input.departmentId.trim();
    if (!id) return { departmentId: null, departmentName: null };
    const row = await hrDepartmentRepo.getById(ctx, id);
    if (row) return { departmentId: row.id, departmentName: row.name };
    return { departmentId: null, departmentName: input.department?.trim() || null };
  }
  return resolveDepartmentId(ctx, {
    ...(input.department !== undefined ? { departmentName: input.department } : {}),
  });
}
