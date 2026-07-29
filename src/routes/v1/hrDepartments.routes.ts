/**
 * Mytrion HR — departments REST (`hr_departments` own DB).
 * Reads: a worker holding the `hr` department. Writes + Zoho migrate sync: Mytrion Admin.
 */
import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { NotFoundError, RBACError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  normalizeDepartmentIcon,
  normalizeDepartmentTone,
} from '../../modules/hr/departmentAppearance.js';
import { syncHrDepartmentsFromZoho } from '../../modules/hr/hrDepartmentSync.js';
import { departmentWouldCycle } from '../../modules/hr/orgReparent.js';
import { hrDepartmentRepo, type HrDepartmentRow } from '../../repos/hrDepartmentRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

/**
 * READ access — requires the `hr` department grant, matching `hr.routes.ts`.
 *
 * This used to check only `audience === 'internal'`, which is not a gate: every signed-in worker could
 * read the whole department table, including each department's lead name and lead EMAIL. Its sibling
 * (the employees route) was tightened to `requireDepartment` for exactly this reason and this half was
 * left behind, so the two ends of the same tab disagreed about who may read it — a caller without the
 * grant already got a 403 on /hr/employees while /hr/departments answered in full.
 */
function requireHrInternal(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'hr', 'HR directory');
}

function requireHrAdmin(request: FastifyRequest): TenantContext {
  const ctx = requireHrInternal(request);
  if (!ctx.allDepartmentAccess && !ctx.bypassRbac && ctx.role !== 'admin') {
    throw new RBACError('Mytrion Admin access required to change departments');
  }
  return ctx;
}

function toDto(row: HrDepartmentRow) {
  return {
    id: row.id,
    zohoRecordId: row.zohoRecordId,
    name: row.name,
    code: row.code,
    mailAlias: row.mailAlias,
    leadName: row.leadName,
    leadZohoId: row.leadZohoId,
    leadEmail: row.leadEmail,
    leadEmployeeId: row.leadEmployeeId,
    parentName: row.parentName,
    parentZohoId: row.parentZohoId,
    parentId: row.parentId,
    description: row.description,
    icon: row.icon,
    iconColor: row.iconColor,
    canvasX: row.canvasX,
    canvasY: row.canvasY,
    source: row.source,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const listQuery = z.object({
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * `icon` / `iconColor` are normalized rather than rejected — an unrecognised glyph must not block
 * saving the department's name and description. See `departmentAppearance.ts` for why shape validation
 * (not an allow-list of every lucide name) is the right boundary here.
 *
 * `description` is markdown, capped rather than sanitized: the client renders it through
 * react-markdown + rehype-sanitize, so raw HTML in the source never becomes live markup. Storing the
 * author's literal text keeps the field round-trippable in the editor.
 */
const writeBody = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(40).nullable().optional(),
  mailAlias: z.string().max(254).nullable().optional(),
  leadName: z.string().max(200).nullable().optional(),
  /** Preferred lead write path — an hr_employees.id; denormalized name/email follow from the row. */
  leadEmployeeId: z.string().max(80).nullable().optional(),
  parentName: z.string().max(200).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  icon: z
    .string()
    .max(60)
    .nullable()
    .optional()
    .transform((v) => normalizeDepartmentIcon(v)),
  iconColor: z
    .string()
    .max(40)
    .nullable()
    .optional()
    .transform((v) => normalizeDepartmentTone(v)),
});

const patchBody = writeBody.partial().extend({
  name: z.string().min(1).max(200).optional(),
});

export async function hrDepartmentsRoutes(app: FastifyInstance): Promise<void> {
  const auth: RouteShorthandOptions = { onRequest: [app.authenticate] };

  app.get('/hr/departments', auth, async (request) => {
    const ctx = requireHrInternal(request);
    const q = listQuery.parse(request.query);
    const filters = {
      ...(q.q !== undefined ? { q: q.q } : {}),
    };
    const page = {
      ...filters,
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.offset !== undefined ? { offset: q.offset } : {}),
    };
    const [items, total] = await Promise.all([
      hrDepartmentRepo.list(ctx, page),
      hrDepartmentRepo.count(ctx, filters),
    ]);
    return { items: items.map(toDto), total };
  });

  app.post('/hr/departments', auth, async (request) => {
    const ctx = requireHrAdmin(request);
    const body = writeBody.parse(request.body);
    const row = await hrDepartmentRepo.createManual(ctx, {
      name: body.name,
      ...(body.code !== undefined ? { code: body.code } : {}),
      ...(body.mailAlias !== undefined ? { mailAlias: body.mailAlias } : {}),
      ...(body.leadName !== undefined ? { leadName: body.leadName } : {}),
      ...(body.leadEmployeeId !== undefined ? { leadEmployeeId: body.leadEmployeeId } : {}),
      ...(body.parentName !== undefined ? { parentName: body.parentName } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.icon !== undefined ? { icon: body.icon } : {}),
      ...(body.iconColor !== undefined ? { iconColor: body.iconColor } : {}),
    });
    await auditFromContext(ctx, {
      action: 'hr.department.create',
      status: 'ok',
      resourceType: 'hr_department',
      resourceId: row.id,
      detail: { source: 'manual', name: row.name },
    });
    return toDto(row);
  });

  /** One-shot / re-run migrate from Zoho People `department` form. Admin only. */
  app.post('/hr/departments/sync', auth, async (request) => {
    const ctx = requireHrAdmin(request);
    const body = z
      .object({ maxPages: z.number().int().min(1).max(500).optional() })
      .parse(request.body ?? {});
    const result = await syncHrDepartmentsFromZoho(ctx, {
      ...(body.maxPages !== undefined ? { maxPages: body.maxPages } : {}),
    });
    await auditFromContext(ctx, {
      action: 'hr.department.sync',
      status: 'ok',
      resourceType: 'hr_department',
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

  app.get<{ Params: { id: string } }>('/hr/departments/:id', auth, async (request) => {
    const ctx = requireHrInternal(request);
    const row = await hrDepartmentRepo.getById(ctx, request.params.id);
    if (!row) throw new NotFoundError('Department not found');
    return toDto(row);
  });

  app.patch<{ Params: { id: string } }>('/hr/departments/:id', auth, async (request) => {
    const ctx = requireHrAdmin(request);
    const body = patchBody.parse(request.body);
    const patch = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.code !== undefined ? { code: body.code } : {}),
      ...(body.mailAlias !== undefined ? { mailAlias: body.mailAlias } : {}),
      ...(body.leadName !== undefined ? { leadName: body.leadName } : {}),
      ...(body.leadEmployeeId !== undefined ? { leadEmployeeId: body.leadEmployeeId } : {}),
      ...(body.parentName !== undefined ? { parentName: body.parentName } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.icon !== undefined ? { icon: body.icon } : {}),
      ...(body.iconColor !== undefined ? { iconColor: body.iconColor } : {}),
    };
    /**
     * A parent change here needs the SAME cycle guard as the canvas.
     *
     * `parentName` on this route resolves to a parent_id, so saving the form could put a department
     * inside its own sub-department — which /hr/org/reparent refuses. The result is a ring with no root,
     * and the org canvas then drops that whole branch, which reads as losing departments.
     */
    if (patch.parentName) {
      const parent = await hrDepartmentRepo.findByName(ctx, patch.parentName);
      if (parent && (await departmentWouldCycle(ctx, request.params.id, parent.id))) {
        throw new ValidationError(
          'That would put the department inside one of its own sub-departments',
        );
      }
    }
    const row = await hrDepartmentRepo.update(ctx, request.params.id, patch);
    if (!row) throw new NotFoundError('Department not found');
    await auditFromContext(ctx, {
      action: 'hr.department.update',
      status: 'ok',
      resourceType: 'hr_department',
      resourceId: row.id,
      detail: { keys: Object.keys(patch) },
    });
    return toDto(row);
  });

  app.delete<{ Params: { id: string } }>('/hr/departments/:id', auth, async (request) => {
    const ctx = requireHrAdmin(request);
    const ok = await hrDepartmentRepo.delete(ctx, request.params.id);
    if (!ok) throw new NotFoundError('Department not found');
    await auditFromContext(ctx, {
      action: 'hr.department.delete',
      status: 'ok',
      resourceType: 'hr_department',
      resourceId: request.params.id,
      detail: {},
    });
    return { ok: true };
  });
}
