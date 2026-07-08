/**
 * Security context for scheduled automations. Scoped to the automation's own department(s) —
 * NOT allDepartmentAccess, NOT bypassRbac — so a cron-run agent has exactly the authority of a
 * worker in that department. Every action still flows through dispatchTool → audit_log.
 * The admin role is required because some automation outputs (e.g. Telegram notifies) are
 * write-risk tools; the department gate still constrains which tools those can be.
 */
import { createId } from '@paralleldrive/cuid2';
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import { normalizeDepartments } from '../../lib/department.js';
import { scopesForRole } from '../auth/permissions.js';
import type { TenantContext } from '../../types/tenantContext.js';

export const SCHEDULER_USER_ID = 'system:scheduler';

export function buildSystemContext(
  departments: string[],
  opts: { allDepartmentAccess?: boolean } = {},
): TenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: SCHEDULER_USER_ID,
    audience: 'internal',
    role: 'admin',
    scopes: scopesForRole('admin'),
    departments: normalizeDepartments(departments),
    allDepartmentAccess: opts.allDepartmentAccess ?? false,
    userName: 'Octane Scheduler',
    requestId: `cron-${createId()}`,
  };
}
