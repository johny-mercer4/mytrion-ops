/**
 * Comms routing administration (/v1/comms/admin) — the Mytrion Admin surface that decides WHO an
 * escalation goes to at each level, and who works each ticket queue.
 *
 * Everything the escalation ladder needs is a row an admin edits here, not a constant in code:
 *   level 2  the reason's fall-to user   → `mytrion_ticket_types.default_assignee_zoho_user_id`
 *   level 3  the department manager      → `mytrion_department_config.manager_zoho_user_id`
 *   level 4  C-Level                     → the `c-level` pool in `mytrion_department_agents`
 *
 * All of them ship NULL/empty on purpose. A NULL is "unrouted, refuse loudly" — never a wildcard — so
 * raising an escalation on an unconfigured reason is refused with a message naming this screen, rather
 * than landing in nobody's inbox.
 *
 * HR is the CANDIDATE SOURCE only: `GET /candidates` suggests people (and `hr_departments.lead_employee_id`
 * pre-selects a likely manager), but the row written here is what routes. That split matters because
 * `hr_employees.zoho_user_id` is nullable and heuristic, and a NULL there must never act as a wildcard.
 *
 * Admin-gated (all-department) and every write is audited: this is the file that can silently redirect
 * every escalation in the company.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NotFoundError, RBACError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { C_LEVEL_DEPARTMENT } from '../../modules/comms/escalationRouting.js';
import { commsCatalogRepo } from '../../repos/commsCatalogRepo.js';
import { commsDepartmentRepo } from '../../repos/commsDepartmentRepo.js';
import { hrDepartmentRepo } from '../../repos/hrDepartmentRepo.js';
import { hrEmployeeRepo } from '../../repos/hrEmployeeRepo.js';
import { KNOWN_DEPARTMENTS } from '../../lib/department.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext } from './helpers.js';

/** Zoho user ids are numeric strings. Enforced here so a typo cannot be stored as a routing target. */
const zohoUserId = z.string().regex(/^\d+$/, 'must be a Zoho user id').max(60);
/** Department slugs must match the WS queue-topic grammar, or a queue publishes where nobody can listen. */
const departmentSlug = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z][a-z0-9-]*$/, 'lowercase slug (letters, digits, dashes)');

const configPatchBody = z.object({
  /** ESCALATION LEVEL 3. Explicit null clears it. */
  managerZohoUserId: zohoUserId.nullable().optional(),
  managerName: z.string().max(200).nullable().optional(),
  /** Level-2 landing for a sideways hand-off INTO this department. */
  defaultAssigneeZohoUserId: zohoUserId.nullable().optional(),
  ticketAssignmentStrategy: z.enum(['round_robin', 'least_open', 'manual']).optional(),
  requireOnline: z.boolean().optional(),
  acceptsTickets: z.boolean().optional(),
  acceptsEscalations: z.boolean().optional(),
  slaHoursOverride: z.number().int().min(1).max(2160).nullable().optional(),
});

const poolMemberBody = z.object({
  zohoUserId,
  displayName: z.string().max(200).nullable().optional(),
  /** 'CEO' | 'COO' | 'Team Lead' … Load-bearing in the c-level pool, where the picker names the seat. */
  roleTitle: z.string().max(80).nullable().optional(),
  active: z.boolean().optional(),
  acceptsNew: z.boolean().optional(),
  maxOpen: z.number().int().min(1).max(500).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const poolPatchBody = poolMemberBody.omit({ zohoUserId: true });

const reasonPatchBody = z.object({
  /** ESCALATION LEVEL 2 — the user this reason falls to. Explicit null unroutes it again. */
  defaultAssigneeZohoUserId: zohoUserId.nullable().optional(),
  label: z.string().min(1).max(200).optional(),
  defaultPriority: z.enum(['low', 'medium', 'high', 'critical']).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const candidatesQuery = z.object({
  q: z.string().max(120).optional(),
  /** Only people HR places in this department — the natural default for a department's picker. */
  department: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/**
 * All-department admin. Deliberately stricter than `requireDepartment(…, 'management', …)`: a row here
 * redirects every escalation in the company, so holding one department is not enough.
 */
function requireCommsAdmin(request: FastifyRequest): TenantContext {
  const ctx = requireContext(request);
  if (ctx.audience !== 'internal') throw new RBACError('Comms administration is internal-only');
  if (!ctx.allDepartmentAccess && ctx.role !== 'admin' && ctx.bypassRbac !== true) {
    throw new RBACError('Comms routing administration requires admin (all-department) access.');
  }
  return ctx;
}

export async function commsAdminRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /**
   * The whole routing picture in one request: every department's config, the pools, and each escalation
   * reason with its level-2 fall-to user.
   *
   * One request because the screen is one screen — and because `unroutedReasons` / `departmentsMissingManager`
   * are the numbers an admin actually opens it for, and they cannot be computed from a partial view.
   */
  app.get('/comms/admin/routing', guard, async (request) => {
    const ctx = requireCommsAdmin(request);
    const [configs, pool, reasons] = await Promise.all([
      commsDepartmentRepo.list(ctx),
      commsDepartmentRepo.listPool(ctx),
      // activeOnly:false — an admin must be able to see and re-activate a retired reason.
      commsCatalogRepo.list(ctx, { kind: 'escalation_reason', activeOnly: false }),
    ]);

    const byDepartment = new Map<string, typeof pool>();
    for (const seat of pool) {
      const list = byDepartment.get(seat.department) ?? [];
      list.push(seat);
      byDepartment.set(seat.department, list);
    }

    // Unlike the picker DTO, the admin view DOES expose the configured ids — that is the whole point of
    // the screen. It is why this route is all-department-admin gated.
    const departments = configs.map((c) => ({
      department: c.department,
      managerZohoUserId: c.managerZohoUserId,
      managerName: c.managerName,
      defaultAssigneeZohoUserId: c.defaultAssigneeZohoUserId,
      ticketAssignmentStrategy: c.ticketAssignmentStrategy,
      requireOnline: c.requireOnline,
      acceptsTickets: c.acceptsTickets,
      acceptsEscalations: c.acceptsEscalations,
      slaHoursOverride: c.slaHoursOverride,
      pool: (byDepartment.get(c.department) ?? []).map((p) => ({
        zohoUserId: p.zohoUserId,
        displayName: p.displayName,
        roleTitle: p.roleTitle,
        active: p.active,
        acceptsNew: p.acceptsNew,
        maxOpen: p.maxOpen,
        sortOrder: p.sortOrder,
        lastAssignedAt: p.lastAssignedAt?.toISOString() ?? null,
        assignedCount: p.assignedCount,
      })),
    }));

    const escalationReasons = reasons.map((r) => ({
      code: r.code,
      label: r.label,
      defaultAssigneeZohoUserId: r.defaultAssigneeZohoUserId,
      defaultPriority: r.defaultPriority,
      active: r.active,
      sortOrder: r.sortOrder,
      routed: (r.defaultAssigneeZohoUserId ?? '').length > 0,
    }));

    return {
      departments,
      escalationReasons,
      /** Level 4. Empty means "escalate to C-Level" is unavailable — the ladder stops at the manager. */
      cLevel: departments.find((d) => d.department === C_LEVEL_DEPARTMENT)?.pool ?? [],
      /** The gaps, computed server-side so the screen and the refusal messages agree. */
      readiness: {
        unroutedReasons: escalationReasons.filter((r) => r.active && !r.routed).map((r) => r.code),
        departmentsMissingManager: departments
          .filter((d) => d.acceptsEscalations && !d.managerZohoUserId)
          .map((d) => d.department),
        cLevelConfigured:
          (departments.find((d) => d.department === C_LEVEL_DEPARTMENT)?.pool ?? []).filter(
            (p) => p.active,
          ).length > 0,
      },
      /** Slugs the UI may offer for a new department row. Reference, not an allowlist the server enforces. */
      knownDepartments: KNOWN_DEPARTMENTS,
    };
  });

  /**
   * People an admin can pick, from the HR directory.
   *
   * Only employees with a `zoho_user_id` are returned: that id IS the routing key, and offering someone
   * without one would let an admin save a row that can never receive anything. `leadOfDepartments` marks
   * whoever HR has as a department lead, so the manager picker can pre-select the likely answer — a
   * suggestion the admin confirms, never a silent default.
   */
  app.get('/comms/admin/candidates', guard, async (request) => {
    const ctx = requireCommsAdmin(request);
    const q = candidatesQuery.parse(request.query);
    const employees = await hrEmployeeRepo.listAllForMapping(ctx);

    const term = q.q?.trim().toLowerCase();
    const wantedDept = q.department?.trim().toLowerCase();
    const limit = q.limit ?? 200;

    const rows = employees.filter((e) => {
      if (!e.zohoUserId || e.zohoUserId.trim().length === 0) return false;
      if (wantedDept && (e.department ?? '').trim().toLowerCase() !== wantedDept) return false;
      if (!term) return true;
      const haystack = [e.firstName, e.lastName, e.email, e.designation, e.department]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });

    // Resolved per candidate rather than per request so an employee who leads two departments shows both.
    const leadIds = new Map<string, string[]>();
    await Promise.all(
      rows.slice(0, limit).map(async (e) => {
        const led = await hrDepartmentRepo.listIdsLedBy(ctx, e.id).catch(() => [] as string[]);
        if (led.length > 0) leadIds.set(e.id, led);
      }),
    );

    return {
      candidates: rows.slice(0, limit).map((e) => ({
        zohoUserId: e.zohoUserId,
        name: [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || e.email || e.zohoUserId,
        email: e.email,
        designation: e.designation,
        department: e.department,
        status: e.status,
        /** HR thinks this person leads these departments — a suggestion for the manager picker. */
        leadOfDepartments: leadIds.get(e.id) ?? [],
      })),
      total: rows.length,
      truncated: rows.length > limit,
    };
  });

  /** Set a department's manager (level 3), default escalation assignee, strategy and accept flags. */
  app.patch('/comms/admin/departments/:department', guard, async (request) => {
    const ctx = requireCommsAdmin(request);
    const department = departmentSlug.parse((request.params as { department: string }).department);
    const body = configPatchBody.parse(request.body);
    if (Object.keys(body).length === 0) throw new ValidationError('Nothing to update.');

    const before = await commsDepartmentRepo.get(ctx, department);
    const after = await commsDepartmentRepo.upsertConfig(ctx, department, body);

    await auditFromContext(ctx, {
      action: 'comms.admin.department.update',
      status: 'ok',
      resourceType: 'comms_department_config',
      resourceId: department,
      // Before AND after: "who pointed every Billing escalation at this person, and what was it before?"
      // is the question this row exists to answer.
      detail: {
        changed: Object.keys(body),
        before: before
          ? {
              managerZohoUserId: before.managerZohoUserId,
              defaultAssigneeZohoUserId: before.defaultAssigneeZohoUserId,
              acceptsEscalations: before.acceptsEscalations,
            }
          : null,
        after: {
          managerZohoUserId: after.managerZohoUserId,
          defaultAssigneeZohoUserId: after.defaultAssigneeZohoUserId,
          acceptsEscalations: after.acceptsEscalations,
        },
      },
    });
    return { department: after.department, config: after };
  });

  /**
   * Add or update a seat in a department's pool — including the `c-level` pool, which IS escalation
   * level 4. `roleTitle` is what makes "Escalate to CEO" distinguishable from "Escalate to COO".
   */
  app.put('/comms/admin/departments/:department/pool', guard, async (request) => {
    const ctx = requireCommsAdmin(request);
    const department = departmentSlug.parse((request.params as { department: string }).department);
    const body = poolMemberBody.parse(request.body);

    const seat = await commsDepartmentRepo.upsertPoolMember(ctx, {
      department,
      ...body,
      addedByZohoUserId: ctx.userId.startsWith('zoho:') ? ctx.userId.slice('zoho:'.length) : null,
    });

    await auditFromContext(ctx, {
      action: 'comms.admin.pool.upsert',
      status: 'ok',
      resourceType: 'comms_department_agent',
      resourceId: `${department}:${body.zohoUserId}`,
      detail: { department, zohoUserId: body.zohoUserId, roleTitle: seat.roleTitle, active: seat.active },
    });
    return { seat };
  });

  app.patch('/comms/admin/departments/:department/pool/:zohoUserId', guard, async (request) => {
    const ctx = requireCommsAdmin(request);
    const params = request.params as { department: string; zohoUserId: string };
    const department = departmentSlug.parse(params.department);
    const target = zohoUserId.parse(params.zohoUserId);
    const body = poolPatchBody.parse(request.body);
    if (Object.keys(body).length === 0) throw new ValidationError('Nothing to update.');

    const seat = await commsDepartmentRepo.updatePoolMember(ctx, department, target, body);
    if (!seat) throw new NotFoundError('That person is not in this pool.');

    await auditFromContext(ctx, {
      action: 'comms.admin.pool.update',
      status: 'ok',
      resourceType: 'comms_department_agent',
      resourceId: `${department}:${target}`,
      detail: { department, zohoUserId: target, changed: Object.keys(body) },
    });
    return { seat };
  });

  /**
   * Remove a seat outright.
   *
   * Distinct from `active: false`, which keeps the rotation history and is what you want for someone on
   * leave. Escalations already in flight are unaffected either way: each hop snapshots its assignee.
   */
  app.delete('/comms/admin/departments/:department/pool/:zohoUserId', guard, async (request) => {
    const ctx = requireCommsAdmin(request);
    const params = request.params as { department: string; zohoUserId: string };
    const department = departmentSlug.parse(params.department);
    const target = zohoUserId.parse(params.zohoUserId);

    const removed = await commsDepartmentRepo.removePoolMember(ctx, department, target);
    if (!removed) throw new NotFoundError('That person is not in this pool.');

    await auditFromContext(ctx, {
      action: 'comms.admin.pool.remove',
      status: 'ok',
      resourceType: 'comms_department_agent',
      resourceId: `${department}:${target}`,
      detail: { department, zohoUserId: target },
    });
    return { removed: true, department, zohoUserId: target };
  });

  /**
   * Set an escalation reason's level-2 fall-to user.
   *
   * This is the single most consequential edit on the screen: it decides where every future escalation on
   * that reason lands. Refuses a code that is not an escalation reason, so a ticket type cannot be given a
   * fall-to user that nothing would ever read.
   */
  app.patch('/comms/admin/escalation-reasons/:code', guard, async (request) => {
    const ctx = requireCommsAdmin(request);
    const code = z.string().min(1).max(60).parse((request.params as { code: string }).code);
    const body = reasonPatchBody.parse(request.body);
    if (Object.keys(body).length === 0) throw new ValidationError('Nothing to update.');

    const before = await commsCatalogRepo.byCode(ctx, code);
    if (!before) throw new NotFoundError(`Unknown code '${code}'.`);
    if (before.kind !== 'escalation_reason') {
      throw new ValidationError(
        `'${code}' is a ticket type, not an escalation reason. Use the ticket-type screen.`,
      );
    }

    const after = await commsCatalogRepo.updateByCode(ctx, code, body);
    if (!after) throw new NotFoundError(`Unknown code '${code}'.`);

    await auditFromContext(ctx, {
      action: 'comms.admin.escalation_reason.update',
      status: 'ok',
      resourceType: 'comms_ticket_type',
      resourceId: code,
      detail: {
        changed: Object.keys(body),
        beforeAssignee: before.defaultAssigneeZohoUserId,
        afterAssignee: after.defaultAssigneeZohoUserId,
      },
    });
    return {
      reason: {
        code: after.code,
        label: after.label,
        defaultAssigneeZohoUserId: after.defaultAssigneeZohoUserId,
        defaultPriority: after.defaultPriority,
        active: after.active,
        sortOrder: after.sortOrder,
        routed: (after.defaultAssigneeZohoUserId ?? '').length > 0,
      },
    };
  });
}
