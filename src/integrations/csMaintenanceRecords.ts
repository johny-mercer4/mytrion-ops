/**
 * Row-level COQL reads of the Zoho CRM `Maintenance` module — the source side of the ONE-TIME
 * migration into `maintenance_cases` (scripts/migrateMaintenanceFromZoho.ts).
 *
 * Kept separate from csMaintenance.ts on purpose: that file is the ANALYTICS side (COUNT/GROUP BY
 * aggregates for the Analytics → Maintenance tab) and its header carries a hard-won narrative about
 * two Deluge bugs. A row drain belongs beside it, not inside it.
 *
 * Postgres owns maintenance data after the migration, so nothing here runs on a schedule. It exists
 * so the import is repeatable — the upsert is keyed on the Zoho id, making a re-run idempotent.
 */
import { AppError } from '../lib/errors.js';
import { MAINTENANCE_MODULE, MAINTENANCE_SELECT } from '../modules/customerService/maintenanceFields.js';
import { zohoCrm, type CoqlDrainResult } from './zohoCrm.js';

/**
 * ASCENDING id, and nothing else.
 *
 * `id` alone is already a TOTAL order, so offset paging cannot skip or duplicate a row — unlike a
 * Created_Time sort, where the referral drain found 680 of 687 records sharing one timestamp and
 * every page boundary landing inside that tie group. Ascending also means a record created DURING a
 * drain appends past the cursor instead of shifting every later page down.
 */
const MAINTENANCE_ORDER = 'order by id asc';

/** 1,000/page = 2 API credits per call. The whole module is ~2.7k rows, so ~3 pages. */
export const MAINTENANCE_PAGE_SIZE = 1000;

/** COQL requires a WHERE clause — a bare `SELECT COUNT(id) FROM Maintenance` is a SYNTAX_ERROR. */
export const MATCH_ALL = 'id is not null';

export interface DrainOptions {
  where?: string;
  pageSize?: number;
  maxRows?: number;
  budgetMs?: number;
}

function wrapZohoError(err: unknown, what: string): AppError {
  return new AppError(`Zoho CRM ${what} failed: ${err instanceof Error ? err.message : String(err)}`, {
    statusCode: 502,
    code: 'ZOHO_CRM_ERROR',
    expose: true,
  });
}

/** How many records the module holds (drives the paging plan; logged before any drain). */
export async function countMaintenanceRecords(where = MATCH_ALL): Promise<number> {
  try {
    const { rows } = await zohoCrm.runCoql(
      `select COUNT(id) from ${MAINTENANCE_MODULE} where ${where}`,
    );
    const row = rows[0] ?? {};
    const value = row['COUNT(id)'] ?? row['count(id)'] ?? row['count'] ?? 0;
    return Number(value) || 0;
  } catch (err) {
    throw wrapZohoError(err, 'count');
  }
}

/**
 * Every Maintenance record matching `where`, drained page by page.
 *
 * `runCoqlAll` owns the LIMIT clause (it throws if the query carries one), which is why the order
 * clause is appended here and nothing else follows it.
 */
export async function drainMaintenance(opts: DrainOptions = {}): Promise<CoqlDrainResult> {
  const where = opts.where ?? MATCH_ALL;
  const query =
    `select ${MAINTENANCE_SELECT.join(', ')} from ${MAINTENANCE_MODULE} ` +
    `where ${where} ${MAINTENANCE_ORDER}`;
  try {
    return await zohoCrm.runCoqlAll(query, {
      pageSize: opts.pageSize ?? MAINTENANCE_PAGE_SIZE,
      ...(opts.maxRows !== undefined ? { maxRows: opts.maxRows } : {}),
      ...(opts.budgetMs !== undefined ? { budgetMs: opts.budgetMs } : {}),
    });
  } catch (err) {
    throw wrapZohoError(err, 'Maintenance drain');
  }
}

/**
 * Inclusive `Created_Time` window.
 *
 * Parenthesised as ONE pair because COQL's `AND` is binary — a flat `a and b and c` fails with a
 * syntax error "near where". Windowing on Created_Time rather than `Date` keeps the drain away from
 * the reserved-word question entirely (`Date` does parse in a POST /coql body for this org, but
 * there is no reason to depend on that).
 */
export function createdWindow(fromYmd: string, toYmd: string): string {
  for (const [label, v] of [
    ['from', fromYmd],
    ['to', toYmd],
  ] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      throw new AppError(`${label} must be YYYY-MM-DD`, {
        statusCode: 400,
        code: 'BAD_RANGE',
        expose: true,
      });
    }
  }
  return (
    `(Created_Time >= '${fromYmd}T00:00:00+00:00' and ` +
    `Created_Time <= '${toYmd}T23:59:59+00:00')`
  );
}
