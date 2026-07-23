import type { FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { normalizeDepartments, type KnownDepartment } from '../../lib/department.js';
import { AuthError, RBACError } from '../../lib/errors.js';
import type { MytrionId } from '../../lib/mytrions.js';
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

/** What the caller ASSERTED via headers/body — trusted only for unverified (API-key) callers. */
function claimedAccess(
  request: FastifyRequest,
  body?: DepartmentAccessBody,
): { departments: string[]; allDepartments: boolean } {
  const headerVal = request.headers['x-department-access'];
  const headerDepts =
    typeof headerVal === 'string'
      ? headerVal.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  return {
    departments: normalizeDepartments([...headerDepts, ...(body?.departmentAccess ?? [])]),
    allDepartments:
      request.headers['x-all-departments'] === 'true' || body?.allDepartments === true,
  };
}

/**
 * Merge department access into the context so RAG retrieval + tool gating are scoped.
 *
 * VERIFIED sessions (Zoho OAuth worker tokens) are session-authoritative: the caller's
 * `x-department-access` / `x-all-departments` headers and body fields are IGNORED —
 * `allDepartmentAccess` and the department grant are DB-resolved in contextFromClaims
 * (mytrionAccessService) and already sit on `ctx`. This closes the header self-elevation path
 * that previously let any authenticated user claim all-department access.
 * FF_SESSION_DEPT_AUTHORITATIVE=0 is the emergency rollback to the legacy header trust.
 *
 * UNVERIFIED callers (static API key / server-to-server) keep the legacy behavior: the
 * caller is trusted to supply the allowed departments ("the param from my end"), unioned
 * from ctx + headers + body.
 */
export function withDepartmentAccess(
  ctx: TenantContext,
  request: FastifyRequest,
  body?: DepartmentAccessBody,
): TenantContext {
  if (env.FF_SESSION_DEPT_AUTHORITATIVE && ctx.sessionVerified) {
    if (ctx.audience === 'customer' || ctx.allDepartmentAccess) return ctx;
    // ctx.departments is the DB-resolved grant (authoritative). Ignore any claimed header/body
    // access; log if a verified session tried to assert access it wasn't granted.
    const claimed = claimedAccess(request, body);
    const ungranted = claimed.departments.filter((d) => !ctx.departments.includes(d));
    if (claimed.allDepartments || ungranted.length > 0) {
      request.log.warn(
        { userId: ctx.userId, claimed, granted: ctx.departments },
        'verified session department claims ignored (DB-authoritative access)',
      );
    }
    return ctx;
  }
  const claimed = claimedAccess(request, body);
  const departments = normalizeDepartments([...ctx.departments, ...claimed.departments]);
  const allDepartmentAccess = ctx.allDepartmentAccess || claimed.allDepartments;
  return { ...ctx, departments, allDepartmentAccess };
}

/**
 * Shared department gate for the "direct" internal routes (Desk, Data Center, RingCentral,
 * Retention): internal audience only, then admin / bypass / all-department / department-member.
 */
export function requireDepartment(
  request: FastifyRequest,
  department: KnownDepartment,
  resourceLabel: string,
): TenantContext {
  const base = requireContext(request);
  if (base.audience !== 'internal') throw new RBACError(`${resourceLabel} is internal-only`);
  const ctx = withDepartmentAccess(base, request);
  const ok =
    ctx.role === 'admin' ||
    ctx.bypassRbac === true ||
    ctx.allDepartmentAccess ||
    ctx.departments.includes(department);
  if (!ok) throw new RBACError(`${resourceLabel} requires ${department} department access`);
  return ctx;
}

/**
 * Department membership + write mode for a Mytrion. Admins / all-dept / bypass always write.
 * Mode `read` on the Mytrion → 403 (UI hide is not the security boundary).
 */
export function requireMytrionWrite(
  request: FastifyRequest,
  mytrionId: MytrionId,
  resourceLabel: string,
): TenantContext {
  const department = mytrionId as KnownDepartment;
  const ctx = requireDepartment(request, department, resourceLabel);
  if (ctx.bypassRbac === true || ctx.allDepartmentAccess || ctx.role === 'admin') return ctx;
  if (ctx.mytrionAccessModes?.[mytrionId] === 'read') {
    throw new RBACError(`${resourceLabel} requires full (write) access — your access is read-only`);
  }
  return ctx;
}
