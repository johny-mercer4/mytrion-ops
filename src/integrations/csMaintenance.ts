/**
 * Maintenance analytics — now computed in Postgres over `maintenance_cases`.
 *
 * History worth keeping, because two of these bugs are the reason the numbers are what they are:
 *
 *  - The original Deluge (`mytrionGetMaintenanceAnalytics`) paginated up to 5,000 FULL records — 25
 *    sequential COQL calls — and counted them in a loop.
 *  - It then mis-bucketed every status: it tested `contains("progress")` / `contains("closed")`, but
 *    the picklist reads **"In Process" / "Completed" / "Cancelled"** — "process" is not "progress" —
 *    so `open`, `closed` and `fullComplete` all reported 0 while `byStatus` (a plain group-by of the
 *    raw string) was right. Buckets are still derived through `bucketStatus()` below rather than
 *    hard-matched, so a renamed status lands somewhere sensible instead of vanishing.
 *  - `halfComplete`/`fullComplete` were guessed from the status text. There is no such status; the
 *    module carries a `Case_Completion` DATE instead, so "fully complete" = signed off with a
 *    completion date. (`Completion_Compensation`/`Half_Completion_Compensation` are currency fields
 *    set on nearly every row — they do not discriminate.)
 *
 * That second pass replaced the Deluge with native COQL. This pass replaces the COQL with SQL, now
 * that `maintenance_cases` is the source of truth: same figures, no Zoho credits, and — the actual
 * motivation — the Analytics tab and the Maintenance tab can no longer disagree, which they did the
 * moment an agent created or edited a case in Mytrion.
 *
 * Two Zoho-era workarounds are gone rather than ported:
 *   - the per-owner name lookup through `listActiveUsers()` (COQL returned `Owner.name` as the LAST
 *     NAME ONLY). `owner_name` is denormalized on the row, resolved once at migration time.
 *   - COQL's mandatory-WHERE and binary-AND contortions.
 */
import { and, gte, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { maintenanceCases } from '../db/schema/index.js';
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
  /** Signed off with a Case_Completion date. Earns the full per-case bonus. */
  fullComplete: number;
  /** Closed with no completion date on the record. Earns the half bonus. */
  halfComplete: number;
  /** fullComplete * BONUS_FULL_USD + halfComplete * BONUS_HALF_USD, computed server-side so the
   *  rate lives in one place rather than in a component. */
  bonusUsd: number;
}

/** Per-case agent bonus — QA feedback 2026-07-28: "$5 per fully closed case and $2.50 per
 *  half-completion case". Kept adjacent to the buckets they multiply. */
export const BONUS_FULL_USD = 5;
export const BONUS_HALF_USD = 2.5;

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

/** `YYYY-MM-DD` only. Kept as a guard even though these are bound parameters now, not interpolated. */
function assertYmd(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(`${label} must be YYYY-MM-DD`, { statusCode: 400, code: 'BAD_RANGE', expose: true });
  }
  return value;
}

/** Inclusive `case_date` window — matches the Zoho-era `Date >= from and Date <= to`. */
function windowWhere(from: string, to: string) {
  return and(
    gte(maintenanceCases.caseDate, assertYmd(from, 'from')),
    lte(maintenanceCases.caseDate, assertYmd(to, 'to')),
  );
}

/**
 * Bucket a raw picklist value. Matching is substring-based and deliberately generous so a renamed or
 * newly added status still lands somewhere sensible — the previous implementation broke precisely
 * because it hard-matched words the data never contained.
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

const countInt = sql<number>`count(*)::int`;

/** Every figure the Maintenance tab needs, in the shape the panel already consumes. */
export async function fetchMaintenanceAnalytics(w: MaintenanceWindow): Promise<MaintenanceAnalytics> {
  const cur = windowWhere(w.from, w.to);
  const prev = windowWhere(w.prevFrom, w.prevTo);

  const [statusRows, caseTypeRows, dailyRows, ownerRows, prevRows, fullRows] = await Promise.all([
    db
      .select({ status: maintenanceCases.status, n: countInt })
      .from(maintenanceCases)
      .where(cur)
      .groupBy(maintenanceCases.status),
    db
      .select({ caseType: maintenanceCases.caseType, n: countInt })
      .from(maintenanceCases)
      .where(cur)
      .groupBy(maintenanceCases.caseType),
    db
      .select({ day: maintenanceCases.caseDate, n: countInt })
      .from(maintenanceCases)
      .where(cur)
      .groupBy(maintenanceCases.caseDate)
      .orderBy(maintenanceCases.caseDate),
    /*
     * One pass for the whole leaderboard, grouped by (owner, status).
     *
     * Grouping by owner ALONE gave only their total, and deriving half-completions from that counted
     * an agent's open/cancelled cases as half-paid work — per-agent halves summed to 11 against an
     * org total of 8. `signed` rides along in the same pass; note it is deliberately NOT status-gated,
     * exactly as the COQL predicate was.
     */
    db
      .select({
        ownerId: maintenanceCases.ownerZohoUserId,
        ownerName: maintenanceCases.ownerName,
        status: maintenanceCases.status,
        n: countInt,
        signed: sql<number>`count(${maintenanceCases.caseCompletion})::int`,
      })
      .from(maintenanceCases)
      .where(cur)
      .groupBy(
        maintenanceCases.ownerZohoUserId,
        maintenanceCases.ownerName,
        maintenanceCases.status,
      ),
    db.select({ n: countInt }).from(maintenanceCases).where(prev),
    db
      .select({ n: countInt })
      .from(maintenanceCases)
      .where(and(cur, isNotNull(maintenanceCases.caseCompletion))),
  ]);

  const byStatus: CountedSlice[] = statusRows.map((r) => ({
    status: r.status ?? 'Unknown',
    count: r.n,
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

  interface OwnerAgg {
    id: string;
    name: string;
    total: number;
    closed: number;
    full: number;
  }
  const agg = new Map<string, OwnerAgg>();
  for (const r of ownerRows) {
    const id = r.ownerId ?? 'unknown';
    const row = agg.get(id) ?? { id, name: r.ownerName ?? 'Unknown', total: 0, closed: 0, full: 0 };
    row.total += r.n;
    if (bucketStatus(r.status ?? '') === 'closed') row.closed += r.n;
    row.full += r.signed;
    // A blank owner_name on one status row must not blank a name another row supplied.
    if (row.name === 'Unknown' && r.ownerName) row.name = r.ownerName;
    agg.set(id, row);
  }

  const byOwner: OwnerSlice[] = [...agg.values()].map((o) => {
    // Half = this agent's CLOSED cases minus their signed-off ones. Floored at 0: the sign-off tally
    // is not status-gated, so an agent holding a case that carries a completion date while still
    // Open/Cancelled must not go negative and cannot owe back a bonus.
    const half = Math.max(0, o.closed - o.full);
    return {
      id: o.id,
      name: o.name,
      count: o.total,
      fullComplete: o.full,
      halfComplete: half,
      bonusUsd: Number((o.full * BONUS_FULL_USD + half * BONUS_HALF_USD).toFixed(2)),
    };
  });

  return {
    totals: {
      current,
      previous: prevRows[0]?.n ?? 0,
      open,
      closed,
      fullComplete: fullRows[0]?.n ?? 0,
      /*
       * Closed but with no completion date — finished, not signed off.
       *
       * Summed from byOwner rather than computed as `closed - fullComplete`, so the headline figure
       * and the leaderboard can never disagree. They CAN differ by construction: a case that is
       * signed off while still Open/Cancelled makes one agent's subtraction negative, which the
       * per-agent floor clamps to 0 but a single org-wide subtraction silently absorbs. The live org
       * has such records, and the per-agent number is the one that gets paid.
       */
      halfComplete: byOwner.reduce((sum, o) => sum + o.halfComplete, 0),
    },
    byStatus,
    byCaseType: caseTypeRows.map((r) => ({ caseType: r.caseType ?? 'Other', count: r.n })),
    daily: dailyRows.map((r) => ({ day: String(r.day ?? '').slice(0, 10), count: r.n })),
    byOwner,
  };
}

/**
 * Count for the CS Home "Maintenance" tile. The Deluge ran `SELECT COUNT(id) FROM Maintenance` with
 * no WHERE — a COQL SYNTAX_ERROR — and swallowed the failure as 0, which is why the tile read 0 while
 * the module held thousands of rows. A window is always supplied here.
 */
export async function countMaintenanceCases(from: string, to: string): Promise<number> {
  const rows = await db.select({ n: countInt }).from(maintenanceCases).where(windowWhere(from, to));
  return rows[0]?.n ?? 0;
}
