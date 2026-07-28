/**
 * Pull every Zoho People department record and upsert into hr_departments (tenant-scoped).
 */
import { zohoPeople } from '../../integrations/zohoPeople.js';
import { hrDepartmentRepo } from '../../repos/hrDepartmentRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { mapZohoDepartmentToUpsert } from './mapZohoDepartment.js';

export interface HrDepartmentSyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  errors: Array<{ zohoRecordId: string; message: string }>;
}

export async function syncHrDepartmentsFromZoho(
  ctx: TenantContext,
  opts: { maxPages?: number } = {},
): Promise<HrDepartmentSyncResult> {
  const records = await zohoPeople.listAllDepartments({
    ...(opts.maxPages !== undefined ? { maxPages: opts.maxPages } : {}),
  });
  let inserted = 0;
  let updated = 0;
  const errors: HrDepartmentSyncResult['errors'] = [];

  for (const record of records) {
    try {
      const outcome = await hrDepartmentRepo.upsertFromZoho(ctx, mapZohoDepartmentToUpsert(record));
      if (outcome === 'inserted') inserted += 1;
      else updated += 1;
    } catch (err) {
      errors.push({
        zohoRecordId: record.recordId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Second pass: parents may have been inserted after children on the first pass.
  await hrDepartmentRepo.relinkParents(ctx);

  return { fetched: records.length, inserted, updated, errors };
}
