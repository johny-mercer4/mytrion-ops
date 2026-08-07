import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { hrEmployees, type HrEmployee, type NewHrEmployee } from '../db/schema/index.js';
import { ValidationError } from '../lib/errors.js';
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
  faceId?: string | null;
  telegramUsername?: string | null;
  reportingTo?: string | null;
  /** The manager as an id — what the org canvas sets. `reportingTo` is kept in sync from it. */
  reportingToEmployeeId?: string | null;
}

/**
 * Everything except `raw_fields`.
 *
 * `raw_fields` holds the ENTIRE Zoho People payload per person — tabular sections and all. A
 * `db.select()` on the list path therefore shipped the full Zoho mirror for up to 500 employees on
 * every keystroke of the directory search, for a UI that reads eighteen scalar columns. That is the
 * single biggest cost in loading the Employees tab, and no client-side cache can undo it.
 *
 * Keep this in sync with the route DTO. Anything not listed here is unreachable from a read path,
 * which is the point: `raw_fields` is for the sync to write and for support to inspect in SQL.
 */
const EMPLOYEE_COLUMNS = {
  id: hrEmployees.id,
  tenantId: hrEmployees.tenantId,
  zohoRecordId: hrEmployees.zohoRecordId,
  employeeId: hrEmployees.employeeId,
  firstName: hrEmployees.firstName,
  lastName: hrEmployees.lastName,
  email: hrEmployees.email,
  departmentId: hrEmployees.departmentId,
  department: hrEmployees.department,
  departmentZohoId: hrEmployees.departmentZohoId,
  designation: hrEmployees.designation,
  location: hrEmployees.location,
  status: hrEmployees.status,
  role: hrEmployees.role,
  dateOfJoining: hrEmployees.dateOfJoining,
  mobile: hrEmployees.mobile,
  faceId: hrEmployees.faceId,
  telegramUsername: hrEmployees.telegramUsername,
  reportingTo: hrEmployees.reportingTo,
  reportingToZohoId: hrEmployees.reportingToZohoId,
  reportingToEmployeeId: hrEmployees.reportingToEmployeeId,
  photoUrl: hrEmployees.photoUrl,
  photoFileId: hrEmployees.photoFileId,
  zohoUserId: hrEmployees.zohoUserId,
  zohoUserIdSource: hrEmployees.zohoUserIdSource,
  zohoUserLinkedAt: hrEmployees.zohoUserLinkedAt,
  canvasX: hrEmployees.canvasX,
  canvasY: hrEmployees.canvasY,
  source: hrEmployees.source,
  lastSyncedAt: hrEmployees.lastSyncedAt,
  createdAt: hrEmployees.createdAt,
  updatedAt: hrEmployees.updatedAt,
} as const;

/** An employee row without the `raw_fields` bag — what every read path returns. */
export type HrEmployeeRow = Omit<HrEmployee, 'rawFields'>;

/**
 * hr_employees — tenant-scoped directory. Every query filters `tenant_id`. Zoho sync upserts by
 * (tenant, zoho_record_id); manual rows have null zoho_record_id. `department_id` links to
 * hr_departments when resolvable.
 */
export const hrEmployeeRepo = {
  async getById(ctx: TenantContext, id: string): Promise<HrEmployeeRow | undefined> {
    const rows = await db
      .select(EMPLOYEE_COLUMNS)
      .from(hrEmployees)
      .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.id, id)))
      .limit(1);
    return firstOrUndefined(rows);
  },

  async findByZohoRecordId(
    ctx: TenantContext,
    zohoRecordId: string,
  ): Promise<HrEmployeeRow | undefined> {
    const rows = await db
      .select(EMPLOYEE_COLUMNS)
      .from(hrEmployees)
      .where(
        and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.zohoRecordId, zohoRecordId)),
      )
      .limit(1);
    return firstOrUndefined(rows);
  },

  async list(ctx: TenantContext, opts: HrEmployeeListOpts = {}): Promise<HrEmployeeRow[]> {
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
      .select(EMPLOYEE_COLUMNS)
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
  async listAllForMapping(ctx: TenantContext): Promise<HrEmployeeRow[]> {
    return db
      .select(EMPLOYEE_COLUMNS)
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
  ): Promise<HrEmployeeRow | undefined> {
    const rows = await db
      .update(hrEmployees)
      .set({
        zohoUserId,
        zohoUserIdSource: source,
        zohoUserLinkedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.id, employeeId)))
      .returning(EMPLOYEE_COLUMNS);
    return firstOrUndefined(rows);
  },

  /** Remove a manually or automatically resolved CRM login from an employee. */
  async clearZohoUserLink(
    ctx: TenantContext,
    employeeId: string,
  ): Promise<HrEmployeeRow | undefined> {
    const rows = await db
      .update(hrEmployees)
      .set({
        zohoUserId: null,
        zohoUserIdSource: null,
        zohoUserLinkedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.id, employeeId)))
      .returning(EMPLOYEE_COLUMNS);
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
  async findByZohoUserId(ctx: TenantContext, zohoUserId: string): Promise<HrEmployeeRow | undefined> {
    const id = zohoUserId.trim();
    if (!id) return undefined;
    const rows = await db
      .select(EMPLOYEE_COLUMNS)
      .from(hrEmployees)
      .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.zohoUserId, id)))
      .limit(1);
    return firstOrUndefined(rows);
  },

  /**
   * Biometric / Hikvision Face ID → employee.
   *
   * Readers sometimes send an eight-character zero-padded code while HR stores the same numeric
   * Face ID without padding. Numeric ids therefore compare after leading-zero normalization;
   * non-numeric ids remain exact (case-insensitive). More than one match fails closed rather than
   * attaching a punch to the wrong person.
   */
  async findByFaceId(ctx: TenantContext, faceId: string): Promise<HrEmployeeRow | undefined> {
    const id = faceId.trim();
    if (!id) return undefined;
    const normalized = sql<string>`
      case
        when btrim(${hrEmployees.faceId}) ~ '^[0-9]+$'
          then coalesce(nullif(ltrim(btrim(${hrEmployees.faceId}), '0'), ''), '0')
        else lower(btrim(${hrEmployees.faceId}))
      end
    `;
    const inputNormalized = /^[0-9]+$/.test(id)
      ? id.replace(/^0+/, '') || '0'
      : id.toLocaleLowerCase('en-US');
    const rows = await db
      .select(EMPLOYEE_COLUMNS)
      .from(hrEmployees)
      .where(
        and(
          eq(hrEmployees.tenantId, ctx.tenantId),
          sql`${hrEmployees.faceId} is not null`,
          sql`${normalized} = ${inputNormalized}`,
        ),
      )
      .limit(2);
    return rows.length === 1 ? rows[0] : undefined;
  },

  /** Direct reports — people whose manager FK points at `managerEmployeeId`. */
  async listByReportingTo(
    ctx: TenantContext,
    managerEmployeeId: string,
    opts: { status?: string; limit?: number } = {},
  ): Promise<HrEmployeeRow[]> {
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), 500);
    const clauses = [
      eq(hrEmployees.tenantId, ctx.tenantId),
      eq(hrEmployees.reportingToEmployeeId, managerEmployeeId),
    ];
    if (opts.status?.trim()) clauses.push(eq(hrEmployees.status, opts.status.trim()));
    return db
      .select(EMPLOYEE_COLUMNS)
      .from(hrEmployees)
      .where(and(...clauses))
      .orderBy(asc(hrEmployees.lastName), asc(hrEmployees.firstName))
      .limit(limit);
  },

  /** Employees in any of the given departments (empty ids → []). */
  async listByDepartmentIds(
    ctx: TenantContext,
    departmentIds: string[],
    opts: { status?: string; limit?: number } = {},
  ): Promise<HrEmployeeRow[]> {
    if (departmentIds.length === 0) return [];
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), 500);
    const clauses = [
      eq(hrEmployees.tenantId, ctx.tenantId),
      inArray(hrEmployees.departmentId, departmentIds),
    ];
    if (opts.status?.trim()) clauses.push(eq(hrEmployees.status, opts.status.trim()));
    return db
      .select(EMPLOYEE_COLUMNS)
      .from(hrEmployees)
      .where(and(...clauses))
      .orderBy(asc(hrEmployees.lastName), asc(hrEmployees.firstName))
      .limit(limit);
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

  async createManual(ctx: TenantContext, input: ManualEmployeeInput): Promise<HrEmployeeRow> {
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
      /**
       * The handle arrives already bare (the route strips '@' and any t.me/ prefix). This line was
       * MISSING: `telegramUsername` was on the input type and on the form, so the field looked saved
       * and silently wasn't — a create never wrote it and an edit never updated it.
       */
      faceId: input.faceId?.trim() || null,
      telegramUsername: input.telegramUsername?.trim() || null,
      reportingTo: input.reportingTo?.trim() || null,
      reportingToEmployeeId: input.reportingToEmployeeId?.trim() || null,
      source: 'manual',
      rawFields: null,
      lastSyncedAt: null,
    };
    try {
      const rows = await db.insert(hrEmployees).values(row).returning(EMPLOYEE_COLUMNS);
      return firstOrThrow(rows, 'hr_employees insert returned no row');
    } catch (err) {
      throw employeeWriteConflict(err);
    }
  },

  async update(
    ctx: TenantContext,
    id: string,
    patch: Partial<ManualEmployeeInput>,
  ): Promise<HrEmployeeRow | undefined> {
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
    if (patch.faceId !== undefined) updates.faceId = patch.faceId?.trim() || null;
    // See createManual: this branch was missing too, so editing a Telegram handle was a no-op.
    if (patch.telegramUsername !== undefined) {
      updates.telegramUsername = patch.telegramUsername?.trim() || null;
    }
    if (patch.reportingTo !== undefined) updates.reportingTo = patch.reportingTo?.trim() || null;
    /**
     * An id-based manager change resolves the display NAME too, exactly as `setManager` does. Without
     * this the edit form (which picks a manager by id) and the org canvas (which drags one) would write
     * different columns, and the card would keep showing the old manager's name forever.
     *
     * An unknown id clears both rather than storing a link to a row that is not there.
     */
    if (patch.reportingToEmployeeId !== undefined) {
      const managerId = patch.reportingToEmployeeId?.trim() || null;
      if (managerId && managerId !== id) {
        const manager = await this.getById(ctx, managerId);
        updates.reportingToEmployeeId = manager?.id ?? null;
        updates.reportingTo = manager ? `${manager.firstName} ${manager.lastName}`.trim() : null;
      } else {
        updates.reportingToEmployeeId = null;
        updates.reportingTo = null;
      }
    }

    try {
      const rows = await db
        .update(hrEmployees)
        .set(updates)
        .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.id, id)))
        .returning(EMPLOYEE_COLUMNS);
      return firstOrUndefined(rows);
    } catch (err) {
      throw employeeWriteConflict(err);
    }
  },

  /**
   * Move a person under a manager BY ID — a drag on the org canvas.
   *
   * Writes `reportingTo` from the target row at the same time so the display name and the id link can
   * never disagree, and returns undefined if either row is missing in this tenant (so a cross-tenant
   * id is a no-op, not a silent re-parent). Cycle rejection lives in the route, which is the only
   * layer that can see the whole tree.
   */
  async setManager(
    ctx: TenantContext,
    id: string,
    managerId: string | null,
  ): Promise<HrEmployeeRow | undefined> {
    let reportingTo: string | null = null;
    if (managerId) {
      if (managerId === id) return undefined; // nobody reports to themselves
      const manager = await this.getById(ctx, managerId);
      if (!manager) return undefined;
      reportingTo = `${manager.firstName} ${manager.lastName}`.trim();
    }
    const rows = await db
      .update(hrEmployees)
      .set({ reportingToEmployeeId: managerId, reportingTo, updatedAt: new Date() })
      .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.id, id)))
      .returning(EMPLOYEE_COLUMNS);
    return firstOrUndefined(rows);
  },

  /**
   * Move a person into a department BY ID — dropping their node onto a department node. Keeps the
   * denormalized `department` name in step with `department_id`, exactly as `update()` does.
   */
  async setDepartment(
    ctx: TenantContext,
    id: string,
    departmentId: string | null,
    /**
     * Clear the manager link at the same time.
     *
     * The canvas passes true: dropping a person onto a DEPARTMENT node means "you hang directly off this
     * department". Leaving their manager set made that gesture a visible no-op — the org chart draws a
     * person under their manager in preference to their department, so the node stayed exactly where it
     * was and the drag looked broken even though the write succeeded.
     */
    detachManager = false,
  ): Promise<HrEmployeeRow | undefined> {
    let name: string | null = null;
    if (departmentId) {
      const dept = await hrDepartmentRepo.getById(ctx, departmentId);
      if (!dept) return undefined;
      name = dept.name;
    }
    const rows = await db
      .update(hrEmployees)
      .set({
        departmentId,
        department: name,
        /**
         * Cleared, because it is Zoho's opinion of the department and it no longer matches ours. Leaving
         * it would have three columns disagreeing about one fact.
         *
         * NOTE the limitation this does NOT remove: for a row the Zoho People sync still owns
         * (`source = 'zoho_people'`), the next sync re-asserts Zoho's department and overwrites this
         * move, because Zoho remains authoritative for department assignment until HR finishes migrating
         * off it. A canvas move is durable for `source = 'manual'` rows and is a stopgap for synced ones.
         */
        departmentZohoId: null,
        ...(detachManager ? { reportingToEmployeeId: null, reportingTo: null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.id, id)))
      .returning(EMPLOYEE_COLUMNS);
    return firstOrUndefined(rows);
  },


  /**
   * Persist a dragged canvas position. Like the department equivalent, it deliberately leaves
   * `updated_at` alone: nudging a node is a layout preference, not an edit to the person's record, and
   * bumping the timestamp would make "last changed" useless for spotting real HR changes.
   */
  async setCanvasPosition(
    ctx: TenantContext,
    id: string,
    pos: { x: number; y: number } | null,
  ): Promise<boolean> {
    const rows = await db
      .update(hrEmployees)
      .set({
        canvasX: pos ? Math.round(pos.x) : null,
        canvasY: pos ? Math.round(pos.y) : null,
      })
      .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.id, id)))
      .returning({ id: hrEmployees.id });
    return rows.length > 0;
  },

  /**
   * Point the employee at a re-hosted avatar in `file_assets` (or clear it).
   *
   * Deliberately NOT part of `ManualEmployeeInput`. The generic PATCH body is admin-supplied JSON, so
   * carrying `photoFileId` there would let any admin aim an employee row at an arbitrary file id —
   * including one belonging to another department, whose bytes the photo-link route would then happily
   * presign for every HR user. The only writer is the upload route, which stores the bytes itself and
   * therefore knows the id is one it just created.
   */
  async setPhotoFileId(
    ctx: TenantContext,
    id: string,
    photoFileId: string | null,
  ): Promise<HrEmployeeRow | undefined> {
    const rows = await db
      .update(hrEmployees)
      .set({ photoFileId, updatedAt: new Date() })
      .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.id, id)))
      .returning(EMPLOYEE_COLUMNS);
    return firstOrUndefined(rows);
  },

  async delete(ctx: TenantContext, id: string): Promise<boolean> {
    const rows = await db
      .delete(hrEmployees)
      .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.id, id)))
      .returning({ id: hrEmployees.id });
    return rows.length > 0;
  },
};

/**
 * Each partial unique index means something different, so each gets its own message rather than one
 * generic 409 that leaves the admin guessing which field is taken.
 */
const UNIQUE_VIOLATION_MESSAGES: Record<string, string> = {
  hr_employees_tenant_employee_id_uk: 'That Employee ID is already used by another employee',
  hr_employees_tenant_zoho_uk: 'That Zoho People record is already linked to another employee',
  hr_employees_tenant_zoho_user_uk: 'That Mytrion login is already linked to another employee',
};

/**
 * A raw SQLSTATE 23505 is not an AppError, so errorHandler swaps its message for "Internal server
 * error" — an admin who typed an Employee ID that already exists was told the server broke rather than
 * which field is at fault, and retrying reproduced it forever. Unrecognized errors pass through.
 */
function employeeWriteConflict(err: unknown): unknown {
  if (!isUniqueViolation(err)) return err;
  const constraint = (err as { constraint?: unknown }).constraint;
  const message =
    typeof constraint === 'string' ? UNIQUE_VIOLATION_MESSAGES[constraint] : undefined;
  return message ? new ValidationError(message, { cause: err }) : err;
}

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
