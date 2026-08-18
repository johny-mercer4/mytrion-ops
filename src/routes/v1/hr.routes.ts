/**
 * Mytrion HR — employee directory REST.
 *
 * Data lives in `hr_employees` (our DB), not live Zoho People. Sync pulls Zoho → upsert.
 * Reads: any authenticated internal worker. Writes + sync: Mytrion Admin
 * (`allDepartmentAccess` / bypass / role admin) only.
 */
import type { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { zohoCrm } from '../../integrations/zohoCrm.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { syncHrEmployeesFromZoho } from '../../modules/hr/hrEmployeeSync.js';
import { buildHrOrgStructure } from '../../modules/hr/hrOrgStructure.js';
import { departmentWouldCycle, employeeWouldCycle } from '../../modules/hr/orgReparent.js';
import { hrDepartmentRepo } from '../../repos/hrDepartmentRepo.js';
import { hrAttendancePunchRepo } from '../../repos/hrAttendancePunchRepo.js';
import { hrEmployeeRepo, type HrEmployeeRow } from '../../repos/hrEmployeeRepo.js';
// Guards + DTO are shared with hrPeople.routes.ts — see hrAccess.ts for why they are not duplicated.
import { hrEmployeeDto as toDto, requireHrAdmin, requireHrManage, requireHrRead } from './hrAccess.js';

const listQuery = z.object({
  q: z.string().max(200).optional(),
  status: z.string().max(80).optional(),
  department: z.string().max(200).optional(),
  departmentId: z.string().max(80).optional(),
  designation: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const writeBody = z.object({
  employeeId: z.string().max(80).nullable().optional(),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  email: z.string().max(254).nullable().optional(),
  departmentId: z.string().max(80).nullable().optional(),
  department: z.string().max(200).nullable().optional(),
  designation: z.string().max(200).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  status: z.string().max(80).optional(),
  role: z.string().max(200).nullable().optional(),
  dateOfJoining: z.string().max(40).nullable().optional(),
  mobile: z.string().max(40).nullable().optional(),
  /** Zoho People `Face_ID` — biometric / access id. Text, not integer (zero-padded values). */
  faceId: z.string().max(80).nullable().optional(),
  /**
   * Telegram handle. Stored BARE — a leading '@' and any t.me/ prefix are stripped on write so the
   * column holds one canonical form and the UI owns the presentation.
   */
  telegramUsername: z
    .string()
    .max(64)
    .nullable()
    .optional()
    .transform((v) => (v == null ? v : v.trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@+/, '') || null)),
  reportingTo: z.string().max(200).nullable().optional(),
  /**
   * The manager as an id. Set this rather than `reportingTo` where a picker is available — the repo
   * resolves the display name from the row, so the two columns cannot drift apart.
   */
  reportingToEmployeeId: z.string().max(80).nullable().optional(),
});

const patchBody = writeBody.partial().extend({
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
});

/** Which of the two node levels an org-canvas write is addressing. */
const orgNodeKind = z.enum(['department', 'employee']);

/**
 * Canvas coordinates are bounded, not free-form. A finite range keeps a bad client (or a fuzzed
 * request) from parking a node at 1e12 where the viewport can never reach it again, and integers keep
 * the stored layout stable — subpixel drift on every drag would rewrite rows that did not move.
 */
const orgPositionBody = z.object({
  kind: orgNodeKind,
  id: z.string().min(1).max(80),
  position: z
    .object({
      x: z.number().finite().min(-100_000).max(100_000),
      y: z.number().finite().min(-100_000).max(100_000),
    })
    .nullable(),
});

const orgReparentBody = z.object({
  kind: orgNodeKind,
  id: z.string().min(1).max(80),
  /** null detaches — a root department, or an unassigned/unmanaged person. */
  parentId: z.string().min(1).max(80).nullable(),
  /** What the node was dropped ON; an employee can land on either level. */
  parentKind: orgNodeKind,
});

export async function hrRoutes(app: FastifyInstance): Promise<void> {
  const auth: RouteShorthandOptions = { onRequest: [app.authenticate] };

  /** Designation picklist — distinct values from hr_employees (not a separate table). */
  app.get('/hr/meta/designations', auth, async (request) => {
    const ctx = requireHrRead(request);
    const designations = await hrEmployeeRepo.listDesignationPicklist(ctx);
    return { designations };
  });

  /**
   * Org graph: departments (parent_id) + people (reporting_to_employee_id) + headcounts, in one
   * round trip. Flat lists — see `hrOrgStructure.ts` for why it is not a nested tree.
   */
  app.get('/hr/org-structure', auth, async (request) => {
    const ctx = requireHrRead(request);
    return buildHrOrgStructure(ctx);
  });

  /**
   * Persist a node's dragged canvas position. Admin-only like every other write, and a `position` of
   * null hands the node back to the auto-layout.
   *
   * A bare 200 rather than the whole row: the client already knows where it dropped the node, and the
   * canvas fires one of these per drag — echoing a full record back would be pure payload.
   */
  app.patch('/hr/org/position', auth, async (request) => {
    const ctx = requireHrManage(request);
    const body = orgPositionBody.parse(request.body);
    const pos = body.position ? { x: body.position.x, y: body.position.y } : null;
    const ok =
      body.kind === 'department'
        ? await hrDepartmentRepo.setCanvasPosition(ctx, body.id, pos)
        : await hrEmployeeRepo.setCanvasPosition(ctx, body.id, pos);
    if (!ok) throw new NotFoundError('Org node not found');
    // Deliberately NOT audit-logged. A drag is a layout preference, not a change to the record, and
    // one audit row per nudge would bury the edits that matter.
    return { ok: true };
  });

  /**
   * Re-parent a node — what dropping one node onto another, or drawing an edge, means:
   *
   *   department → department   moves the sub-department (parent_id)
   *   employee   → department   moves the person into that department (department_id)
   *   employee   → employee     makes the target their manager (reporting_to_employee_id)
   *
   * A null `parentId` detaches: a department becomes a root, a person becomes unassigned/unmanaged.
   *
   * CYCLES ARE REJECTED, not tolerated. Dropping a department onto its own descendant would create a
   * ring with no root, and the layout would then either loop forever or silently drop the whole branch
   * off the canvas — so the walk up from the proposed parent has to prove it never reaches the node
   * being moved. The same applies to reporting lines.
   */
  app.patch('/hr/org/reparent', auth, async (request) => {
    const ctx = requireHrManage(request);
    const body = orgReparentBody.parse(request.body);

    if (body.parentId && body.parentId === body.id) {
      throw new ValidationError('A node cannot be its own parent');
    }

    if (body.kind === 'department') {
      if (body.parentKind !== 'department') {
        throw new ValidationError('A department can only sit under another department');
      }
      if (body.parentId && (await departmentWouldCycle(ctx, body.id, body.parentId))) {
        throw new ValidationError('That would put the department inside one of its own sub-departments');
      }
      const row = await hrDepartmentRepo.setParent(ctx, body.id, body.parentId);
      if (!row) throw new NotFoundError('Department or parent not found');
      await auditFromContext(ctx, {
        action: 'hr.org.reparent',
        status: 'ok',
        resourceType: 'hr_department',
        resourceId: row.id,
        detail: { parentId: body.parentId },
      });
      return { ok: true };
    }

    // An employee: under a department (department_id) or under a manager (reporting_to_employee_id).
    if (body.parentKind === 'department') {
      // `true` detaches the manager: the person was dropped onto the department itself, which is what
      // "reports to the department, not to a person" means on the canvas.
      const row = await hrEmployeeRepo.setDepartment(ctx, body.id, body.parentId, true);
      if (!row) throw new NotFoundError('Employee or department not found');
      await auditFromContext(ctx, {
        action: 'hr.org.reparent',
        status: 'ok',
        resourceType: 'hr_employee',
        resourceId: row.id,
        detail: { departmentId: body.parentId },
      });
      return { ok: true };
    }

    if (body.parentId && (await employeeWouldCycle(ctx, body.id, body.parentId))) {
      throw new ValidationError('That would make the reporting line report to itself');
    }
    const row = await hrEmployeeRepo.setManager(ctx, body.id, body.parentId);
    if (!row) throw new NotFoundError('Employee or manager not found');
    await auditFromContext(ctx, {
      action: 'hr.org.reparent',
      status: 'ok',
      resourceType: 'hr_employee',
      resourceId: row.id,
      detail: { reportingToEmployeeId: body.parentId },
    });
    return { ok: true };
  });

  /**
   * The signed-in worker's own employee row (when linked via `zoho_user_id`).
   * Read-only — used by the profile panel. Missing link → 404 (UI shows session fields only).
   */
  app.get('/hr/me', auth, async (request) => {
    const ctx = requireHrRead(request);
    const zohoUserId = ctx.userId.startsWith('zoho:')
      ? ctx.userId.replace(/^zoho:/, '')
      : '';
    if (!zohoUserId) throw new NotFoundError('No employee record linked to this sign-in');
    const row = await hrEmployeeRepo.findByZohoUserId(ctx, zohoUserId);
    if (!row) throw new NotFoundError('No employee record linked to this sign-in');
    return toDto(row);
  });

  app.get('/hr/employees', auth, async (request) => {
    const ctx = requireHrRead(request);
    const q = listQuery.parse(request.query);
    const filters = {
      ...(q.q !== undefined ? { q: q.q } : {}),
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.department !== undefined ? { department: q.department } : {}),
      ...(q.departmentId !== undefined ? { departmentId: q.departmentId } : {}),
      // Was parsed and validated here and then never passed on, so ?designation=… silently returned the
      // unfiltered list. The repo has supported it all along.
      ...(q.designation !== undefined ? { designation: q.designation } : {}),
    };
    const page = {
      ...filters,
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.offset !== undefined ? { offset: q.offset } : {}),
    };
    const [items, total] = await Promise.all([
      hrEmployeeRepo.list(ctx, page),
      hrEmployeeRepo.count(ctx, filters),
    ]);
    return { items: items.map(toDto), total };
  });

  app.post('/hr/employees', auth, async (request) => {
    const ctx = requireHrManage(request);
    const body = writeBody.parse(request.body);
    const row = await hrEmployeeRepo.createManual(ctx, {
      firstName: body.firstName,
      lastName: body.lastName,
      ...(body.employeeId !== undefined ? { employeeId: body.employeeId } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.departmentId !== undefined ? { departmentId: body.departmentId } : {}),
      ...(body.department !== undefined ? { department: body.department } : {}),
      ...(body.designation !== undefined ? { designation: body.designation } : {}),
      ...(body.location !== undefined ? { location: body.location } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.role !== undefined ? { role: body.role } : {}),
      ...(body.dateOfJoining !== undefined ? { dateOfJoining: body.dateOfJoining } : {}),
      ...(body.mobile !== undefined ? { mobile: body.mobile } : {}),
      ...(body.faceId !== undefined ? { faceId: body.faceId } : {}),
      // Was omitted here (and in the PATCH below), so the Telegram field on the form never reached
      // the repo — the handle appeared to save and did not.
      ...(body.telegramUsername !== undefined ? { telegramUsername: body.telegramUsername } : {}),
      ...(body.reportingTo !== undefined ? { reportingTo: body.reportingTo } : {}),
      ...(body.reportingToEmployeeId !== undefined
        ? { reportingToEmployeeId: body.reportingToEmployeeId }
        : {}),
    });
    if (row.faceId) {
      await hrAttendancePunchRepo.linkUnmappedForEmployee(ctx, row.id, row.faceId);
    }
    await auditFromContext(ctx, {
      action: 'hr.employee.create',
      status: 'ok',
      resourceType: 'hr_employee',
      resourceId: row.id,
      detail: { source: 'manual', employeeId: row.employeeId },
    });
    return toDto(row);
  });

  /** Pull all Zoho People employees and upsert into hr_employees. Admin only. */
  app.post('/hr/employees/sync', auth, async (request) => {
    const ctx = requireHrAdmin(request);
    const body = z
      .object({ maxPages: z.number().int().min(1).max(500).optional() })
      .parse(request.body ?? {});
    const result = await syncHrEmployeesFromZoho(ctx, {
      ...(body.maxPages !== undefined ? { maxPages: body.maxPages } : {}),
    });
    await auditFromContext(ctx, {
      action: 'hr.employee.sync',
      status: 'ok',
      resourceType: 'hr_employee',
      resourceId: ctx.tenantId,
      detail: {
        fetched: result.fetched,
        inserted: result.inserted,
        updated: result.updated,
        errorCount: result.errors.length,
      },
    });
    return result;
  });

  app.get<{ Params: { id: string } }>('/hr/employees/:id', auth, async (request) => {
    const ctx = requireHrRead(request);
    const row = await hrEmployeeRepo.getById(ctx, request.params.id);
    if (!row) throw new NotFoundError('Employee not found');
    return toDto(row);
  });

  /** Active Zoho CRM identities available for a deliberate employee link. */
  app.get('/hr/zoho-users', auth, async (request) => {
    requireHrAdmin(request);
    const users = await zohoCrm.listActiveUsers();
    return {
      items: users.map((user) => ({
        id: user.zohoUserId,
        name: user.name,
        email: user.email,
        profile: user.profile,
        role: user.role,
      })),
    };
  });

  app.patch<{ Params: { id: string } }>(
    '/hr/employees/:id/zoho-user',
    auth,
    async (request) => {
      const ctx = requireHrAdmin(request);
      const body = z.object({ zohoUserId: z.string().max(120).nullable() }).parse(request.body);
      let row: HrEmployeeRow | undefined;
      if (body.zohoUserId) {
        const crmUser = await zohoCrm.getUserById(body.zohoUserId);
        if (!crmUser) throw new NotFoundError('Active Zoho user not found');
        row = await hrEmployeeRepo.setZohoUserLink(
          ctx,
          request.params.id,
          crmUser.zohoUserId,
          'manual',
        );
      } else {
        row = await hrEmployeeRepo.clearZohoUserLink(ctx, request.params.id);
      }
      if (!row) throw new NotFoundError('Employee not found');
      await auditFromContext(ctx, {
        action: body.zohoUserId ? 'hr.employee.zoho_user.link' : 'hr.employee.zoho_user.unlink',
        status: 'ok',
        resourceType: 'hr_employee',
        resourceId: row.id,
        detail: { zohoUserId: body.zohoUserId },
      });
      return toDto(row);
    },
  );

  app.patch<{ Params: { id: string } }>('/hr/employees/:id', auth, async (request) => {
    const ctx = requireHrManage(request);
    const body = patchBody.parse(request.body);
    const patch = {
      ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
      ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
      ...(body.employeeId !== undefined ? { employeeId: body.employeeId } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.departmentId !== undefined ? { departmentId: body.departmentId } : {}),
      ...(body.department !== undefined ? { department: body.department } : {}),
      ...(body.designation !== undefined ? { designation: body.designation } : {}),
      ...(body.location !== undefined ? { location: body.location } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.role !== undefined ? { role: body.role } : {}),
      ...(body.dateOfJoining !== undefined ? { dateOfJoining: body.dateOfJoining } : {}),
      ...(body.mobile !== undefined ? { mobile: body.mobile } : {}),
      ...(body.faceId !== undefined ? { faceId: body.faceId } : {}),
      ...(body.telegramUsername !== undefined ? { telegramUsername: body.telegramUsername } : {}),
      ...(body.reportingTo !== undefined ? { reportingTo: body.reportingTo } : {}),
      ...(body.reportingToEmployeeId !== undefined
        ? { reportingToEmployeeId: body.reportingToEmployeeId }
        : {}),
    };
    /**
     * The SAME cycle guard the canvas uses.
     *
     * It lived only on /hr/org/reparent, but the edit form's "Reporting to" picker writes this column
     * too — so two saves (A reports to B, then B reports to A) built a ring that the canvas endpoint
     * would have refused. A reporting ring has no root, so both people then drop off the org chart
     * entirely with nothing on screen to say why.
     */
    if (
      patch.reportingToEmployeeId &&
      (await employeeWouldCycle(ctx, request.params.id, patch.reportingToEmployeeId))
    ) {
      throw new ValidationError('That reporting line would report to itself');
    }
    const row = await hrEmployeeRepo.update(ctx, request.params.id, patch);
    if (!row) throw new NotFoundError('Employee not found');
    if (body.faceId !== undefined && row.faceId) {
      await hrAttendancePunchRepo.linkUnmappedForEmployee(ctx, row.id, row.faceId);
    }
    await auditFromContext(ctx, {
      action: 'hr.employee.update',
      status: 'ok',
      resourceType: 'hr_employee',
      resourceId: row.id,
      detail: { keys: Object.keys(patch) },
    });
    return toDto(row);
  });

  app.delete<{ Params: { id: string } }>('/hr/employees/:id', auth, async (request) => {
    const ctx = requireHrManage(request);
    const ok = await hrEmployeeRepo.delete(ctx, request.params.id);
    if (!ok) throw new NotFoundError('Employee not found');
    await auditFromContext(ctx, {
      action: 'hr.employee.delete',
      status: 'ok',
      resourceType: 'hr_employee',
      resourceId: request.params.id,
      detail: {},
    });
    return { ok: true };
  });
}
