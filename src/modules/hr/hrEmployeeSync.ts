/**
 * Pull every Zoho People employee record and upsert into hr_employees (tenant-scoped).
 */
import { zohoPeople } from '../../integrations/zohoPeople.js';
import { hrEmployeeSyncRepo } from '../../repos/hrEmployeeSyncRepo.js';
import { hrAttendancePunchRepo } from '../../repos/hrAttendancePunchRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { mapZohoEmployeeToUpsert } from './mapZohoEmployee.js';

export interface HrEmployeeSyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  /** Rows whose id-based manager link was (re)resolved from the synced `reporting_to` name. */
  relinkedManagers: number;
  /** Previously unmapped Ganga punches attached by normalized Face ID. */
  relinkedAttendancePunches: number;
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
  const { written } = await hrEmployeeSyncRepo.bulkUpsertFromZoho(ctx, mapped);

  /**
   * Re-resolve the id-based manager links from the names the upsert just wrote.
   *
   * The upsert overwrites `reporting_to` (Zoho owns the name) and knows nothing about
   * `reporting_to_employee_id`, which the org canvas draws its reporting lines from. Without this pass
   * the two columns contradict each other after every sync: a person's card shows one manager while the
   * chart draws the line to whoever the id still pointed at. Runs once, set-based, after the writes — so
   * it also picks up new hires whose manager only exists as of this batch.
   */
  const relinkedManagers = await hrEmployeeSyncRepo.relinkManagers(ctx);
  const relinkedAttendancePunches = await hrAttendancePunchRepo.reconcileUnmapped(ctx);

  return {
    fetched: records.length,
    inserted: 0,
    updated: written,
    relinkedManagers,
    relinkedAttendancePunches,
    errors,
  };
}
