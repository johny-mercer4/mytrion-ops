/**
 * Pull every Zoho People employee record and upsert into hr_employees (tenant-scoped).
 */
import { zohoPeople } from '../../integrations/zohoPeople.js';
import { hrEmployeeRepo } from '../../repos/hrEmployeeRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { mapZohoEmployeeToUpsert } from './mapZohoEmployee.js';

export interface HrEmployeeSyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  errors: Array<{ zohoRecordId: string; message: string }>;
}

export async function syncHrEmployeesFromZoho(
  ctx: TenantContext,
  opts: { maxPages?: number } = {},
): Promise<HrEmployeeSyncResult> {
  const records = await zohoPeople.listAllEmployees({
    ...(opts.maxPages !== undefined ? { maxPages: opts.maxPages } : {}),
  });
  let inserted = 0;
  let updated = 0;
  const errors: HrEmployeeSyncResult['errors'] = [];

  for (const record of records) {
    try {
      const outcome = await hrEmployeeRepo.upsertFromZoho(ctx, mapZohoEmployeeToUpsert(record));
      if (outcome === 'inserted') inserted += 1;
      else updated += 1;
    } catch (err) {
      errors.push({
        zohoRecordId: record.recordId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { fetched: records.length, inserted, updated, errors };
}
