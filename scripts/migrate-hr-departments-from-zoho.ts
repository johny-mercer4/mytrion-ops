/**
 * One-shot: apply pending migrations (expects 0063_hr_departments) then pull Zoho People
 * `department` form records into `hr_departments` for the default tenant.
 *
 *   corepack pnpm exec tsx scripts/migrate-hr-departments-from-zoho.ts
 */
import 'dotenv/config';
import { DEFAULT_TENANT_ID } from '../src/config/constants.js';
import { closeDb } from '../src/db/client.js';
import { syncHrDepartmentsFromZoho } from '../src/modules/hr/hrDepartmentSync.js';
import { hrDepartmentRepo } from '../src/repos/hrDepartmentRepo.js';
import type { TenantContext } from '../src/types/tenantContext.js';

function systemCtx(): TenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: 'system:hr-department-migrate',
    audience: 'internal',
    role: 'admin',
    scopes: ['*'],
    departments: [],
    allDepartmentAccess: true,
    bypassRbac: true,
    sessionVerified: true,
    requestId: `migrate-hr-dept-${Date.now()}`,
  };
}

async function main(): Promise<void> {
  const ctx = systemCtx();
  console.log('Migrating Zoho People departments → hr_departments (tenant=%s)…', ctx.tenantId);
  const result = await syncHrDepartmentsFromZoho(ctx);
  console.log(JSON.stringify(result, null, 2));
  const total = await hrDepartmentRepo.count(ctx);
  console.log('hr_departments count:', total);
  await closeDb();
  if (result.errors.length > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
