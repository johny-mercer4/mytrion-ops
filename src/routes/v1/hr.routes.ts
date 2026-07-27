/**
 * Mytrion HR — employee directory REST.
 *
 * Data lives in `hr_employees` (our DB), not live Zoho People. Sync pulls Zoho → upsert.
 * Reads: any authenticated internal worker. Writes + sync: Mytrion Admin
 * (`allDepartmentAccess` / bypass / role admin) only.
 */
import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { NotFoundError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { syncHrEmployeesFromZoho } from '../../modules/hr/hrEmployeeSync.js';
import { buildHrOrgStructure } from '../../modules/hr/hrOrgStructure.js';
import { hrEmployeeRepo } from '../../repos/hrEmployeeRepo.js';
import type { HrEmployee } from '../../db/schema/hr_employees.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext } from './helpers.js';

function requireHrInternal(request: FastifyRequest): TenantContext {
  const ctx = requireContext(request);
  if (ctx.audience !== 'internal') {
    throw new RBACError('HR directory is internal-only');
  }
  return ctx;
}

/** Create / edit / delete / Zoho sync — Mytrion Admin (all-department) only. */
function requireHrAdmin(request: FastifyRequest): TenantContext {
  const ctx = requireHrInternal(request);
  if (!ctx.allDepartmentAccess && !ctx.bypassRbac && ctx.role !== 'admin') {
    throw new RBACError('Mytrion Admin access required to change employees');
  }
  return ctx;
}

function toDto(row: HrEmployee) {
  return {
    id: row.id,
    zohoRecordId: row.zohoRecordId,
    employeeId: row.employeeId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    departmentId: row.departmentId,
    department: row.department,
    departmentZohoId: row.departmentZohoId,
    designation: row.designation,
    location: row.location,
    status: row.status,
    role: row.role,
    dateOfJoining: row.dateOfJoining,
    mobile: row.mobile,
    reportingTo: row.reportingTo,
    reportingToZohoId: row.reportingToZohoId,
    photoUrl: row.photoUrl,
    source: row.source,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const listQuery = z.object({
  q: z.string().max(200).optional(),
  status: z.string().max(80).optional(),
  department: z.string().max(200).optional(),
  departmentId: z.string().max(80).optional(),
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
  reportingTo: z.string().max(200).nullable().optional(),
});

const patchBody = writeBody.partial().extend({
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
});

export async function hrRoutes(app: FastifyInstance): Promise<void> {
  const auth: RouteShorthandOptions = { onRequest: [app.authenticate] };

  /** Designation picklist — distinct values from hr_employees (not a separate table). */
  app.get('/hr/meta/designations', auth, async (request) => {
    const ctx = requireHrInternal(request);
    const designations = await hrEmployeeRepo.listDesignationPicklist(ctx);
    return { designations };
  });

  /** Org tree from hr_departments.parent_id + employee headcounts — no mock nodes. */
  app.get('/hr/org-structure', auth, async (request) => {
    const ctx = requireHrInternal(request);
    return buildHrOrgStructure(ctx);
  });

  app.get('/hr/employees', auth, async (request) => {
    const ctx = requireHrInternal(request);
    const q = listQuery.parse(request.query);
    const filters = {
      ...(q.q !== undefined ? { q: q.q } : {}),
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.department !== undefined ? { department: q.department } : {}),
      ...(q.departmentId !== undefined ? { departmentId: q.departmentId } : {}),
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
    const ctx = requireHrAdmin(request);
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
      ...(body.reportingTo !== undefined ? { reportingTo: body.reportingTo } : {}),
    });
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
    const ctx = requireHrInternal(request);
    const row = await hrEmployeeRepo.getById(ctx, request.params.id);
    if (!row) throw new NotFoundError('Employee not found');
    return toDto(row);
  });

  app.patch<{ Params: { id: string } }>('/hr/employees/:id', auth, async (request) => {
    const ctx = requireHrAdmin(request);
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
      ...(body.reportingTo !== undefined ? { reportingTo: body.reportingTo } : {}),
    };
    const row = await hrEmployeeRepo.update(ctx, request.params.id, patch);
    if (!row) throw new NotFoundError('Employee not found');
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
    const ctx = requireHrAdmin(request);
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
