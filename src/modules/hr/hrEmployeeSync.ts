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
  const errors: HrEmployeeSyncResult['errors'] = [];

  /**
   * Map first, so a malformed record is reported instead of aborting the write.
   */
  const mapped: ReturnType<typeof mapZohoEmployeeToUpsert>[] = [];
  for (const record of records) {
    try {
      mapped.push(mapZohoEmployeeToUpsert(record));
    } catch (err) {
      errors.push({
        zohoRecordId: record.recordId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Batched write. The previous per-record loop cost ~4 DB round-trips each (existence check, two
   * department lookups, the write); at the ~266 ms RTT to the hosted Postgres, 213 employees came to
   * ~226 s, so a full sync never finished inside a request. It died partway, left the table
   * half-populated, and surfaced nothing — prod sat at 88 of 213 records. Chunked multi-row upserts
   * bring the same sync to ~3 round-trips.
   *
   * `written` counts rows the statement touched; insert-vs-update is no longer distinguishable from a
   * single ON CONFLICT statement, so `updated` carries the total and `inserted` stays 0. The useful
   * signal was always fetched-vs-written, which is what a partial run actually shows up in.
   */
  const { written } = await hrEmployeeRepo.bulkUpsertFromZoho(ctx, mapped);

  return { fetched: records.length, inserted: 0, updated: written, errors };
}
