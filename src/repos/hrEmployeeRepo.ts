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
  designation?: string;
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
  telegramUsername?: string | null;
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
    // Exact, not ILIKE: the values come from the picklist itself, so a substring match would let
    // "Manager" also select "Billing Manager" and quietly widen the filter.
    if (opts.designation?.trim()) {
      clauses.push(eq(hrEmployees.designation, opts.designation.trim()));
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
      /*
       * ACTIVE FIRST, then alphabetical. Terminated people are still in the directory (they must be, for
       * history and for RBAC to deny them deliberately) but they are not who anyone is looking for.
       * `status` is the second column of hr_employees_tenant_idx, so this ordering is index-supported.
       */
      .orderBy(
        sql`case when lower(${hrEmployees.status}) = 'active' then 0 else 1 end`,
        asc(hrEmployees.lastName),
        asc(hrEmployees.firstName),
      )
      .limit(limit)
      .offset(offset);
  },

  /**
   * Every employee, unpaginated, for the Zoho-user email mapping.
   *
   * Deliberately includes TERMINATED rows: a departed person may still hold an active CRM login, and
   * RBAC has to resolve them in order to deny them on purpose rather than by accident. Bounded by the
   * directory's real size (a few hundred), so no pagination — but it is NOT a general-purpose list;
   * use `list()` for anything user-facing.
   */
  async listAllForMapping(ctx: TenantContext): Promise<HrEmployee[]> {
    return db
      .select()
      .from(hrEmployees)
      .where(eq(hrEmployees.tenantId, ctx.tenantId))
      .orderBy(asc(hrEmployees.lastName), asc(hrEmployees.firstName));
  },

  /**
   * Bind (or rebind) an employee to a Zoho CRM login.
   *
   * Tenant-scoped like every other write here. The partial unique index on (tenant_id, zoho_user_id)
   * is what actually guarantees one login maps to one employee; a violation surfaces as a clear error
   * rather than silently fanning out, because two rows answering "who is this session" is an RBAC hole.
   */
  async setZohoUserLink(
    ctx: TenantContext,
    employeeId: string,
    zohoUserId: string,
    source: 'email_match' | 'manual',
  ): Promise<HrEmployee | undefined> {
    const rows = await db
      .update(hrEmployees)
      .set({
        zohoUserId,
        zohoUserIdSource: source,
        zohoUserLinkedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.id, employeeId)))
      .returning();
    return firstOrUndefined(rows);
  },

  /**
   * The employee a signed-in Zoho CRM user IS — the entry point for HR RBAC.
   *
   * Returns undefined when the session has no mapped employee, which callers must treat as NO ACCESS.
   * Never fall back to matching on email here: the mapping is resolved deliberately and audited by
   * `syncZohoUserMapping`, and a per-request email guess is exactly how one person ends up reading
   * another's record.
   */
  async findByZohoUserId(ctx: TenantContext, zohoUserId: string): Promise<HrEmployee | undefined> {
    const id = zohoUserId.trim();
    if (!id) return undefined;
    const rows = await db
      .select()
      .from(hrEmployees)
      .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.zohoUserId, id)))
      .limit(1);
    return firstOrUndefined(rows);
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
    // Exact, not ILIKE: the values come from the picklist itself, so a substring match would let
    // "Manager" also select "Billing Manager" and quietly widen the filter.
    if (opts.designation?.trim()) {
      clauses.push(eq(hrEmployees.designation, opts.designation.trim()));
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

  /**
   * Upsert a whole Zoho page in CHUNKED multi-row statements.
   *
   * `upsertFromZoho` costs ~4 round-trips per employee (findByZohoRecordId + two department lookups +
   * the write). Against the Render Postgres, measured at ~266 ms RTT, 213 employees is ~226 s — so the
   * full sync could never finish inside a request. It died partway and left the table half-populated
   * with no error surfaced anywhere, which is why prod sat at 88 of 213 records.
   *
   * This resolves departments ONCE into a lookup map and writes in chunks, taking the same sync from
   * ~850 round-trips to ~3. Conflicts target the partial unique index on (tenant, zoho_record_id) —
   * its predicate has to be repeated in the ON CONFLICT clause for Postgres to match it.
   */
  async bulkUpsertFromZoho(
    ctx: TenantContext,
    inputs: readonly UpsertFromZohoInput[],
    opts: { chunkSize?: number } = {},
  ): Promise<{ written: number }> {
    if (inputs.length === 0) return { written: 0 };
    const chunkSize = Math.min(Math.max(opts.chunkSize ?? 100, 1), 500);

    // One read instead of two per employee. Both arms of resolveDepartmentId (Zoho id, then exact
    // name) are reproduced against the map so linking behaviour is unchanged.
    const departments = await hrDepartmentRepo.list(ctx);
    const byZohoId = new Map<string, { id: string; name: string }>();
    const byName = new Map<string, { id: string; name: string }>();
    for (const d of departments) {
      if (d.zohoRecordId) byZohoId.set(d.zohoRecordId, { id: d.id, name: d.name });
      byName.set(d.name, { id: d.id, name: d.name });
    }

    const now = new Date();
    const rows: NewHrEmployee[] = inputs.map((input) => {
      const zohoDeptId = input.departmentZohoId?.trim() || null;
      const deptName = input.department?.trim() || null;
      const link =
        (zohoDeptId ? byZohoId.get(zohoDeptId) : undefined) ??
        (deptName ? byName.get(deptName) : undefined);
      return {
        tenantId: ctx.tenantId,
        zohoRecordId: input.zohoRecordId,
        employeeId: input.employeeId?.trim() || null,
        firstName: input.firstName.trim() || 'Unknown',
        lastName: input.lastName.trim() || 'Unknown',
        email: input.email?.trim() || null,
        departmentId: link?.id ?? null,
        department: link?.name ?? deptName,
        departmentZohoId: zohoDeptId,
        designation: input.designation?.trim() || null,
        location: input.location?.trim() || null,
        status: input.status?.trim() || 'Active',
        role: input.role?.trim() || null,
        dateOfJoining: input.dateOfJoining?.trim() || null,
        mobile: input.mobile?.trim() || null,
        reportingTo: input.reportingTo?.trim() || null,
        reportingToZohoId: input.reportingToZohoId?.trim() || null,
        photoUrl: input.photoUrl?.trim() || null,
        source: 'zoho_people',
        rawFields: input.rawFields ?? null,
        lastSyncedAt: now,
        updatedAt: now,
      };
    });

    let written = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const done = await db
        .insert(hrEmployees)
        .values(chunk)
        .onConflictDoUpdate({
          target: [hrEmployees.tenantId, hrEmployees.zohoRecordId],
          targetWhere: sql`${hrEmployees.zohoRecordId} is not null`,
          set: {
            employeeId: sql`excluded.employee_id`,
            firstName: sql`excluded.first_name`,
            lastName: sql`excluded.last_name`,
            email: sql`excluded.email`,
            departmentId: sql`excluded.department_id`,
            department: sql`excluded.department`,
            departmentZohoId: sql`excluded.department_zoho_id`,
            designation: sql`excluded.designation`,
            location: sql`excluded.location`,
            status: sql`excluded.status`,
            role: sql`excluded.role`,
            dateOfJoining: sql`excluded.date_of_joining`,
            mobile: sql`excluded.mobile`,
            reportingTo: sql`excluded.reporting_to`,
            reportingToZohoId: sql`excluded.reporting_to_zoho_id`,
            photoUrl: sql`excluded.photo_url`,
            source: sql`excluded.source`,
            rawFields: sql`excluded.raw_fields`,
            lastSyncedAt: sql`excluded.last_synced_at`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
        .returning({ id: hrEmployees.id });
      written += done.length;
    }
    return { written };
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
