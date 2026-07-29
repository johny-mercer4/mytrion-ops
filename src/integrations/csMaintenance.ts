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
import { runCoql, zohoCrm } from './zohoCrm.js';
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
  /** Closed WITH a Case_Completion date. Earns the full per-case bonus. */
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

/**
 * Owner id -> full name, from the CRM user directory.
 *
 * COQL returns `Owner: {id, name}` where `name` is only the user's LAST name ("Garcia", "Mordale"),
 * which is what the leaderboard was showing. The user directory carries the full name against the
 * same id space, so resolve through it and fall back to the COQL name when a user is missing
 * (deactivated, or an id outside the directory) — never leave a leaderboard row blank.
 */
async function fullNameByOwnerId(): Promise<Map<string, string>> {
  const users = await zohoCrm.listActiveUsers().catch(() => []);
  const byId = new Map<string, string>();
  for (const u of users) {
    const name = (u.name ?? '').trim();
    if (u.zohoUserId && name) byId.set(String(u.zohoUserId), name);
  }
  return byId;
}

/** Every figure the Maintenance tab needs, in the shape the panel already consumes. */
export async function fetchMaintenanceAnalytics(w: MaintenanceWindow): Promise<MaintenanceAnalytics> {
  const cur = windowClause(w.from, w.to);
  const prev = windowClause(w.prevFrom, w.prevTo);

  const [statusRes, caseTypeRes, dailyRes, ownerRes, ownerFullRes, previous, fullComplete, names] =
    await Promise.all([
      runCoql(`SELECT Status, COUNT(id) FROM Maintenance WHERE ${cur} GROUP BY Status`),
      runCoql(`SELECT Case_Type, COUNT(id) FROM Maintenance WHERE ${cur} GROUP BY Case_Type`),
      runCoql(`SELECT Date, COUNT(id) FROM Maintenance WHERE ${cur} GROUP BY Date ORDER BY Date ASC`),
      // Grouped by Owner AND Status, so a per-agent CLOSED count is available. Grouping by owner
      // alone gave only their total, and half-completions derived from that counted an agent's
      // open/cancelled cases as half-paid work (per-agent halves summed to 11 against an org
      // total of 8). Bucketing in JS keeps this robust to a renamed status.
      runCoql(`SELECT Owner, Status, COUNT(id) FROM Maintenance WHERE ${cur} GROUP BY Owner, Status`),
      // Per-owner sign-offs, for the bonus. Same predicate as the org-wide fullComplete below, so
      // the two can never disagree about what "fully complete" means. Nested AND — flat would 400.
      runCoql(
        `SELECT Owner, COUNT(id) FROM Maintenance WHERE (${cur} and Case_Completion is not null) GROUP BY Owner`,
      ),
      scalarCount(prev),
      // Closed AND signed off with a completion date. Nested AND — flat would 400.
      scalarCount(`(${cur} and Case_Completion is not null)`),
      fullNameByOwnerId(),
    ]);

  const ownerId = (r: Record<string, unknown>): string =>
    String((r['Owner'] as { id?: string } | null)?.id ?? '');
  const fullByOwner = new Map<string, number>();
  for (const r of ownerFullRes.rows) {
    const id = ownerId(r);
    if (id) fullByOwner.set(id, countOf(r));
  }
  // Fold the (Owner, Status) grid into per-owner totals and per-owner CLOSED counts.
  interface OwnerAgg {
    id: string;
    name: string;
    total: number;
    closed: number;
  }
  const agg = new Map<string, OwnerAgg>();
  for (const r of ownerRes.rows) {
    const owner = r['Owner'] as { id?: string; name?: string } | null;
    const id = String(owner?.id ?? 'unknown');
    const n = countOf(r);
    const row = agg.get(id) ?? { id, name: String(owner?.name ?? 'Unknown'), total: 0, closed: 0 };
    row.total += n;
    if (bucketStatus(String(r['Status'] ?? '')) === 'closed') row.closed += n;
    agg.set(id, row);
  }

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

  const byOwner: OwnerSlice[] = [...agg.values()].map((o) => {
    const full = fullByOwner.get(o.id) ?? 0;
    // Half = this agent's CLOSED cases minus their signed-off ones. Floored at 0: the sign-off
    // predicate is not status-gated, so an agent holding a case that carries a Case_Completion date
    // while still Open/Cancelled must not go negative and cannot owe back a bonus.
    const half = Math.max(0, o.closed - full);
    return {
      id: o.id,
      name: names.get(o.id) ?? o.name,
      count: o.total,
      fullComplete: full,
      halfComplete: half,
      bonusUsd: Number((full * BONUS_FULL_USD + half * BONUS_HALF_USD).toFixed(2)),
    };
  });

  return {
    totals: {
      current,
      previous,
      open,
      closed,
      fullComplete,
      /*
       * Closed but with no completion date — finished, not signed off.
       *
       * Summed from byOwner rather than computed as `closed - fullComplete`, so the headline figure
       * and the leaderboard can never disagree. They CAN differ by construction: a case that is
       * signed off while still Open/Cancelled makes one agent's subtraction negative, which the
       * per-agent floor clamps to 0 but a single org-wide subtraction silently absorbs. The live org
       * has exactly one such record today (org-wide subtraction says 8, per-agent sum says 9) — a
       * data issue, not an arithmetic one, and the per-agent number is the one that gets paid.
       */
      halfComplete: byOwner.reduce((sum, o) => sum + o.halfComplete, 0),
    },
    byStatus,
    byCaseType: caseTypeRes.rows.map((r) => ({
      caseType: String(r['Case_Type'] ?? 'Other') || 'Other',
      count: countOf(r),
    })),
    daily: dailyRes.rows.map((r) => ({ day: String(r['Date'] ?? '').slice(0, 10), count: countOf(r) })),
    byOwner,
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
