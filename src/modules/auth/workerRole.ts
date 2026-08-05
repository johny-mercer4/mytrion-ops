/**
 * The HARDCODED admin floor for a signed-in Zoho worker, from their VERIFIED CRM identity:
 * an admin-marker profile/role (or an ADMIN_USERS / BYPASS_USERS name) ⇒ 'admin'; everyone
 * else ⇒ 'worker'.
 *
 * NOT the whole answer any more, and deliberately not the ceiling. `allDepartmentAccess` is
 * resolved from the DB (Admin → User Management / profile + role defaults), so the authoritative
 * role is computed in authService.contextFromClaims as `dbAllAccess || thisMarker`. This function
 * exists so an env-named break-glass admin still resolves when the DB grants nothing or is
 * unreadable — it must never be used alone to DENY admin, or a DB-granted bypass silently becomes
 * a read-only session (which is exactly the bug that motivated splitting these two apart).
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
