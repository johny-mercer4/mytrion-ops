/**
 * Mytrion HR — departments REST (`hr_departments` own DB).
 * Reads: any authenticated internal worker. Writes + Zoho migrate sync: Mytrion Admin.
 */
import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { NotFoundError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { syncHrDepartmentsFromZoho } from '../../modules/hr/hrDepartmentSync.js';
import { hrDepartmentRepo } from '../../repos/hrDepartmentRepo.js';
import type { HrDepartment } from '../../db/schema/hr_departments.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext } from './helpers.js';

function requireHrInternal(request: FastifyRequest): TenantContext {
  const ctx = requireContext(request);
  if (ctx.audience !== 'internal') {
    throw new RBACError('HR directory is internal-only');
  }
  return ctx;
}

function requireHrAdmin(request: FastifyRequest): TenantContext {
  const ctx = requireHrInternal(request);
  if (!ctx.allDepartmentAccess && !ctx.bypassRbac && ctx.role !== 'admin') {
    throw new RBACError('Mytrion Admin access required to change departments');
  }
  return ctx;
}

function toDto(row: HrDepartment) {
  return {
    id: row.id,
    zohoRecordId: row.zohoRecordId,
    name: row.name,
    code: row.code,
    mailAlias: row.mailAlias,
    leadName: row.leadName,
    leadZohoId: row.leadZohoId,
    leadEmail: row.leadEmail,
    parentName: row.parentName,
    parentZohoId: row.parentZohoId,
    parentId: row.parentId,
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

const writeBody = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(40).nullable().optional(),
  mailAlias: z.string().max(254).nullable().optional(),
  leadName: z.string().max(200).nullable().optional(),
  parentName: z.string().max(200).nullable().optional(),
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
      ...(body.parentName !== undefined ? { parentName: body.parentName } : {}),
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
      ...(body.parentName !== undefined ? { parentName: body.parentName } : {}),
    };
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
