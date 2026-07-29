/**
 * hr_employees — the ZOHO PEOPLE write paths.
 *
 * Split out of `hrEmployeeRepo.ts`, which the org-canvas work pushed past the repo's 600-line cap
 * (CLAUDE.md rule 5). The seam is a real one rather than an arbitrary cut: everything here is only ever
 * reached from `syncHrEmployeesFromZoho`, writes with Zoho as the authority, and is the only code that
 * touches `raw_fields` — while `hrEmployeeRepo` is what the UI reads and what an admin edit writes.
 *
 * Tenant isolation is unchanged: every statement filters or sets `tenant_id`.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { hrEmployees, type NewHrEmployee } from '../db/schema/index.js';
import { resolveDepartmentId } from '../modules/hr/resolveDepartmentLink.js';
import type { TenantContext } from '../types/tenantContext.js';
import { hrDepartmentRepo } from './hrDepartmentRepo.js';
import { hrEmployeeRepo } from './hrEmployeeRepo.js';
import { isUniqueViolation } from './util.js';

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

export const hrEmployeeSyncRepo = {
  /**
   * Re-resolve `reporting_to_employee_id` from the `reporting_to` NAME for the whole tenant.
   *
   * Run after a Zoho employee sync. The sync overwrites `reporting_to` (Zoho owns the name) but knows
   * nothing about the id column, so without this the two contradict each other: the card shows one
   * manager and the org canvas draws the line to another.
   *
   * Same rule as the 0068 backfill and as `zohoUserId` mapping: a name is linked only when it matches
   * EXACTLY ONE other employee. An ambiguous name resolves to nothing rather than to a guess, because
   * attaching someone to the wrong manager silently reshapes the chart. Set-based, so it is one
   * statement rather than a round trip per employee.
   */
  async relinkManagers(ctx: TenantContext): Promise<number> {
    // RETURNING + a row count, because the postgres-js driver's execute() result is a row list rather
    // than a command tag with rowCount.
    const rows = await db.execute(sql`
      with named as (
        select
          lower(btrim(first_name || ' ' || last_name)) as full_name,
          min(id) as id,
          count(*) as n
        from hr_employees
        where tenant_id = ${ctx.tenantId}
        group by 1
      )
      update hr_employees e
      set reporting_to_employee_id = case when named.n = 1 then named.id else null end
      from named
      where e.tenant_id = ${ctx.tenantId}
        and e.reporting_to is not null
        and lower(btrim(e.reporting_to)) = named.full_name
        and named.id <> e.id
        and e.reporting_to_employee_id is distinct from (case when named.n = 1 then named.id else null end)
      returning e.id
    `);
    return Array.isArray(rows) ? rows.length : 0;
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
    const existing = await hrEmployeeRepo.findByZohoRecordId(ctx, input.zohoRecordId);
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
        const raced = await hrEmployeeRepo.findByZohoRecordId(ctx, input.zohoRecordId);
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
