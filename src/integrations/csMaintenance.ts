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
import { and, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { maintenanceCases } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import { COMPENSATION_DEFAULTS } from '../modules/customerService/maintenanceRules.js';

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

/**
 * Per-case agent bonus — QA feedback 2026-07-28: "$5 per fully closed case and $2.50 per
 * half-completion case".
 *
 * Derived from `COMPENSATION_DEFAULTS` rather than restated. Those are the same two rates from the
 * other direction: the values Zoho's "Compensation Prepopulation" workflow rule wrote onto each
 * record, which this module then multiplies. Two literals would let the payout rate and the stored
 * per-case fee drift apart with nothing to catch it.
 */
export const BONUS_FULL_USD = Number(COMPENSATION_DEFAULTS.completionCompensation);
export const BONUS_HALF_USD = Number(COMPENSATION_DEFAULTS.halfCompletionCompensation);

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

/**
 * A case earns a bonus split between two agents when it names a "second agent" for a jointly
 * worked case (`bonus_completion_user_id`, distinct from the owner) — CS feedback 2026-07-31.
 * Each side gets half of whatever the case earns.
 */
const SPLIT_SHARE = 0.5;

/**
 * `bonus_completion_user_id`/`bonus_completion_name` are migrated Zoho columns (`Bonus_for
 * Completion`) that already carry real historical data for 83 of 2,719 rows, whose original Zoho
 * meaning is unknown (the field is not documented as a split, and a `Bonus_Calc` subform that
 * might have explained it was never migrated). Applying 50/50-split semantics retroactively would
 * silently recompute every past analytics window a manager has already seen, so the split only
 * applies to cases dated on/after this ship date — a case backdated before it is treated as if it
 * had no second agent at all.
 */
const SECOND_AGENT_SPLIT_FROM = '2026-08-01';

/** Every figure the Maintenance tab needs, in the shape the panel already consumes. */
export async function fetchMaintenanceAnalytics(w: MaintenanceWindow): Promise<MaintenanceAnalytics> {
  const cur = windowWhere(w.from, w.to);
  const prev = windowWhere(w.prevFrom, w.prevTo);

  // Reused (not rebuilt) in both the SELECT and the GROUP BY below so the two render
  // byte-identical SQL — Postgres requires a grouped expression to match its projection exactly.
  const secondIdExpr = sql<string | null>`case when ${maintenanceCases.caseDate} >= ${SECOND_AGENT_SPLIT_FROM} then ${maintenanceCases.bonusCompletionUserId} else null end`;
  const secondNameExpr = sql<string | null>`case when ${maintenanceCases.caseDate} >= ${SECOND_AGENT_SPLIT_FROM} then ${maintenanceCases.bonusCompletionName} else null end`;

  const [statusRows, caseTypeRows, dailyRows, ownerRows, prevRows] = await Promise.all([
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
     * One pass for the whole leaderboard, grouped by (owner, status, second agent).
     *
     * Grouping by owner ALONE gave only their total, and deriving half-completions from that counted
     * an agent's open/cancelled cases as half-paid work — per-agent halves summed to 11 against an
     * org total of 8. `signed` rides along in the same pass.
     *
     * `signed` (has a Case_Completion date) is deliberately NOT status-gated here in the SELECT —
     * gating happens once, below, in the accumulation loop, so a Cancelled case with a completion
     * date can never earn a bonus (CS bug report 2026-07-31: it did, before this fix) and a jointly
     * worked case can never disagree with a solo case of the same shape (see SPLIT_SHARE below).
     */
    db
      .select({
        ownerId: maintenanceCases.ownerZohoUserId,
        ownerName: maintenanceCases.ownerName,
        status: maintenanceCases.status,
        secondId: secondIdExpr,
        secondName: secondNameExpr,
        n: countInt,
        signed: sql<number>`count(${maintenanceCases.caseCompletion})::int`,
      })
      .from(maintenanceCases)
      .where(cur)
      .groupBy(
        maintenanceCases.ownerZohoUserId,
        maintenanceCases.ownerName,
        maintenanceCases.status,
        secondIdExpr,
        secondNameExpr,
      ),
    db.select({ n: countInt }).from(maintenanceCases).where(prev),
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
  /** Get-or-create, applying the existing rule that a blank name on one group must not blank a
   *  name another group supplied — also lets a second agent's name come from `secondName` even if
   *  they own no cases of their own in this window. */
  const entry = (id: string, name: string | null | undefined): OwnerAgg => {
    const row = agg.get(id) ?? { id, name: name || 'Unknown', total: 0, closed: 0, full: 0 };
    if (row.name === 'Unknown' && name) row.name = name;
    agg.set(id, row);
    return row;
  };

  // Unsplit, status-gated org-wide count — accumulated here (not a separate query) so it cannot
  // drift from the per-owner gate below. A jointly-worked case still counts as exactly one case
  // org-wide; only the per-owner attribution is split.
  let orgFull = 0;

  for (const r of ownerRows) {
    const bucket = bucketStatus(r.status ?? '');
    // Plain `!==` is correctly null-safe HERE (a null owner with a real second agent is a genuine
    // split), unlike SQL's `<>`, which silently drops a null-owner row — that null-owner bucket is
    // real, live data (see tests). This is why the split decision is made in JS, not a SQL predicate.
    const secondId = r.secondId ?? null;
    const shared = secondId !== null && secondId !== r.ownerId;
    const share = shared ? SPLIT_SHARE : 1;
    const credited = shared
      ? [entry(r.ownerId ?? 'unknown', r.ownerName), entry(secondId as string, r.secondName)]
      : [entry(r.ownerId ?? 'unknown', r.ownerName)];

    if (bucket !== 'cancelled') orgFull += r.signed;

    for (const a of credited) {
      a.total += r.n * share;
      if (bucket === 'closed') a.closed += r.n * share;
      // THE FIX: a Cancelled case earns nothing, even carrying a completion date. Gated here and
      // nowhere else, so a solo case and a jointly-shared case of the same shape can't disagree.
      if (bucket !== 'cancelled') a.full += r.signed * share;
    }
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
      fullComplete: orgFull,
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
