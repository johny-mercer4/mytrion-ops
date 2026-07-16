import type { FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import {
  deriveWorkerDepartments,
  normalizeDepartments,
  type KnownDepartment,
} from '../../lib/department.js';
import { AuthError, RBACError } from '../../lib/errors.js';
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
 * `allDepartmentAccess` stays token-derived (admin ⇒ true) and a non-admin worker's
 * departments are derived server-side from their Zoho profile/role
 * (deriveWorkerDepartments). This closes the header self-elevation path that previously
 * let any authenticated user claim all-department access.
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
    const derived = deriveWorkerDepartments(ctx.profiles, ctx.callerRole ?? null);
    const departments = normalizeDepartments([...ctx.departments, ...derived]);
    const claimed = claimedAccess(request, body);
    const ungranted = claimed.departments.filter((d) => !departments.includes(d));
    if (claimed.allDepartments || ungranted.length > 0) {
      // Roster-validation signal: a verified session asserted access the profile-derived
      // set doesn't grant. Either an elevation attempt or a profile→department mapping gap.
      request.log.warn(
        { userId: ctx.userId, claimed, derived: departments },
        'verified session department claims ignored (session-authoritative access)',
      );
    }
    return { ...ctx, departments };
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
