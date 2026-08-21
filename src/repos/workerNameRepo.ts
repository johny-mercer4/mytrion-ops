/**
 * Zoho user id → the name to show a colleague. Batched.
 *
 * WHICH NAME. Two directories in this database answer the question and they DISAGREE, on four of
 * the six people who own collection cases:
 *
 *   6227679000038542039   kpi_workers "Felix Johnson"    hr_employees "Farrux Jabborov"
 *   6227679000093960901   kpi_workers "John Mercer"      hr_employees "Asadbek Xojimatov"
 *   6227679000082999509   kpi_workers "Steven Johnson"   hr_employees "Ilxomjon Xatamov"
 *   6227679000140138025   kpi_workers "Tamerlan Chase"   hr_employees "Tamerlan Teshabayev"
 *
 * Neither is wrong. `kpi_workers.display_name` is synced from the Zoho USER record — the name the
 * CRM prints in its Owner column and the name these people use with US carriers on the phone.
 * `hr_employees` is the HR record — the legal name on the contract.
 *
 * This resolver serves screens that REPLACE a CRM screen, so it prefers the CRM name: an owner
 * column that suddenly renames half the team the day they stop opening Zoho would read as a bug.
 * HR is the fallback for anyone the KPI sync has not seen, then the raw id — ugly, but a visible
 * id is a lead to follow where a blank cell is a mystery.
 *
 * `escalationRouting.resolveWorkerName` deliberately does the opposite for one id at a time; that
 * one names a person in an approval chain, where the contract name is the right one.
 */
import { inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { hrEmployees, kpiWorkers } from '../db/schema/index.js';

/**
 * Display names for a set of Zoho user ids. Ids with no match anywhere are absent from the map —
 * the caller decides whether to show the id or nothing, which differs by surface.
 *
 * No `TenantContext`: neither directory is tenant-partitioned, and taking a context this function
 * cannot honour would imply an isolation guarantee it does not make. Callers have already applied
 * their own tenant check to decide which ids they are allowed to ask about.
 */
export async function workerDisplayNames(
  zohoUserIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(zohoUserIds.filter((id) => id && id.trim().length > 0))];
  if (ids.length === 0) return out;

  // Two bounded reads, not one per id. HR first so the CRM name overwrites it where both exist.
  const [hr, kpi] = await Promise.all([
    db
      .select({
        zohoUserId: hrEmployees.zohoUserId,
        firstName: hrEmployees.firstName,
        lastName: hrEmployees.lastName,
      })
      .from(hrEmployees)
      .where(inArray(hrEmployees.zohoUserId, ids)),
    db
      .select({ zohoUserId: kpiWorkers.zohoUserId, displayName: kpiWorkers.displayName })
      .from(kpiWorkers)
      .where(inArray(kpiWorkers.zohoUserId, ids)),
  ]);

  return mergeWorkerNames(hr, kpi);
}

/**
 * The precedence rule, on its own so it can be tested without a database.
 * HR fills the map first; the CRM name then overwrites it wherever both exist.
 */
export function mergeWorkerNames(
  hr: ReadonlyArray<{ zohoUserId: string | null; firstName: string | null; lastName: string | null }>,
  kpi: ReadonlyArray<{ zohoUserId: string; displayName: string | null }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of hr) {
    if (!row.zohoUserId) continue;
    const full = [row.firstName, row.lastName].filter((p) => p?.trim()).join(' ').trim();
    if (full) out.set(row.zohoUserId, full);
  }
  for (const row of kpi) {
    const name = row.displayName?.trim();
    if (name) out.set(row.zohoUserId, name);
  }
  return out;
}

/** One id, same rules. Returns null rather than the id so the caller chooses the fallback. */
export async function workerDisplayName(
  zohoUserId: string | null | undefined,
): Promise<string | null> {
  if (!zohoUserId) return null;
  const map = await workerDisplayNames([zohoUserId]);
  return map.get(zohoUserId) ?? null;
}
