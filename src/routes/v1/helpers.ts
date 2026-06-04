import type { FastifyRequest } from 'fastify';
import { AuthError } from '../../lib/errors.js';
import type { TenantContext } from '../../types/tenantContext.js';

/** Narrow request.ctx to non-null after the `authenticate` guard has run. */
export function requireContext(request: FastifyRequest): TenantContext {
  if (!request.ctx) throw new AuthError('Authentication required');
  return request.ctx;
}

/** Caller-supplied department access, accepted in a request body. */
export interface DepartmentAccessBody {
  departmentAccess?: string[] | undefined;
  allDepartments?: boolean | undefined;
}

/**
 * Merge the caller's department-access param into the context so RAG retrieval + tool
 * gating are scoped. Sources (unioned): existing ctx, `x-department-access` header (CSV),
 * `x-all-departments: true` header, and an optional request body. The caller is trusted to
 * supply the allowed departments ("the param from my end").
 */
export function withDepartmentAccess(
  ctx: TenantContext,
  request: FastifyRequest,
  body?: DepartmentAccessBody,
): TenantContext {
  const headerVal = request.headers['x-department-access'];
  const headerDepts =
    typeof headerVal === 'string'
      ? headerVal.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  const departments = [
    ...new Set([...ctx.departments, ...headerDepts, ...(body?.departmentAccess ?? [])]),
  ];
  const allDepartmentAccess =
    ctx.allDepartmentAccess ||
    request.headers['x-all-departments'] === 'true' ||
    body?.allDepartments === true;
  return { ...ctx, departments, allDepartmentAccess };
}
