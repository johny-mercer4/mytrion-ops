/**
 * Maintenance analytics — native Zoho COQL, replacing the `mytrionGetMaintenanceAnalytics` Deluge.
 *
 * The Deluge paginated up to 5,000 FULL records (25 sequential COQL calls) and counted them in a
 * loop. Zoho aggregates server-side, so the same figures come from a handful of `COUNT(id) …
 * GROUP BY` queries — one call per dimension, no row transfer, and `daily` arrives already sorted.
 *
 * Two bugs in the Deluge are fixed here (both verified against the live org):
 *  1. Its status buckets never matched. It tested `contains("progress")` / `contains("closed")`,
 *     but the picklist reads **"In Process" / "Completed" / "Cancelled"** — "process" is not
 *     "progress" — so `open`, `closed` and `fullComplete` all reported 0 while `byStatus` (a plain
 *     group-by of the raw string) was right. Buckets are derived from the real values below.
 *  2. `halfComplete`/`fullComplete` were guessed from the status text. There is no such status; the
 *     module carries a `Case_Completion` DATE instead, so "fully complete" = closed WITH a
 *     completion date. (`Completion_Compensation`/`Half_Completion_Compensation` are currency
 *     fields that are set on every row — they do not discriminate.)
 *
 * COQL gotchas encoded here — both produce a 400, not a wrong answer:
 *  - a WHERE clause is MANDATORY (a bare `SELECT COUNT(id) FROM Maintenance` is a SYNTAX_ERROR —
 *    exactly why the CS Home tile read 0);
 *  - `AND` is BINARY: a flat `a and b and c` fails "near where", so conditions are nested pairwise.
 */
import { runCoql } from './zohoCrm.js';
import { AppError } from '../lib/errors.js';

export interface MaintenanceWindow {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

export interface CountedSlice {
  status?: string;
  caseType?: string;
  count: number;
}
export interface DailyPoint {
  day: string;
  count: number;
}
export interface OwnerSlice {
  id: string;
  name: string;
  count: number;
}

export interface MaintenanceAnalytics {
  totals: {
    current: number;
    previous: number;
    open: number;
    closed: number;
    halfComplete: number;
    fullComplete: number;
  };
  byStatus: CountedSlice[];
  byCaseType: CountedSlice[];
  daily: DailyPoint[];
  byOwner: OwnerSlice[];
}

/** `YYYY-MM-DD` only — these are interpolated into COQL, so nothing else may pass. */
function assertYmd(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(`${label} must be YYYY-MM-DD`, { statusCode: 400, code: 'BAD_RANGE', expose: true });
  }
  return value;
}

/** Inclusive date window. Parenthesised because COQL's AND is binary (see header). */
function windowClause(from: string, to: string): string {
  return `(Date >= '${assertYmd(from, 'from')}' and Date <= '${assertYmd(to, 'to')}')`;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** COQL returns the aggregate under the literal key `COUNT(id)`. */
const countOf = (row: Record<string, unknown> | undefined): number => num(row?.['COUNT(id)']);

async function scalarCount(where: string): Promise<number> {
  const { rows } = await runCoql(`SELECT COUNT(id) FROM Maintenance WHERE ${where}`);
  return countOf(rows[0]);
}

/**
 * Bucket a raw picklist value. Matching is substring-based and deliberately generous so a renamed
 * or newly added status still lands somewhere sensible — the previous implementation broke
 * precisely because it hard-matched words the data never contained.
 */
export function bucketStatus(raw: string): 'open' | 'closed' | 'cancelled' | 'other' {
  const s = raw.trim().toLowerCase();
  if (!s) return 'other';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('complet') || s.includes('closed') || s.includes('done') || s.includes('resolved')) {
    return 'closed';
  }
  // "In Process", "In Progress", "Pending", "Open", "New" — anything still being worked.
  if (
    s.includes('process') ||
    s.includes('progress') ||
    s.includes('pending') ||
    s.includes('open') ||
    s.includes('new')
  ) {
    return 'open';
  }
  return 'other';
}

/** Every figure the Maintenance tab needs, in the shape the panel already consumes. */
export async function fetchMaintenanceAnalytics(w: MaintenanceWindow): Promise<MaintenanceAnalytics> {
  const cur = windowClause(w.from, w.to);
  const prev = windowClause(w.prevFrom, w.prevTo);

  const [statusRes, caseTypeRes, dailyRes, ownerRes, previous, fullComplete] = await Promise.all([
    runCoql(`SELECT Status, COUNT(id) FROM Maintenance WHERE ${cur} GROUP BY Status`),
    runCoql(`SELECT Case_Type, COUNT(id) FROM Maintenance WHERE ${cur} GROUP BY Case_Type`),
    runCoql(`SELECT Date, COUNT(id) FROM Maintenance WHERE ${cur} GROUP BY Date ORDER BY Date ASC`),
    runCoql(`SELECT Owner, COUNT(id) FROM Maintenance WHERE ${cur} GROUP BY Owner`),
    scalarCount(prev),
    // Closed AND signed off with a completion date. Nested AND — flat would 400.
    scalarCount(`(${cur} and Case_Completion is not null)`),
  ]);

  const byStatus: CountedSlice[] = statusRes.rows.map((r) => ({
    status: String(r['Status'] ?? 'Unknown') || 'Unknown',
    count: countOf(r),
  }));

  let current = 0;
  let open = 0;
  let closed = 0;
  for (const s of byStatus) {
    current += s.count;
    const bucket = bucketStatus(s.status ?? '');
    if (bucket === 'open') open += s.count;
    else if (bucket === 'closed') closed += s.count;
  }

  return {
    totals: {
      current,
      previous,
      open,
      closed,
      fullComplete,
      // Closed but with no completion date on the record — finished, not signed off.
      halfComplete: Math.max(0, closed - fullComplete),
    },
    byStatus,
    byCaseType: caseTypeRes.rows.map((r) => ({
      caseType: String(r['Case_Type'] ?? 'Other') || 'Other',
      count: countOf(r),
    })),
    daily: dailyRes.rows.map((r) => ({ day: String(r['Date'] ?? '').slice(0, 10), count: countOf(r) })),
    byOwner: ownerRes.rows.map((r) => {
      const owner = r['Owner'] as { id?: string; name?: string } | null;
      return {
        id: String(owner?.id ?? 'unknown'),
        name: String(owner?.name ?? 'Unknown'),
        count: countOf(r),
      };
    }),
  };
}

/**
 * Count for the CS Home "Maintenance" tile. The Deluge ran `SELECT COUNT(id) FROM Maintenance` with
 * no WHERE — a COQL SYNTAX_ERROR — and swallowed the failure as 0, which is why the tile read 0
 * while the module held thousands of rows. A window is always supplied here.
 */
export async function countMaintenanceCases(from: string, to: string): Promise<number> {
  return scalarCount(windowClause(from, to));
}
