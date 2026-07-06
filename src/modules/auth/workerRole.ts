/**
 * Internal role for a signed-in Zoho worker, derived from their VERIFIED CRM identity.
 * Uses the same predicate as the department bypass (resolveAllDepartmentAccess) so role and
 * allDepartmentAccess can never diverge: an admin-marker profile/role (or ADMIN_USERS/
 * BYPASS_USERS name) ⇒ 'admin' (full scopes); every other worker ⇒ 'worker' (read scopes).
 *
 * Applied at all three token boundaries — mint (zohoAuthService.claimsFor), verify
 * (authService.contextFromClaims), and refresh (authService.refresh) — so a role fix
 * propagates to LIVE sessions on deploy instead of being frozen into old tokens.
 */
import { resolveAllDepartmentAccess } from '../../lib/department.js';
import type { Role } from '../../types/tenantContext.js';

export interface WorkerIdentityLike {
  userName?: string | null | undefined;
  profile?: string | null | undefined;
  zohoRole?: string | null | undefined;
}

export function workerRoleFor(worker: WorkerIdentityLike): Role {
  return resolveAllDepartmentAccess({
    profile: worker.profile,
    role: worker.zohoRole,
    userName: worker.userName,
  })
    ? 'admin'
    : 'worker';
}
