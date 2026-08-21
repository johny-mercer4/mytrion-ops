/**
 * The Today worklist — every open case that wants an action, in one risk-ordered list.
 *
 * SHAPE OF THE QUERY, and why it is not one statement: the lanes are a precedence chain over
 * five independent signals (promise, plan, contact age, agency state, settlement), and expressing
 * that chain in SQL means a CASE ladder over four correlated subqueries that nothing can unit-test
 * without a database. Instead the repo does five bounded reads keyed on the SAME open-case id set
 * and classifies in `deskPolicy.laneFor`, which is pure and covered directly.
 *
 * That is only defensible because the set is small and bounded: `collection_cases` holds ~494 rows
 * of which ~322 are open, and `WORKLIST_SCAN_CAP` refuses to grow past 1,000 rather than silently
 * degrading if the finder's floor ever changes. Every follow-up read is `WHERE case_id IN (...)`
 * over that id list, so nothing here scans a whole table.
 *
 * NO COPY LIVES HERE. The repo returns the FACTS behind a lane (amount, days late, missed count);
 * the sentence a collector reads is composed in the workspace, where the rest of the wording is.
 */
import { and, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { arrayReports, collectionCases } from '../db/schema/collection.js';
import {
  DESK_POLICY,
  daysBetween,
  laneFor,
  riskScore,
  type WorklistLane,
  type WorklistSignals,
} from '../modules/collection/deskPolicy.js';
import type { TenantContext } from '../types/tenantContext.js';
import { collectionActivityRepo, type LastContact } from './collectionActivityRepo.js';
import { reportPeriodSortKey } from './arrayPeriod.js';
import { canReadCollectionSnapshot } from './collectionAccess.js';
import { collectionPlanRepo, type CollectionPromiseDto } from './collectionPlanRepo.js';
import { toCollectionCaseDto, type CollectionCaseDto } from './collectionCaseRepo.js';
import { normalizePagination } from './util.js';

/**
 * Hard ceiling on the open-case scan. The book is ~322 open; 1,000 is three times headroom and
 * a loud failure mode (a truncated worklist with `scanTruncated: true` on the response) rather
 * than a query that quietly gets slower every quarter.
 */
export const WORKLIST_SCAN_CAP = 1000;
export const WORKLIST_MAX_LIMIT = 200;

export interface WorklistItem {
  case: CollectionCaseDto;
  lane: WorklistLane;
  score: number;
  lastContact: LastContact | null;
  daysSinceContact: number | null;
  promise: (CollectionPromiseDto & { daysLate: number }) | null;
  plan: { planId: string; paid: number; missed: number; total: number } | null;
  agencyReturned: boolean;
  /** Days until the case crosses the agency day threshold. Negative once it is past. */
  daysToAgency: number;
}

export interface WorklistResult {
  items: WorklistItem[];
  total: number;
  lanes: Record<WorklistLane, number>;
  /** True when the open book exceeded WORKLIST_SCAN_CAP and the lanes are therefore partial. */
  scanTruncated: boolean;
}

/** What the desk knows about a case beyond the finder's snapshot. */
export interface CaseDeskInfo {
  lastContact: LastContact | null;
  daysSinceContact: number | null;
  promise: (CollectionPromiseDto & { daysLate: number }) | null;
  plan: { planId: string; paid: number; missed: number; total: number } | null;
}

export interface WorklistFilter {
  lane?: WorklistLane | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

function emptyLanes(): Record<WorklistLane, number> {
  return {
    plan_broken: 0,
    promise_due: 0,
    agency_returned: 0,
    agency_threshold: 0,
    payment_posted: 0,
    new_intake: 0,
    silent: 0,
  };
}

function searchClause(term: string | undefined): SQL | undefined {
  const q = term?.trim();
  if (!q) return undefined;
  const like = `%${q}%`;
  return or(
    ilike(collectionCases.displayName, like),
    ilike(collectionCases.debtorCompanyName, like),
    ilike(collectionCases.debtorFullName, like),
    ilike(collectionCases.carrierId, like),
    ilike(collectionCases.debtorMcDot, like),
  );
}

/**
 * Carriers whose Array tradeline the agency has CLOSED and handed back.
 *
 * Read off `array_reports`: the newest filing per carrier with an agency on it and a
 * `date_closed`. That is the only signal the snapshot carries for a returned placement — there is
 * no "returned" column — so it is derived here once rather than in three call sites.
 */
async function returnedCarriers(carrierIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (carrierIds.length === 0) return out;
  const rows = await db
    .selectDistinctOn([arrayReports.carrierId], {
      carrierId: arrayReports.carrierId,
      dateClosed: arrayReports.dateClosed,
      hasAgency: arrayReports.hasAgency,
    })
    .from(arrayReports)
    .where(inArray(arrayReports.carrierId, [...carrierIds]))
    .orderBy(arrayReports.carrierId, desc(reportPeriodSortKey));
  for (const row of rows) {
    if (row.hasAgency === true && row.dateClosed !== null) out.add(row.carrierId);
  }
  return out;
}

export const collectionWorklistRepo = {
  async worklist(ctx: TenantContext, filter: WorklistFilter = {}): Promise<WorklistResult> {
    if (!canReadCollectionSnapshot(ctx)) {
      return { items: [], total: 0, lanes: emptyLanes(), scanTruncated: false };
    }

    // Overdue instalments and lapsed promises are settled BEFORE the lanes are computed, so the
    // board never shows a promise as "due" three weeks after its grace period ran out. Idempotent
    // and cheap (two indexed updates that usually match nothing); this desk has no scheduler.
    await collectionPlanRepo.sweepOverdue(DESK_POLICY.promiseGraceDays);

    const where = and(eq(collectionCases.status, 'open'), searchClause(filter.search));
    const rows = await db
      .select()
      .from(collectionCases)
      .where(where)
      .orderBy(desc(collectionCases.totalDebtAmount), desc(collectionCases.id))
      .limit(WORKLIST_SCAN_CAP + 1);
    const scanTruncated = rows.length > WORKLIST_SCAN_CAP;
    const open = scanTruncated ? rows.slice(0, WORKLIST_SCAN_CAP) : rows;
    if (open.length === 0) {
      return { items: [], total: 0, lanes: emptyLanes(), scanTruncated };
    }

    const caseIds = open.map((r) => r.id);
    const carrierIds = [...new Set(open.map((r) => r.carrierId))];
    const [contacts, promises, plans, returned] = await Promise.all([
      collectionActivityRepo.lastContactByCase(ctx, caseIds),
      collectionPlanRepo.openPromisesByCase(ctx, caseIds),
      collectionPlanRepo.planProgressByCase(ctx, caseIds),
      returnedCarriers(carrierIds),
    ]);

    const now = new Date();
    const lanes = emptyLanes();
    const items: WorklistItem[] = [];
    for (const row of open) {
      const contact = contacts.get(row.id) ?? null;
      const promise = promises.get(row.id) ?? null;
      const plan = plans.get(row.id) ?? null;
      const daysSinceContact = contact ? daysBetween(new Date(contact.occurredAt), now) : null;
      const promiseDaysLate = promise
        ? daysBetween(new Date(`${promise.dueDate}T00:00:00Z`), now)
        : 0;
      const remaining = Number(row.totalDebtAmount);
      const signals: WorklistSignals = {
        daysPastDue: row.daysPastDue,
        remaining: Number.isFinite(remaining) ? remaining : 0,
        stage: row.collectionStage,
        daysSinceContact,
        daysSinceOpened: daysBetween(new Date(`${row.caseCreatedDate.slice(0, 10)}T00:00:00Z`), now),
        promise: promise ? { amount: Number(promise.amount), daysLate: promiseDaysLate } : null,
        plan: plan ? { missed: plan.missed, paid: plan.paid, total: plan.total } : null,
        agencyReturned: returned.has(row.carrierId),
        settled: (Number.isFinite(remaining) ? remaining : 0) <= 0,
      };
      const lane = laneFor(signals);
      if (!lane) continue;
      lanes[lane] += 1;
      if (filter.lane && filter.lane !== lane) continue;
      items.push({
        case: toCollectionCaseDto(row),
        lane,
        score: riskScore(lane, signals),
        lastContact: contact,
        daysSinceContact,
        promise: promise ? { ...promise, daysLate: promiseDaysLate } : null,
        plan,
        agencyReturned: signals.agencyReturned,
        daysToAgency: DESK_POLICY.agencyMinDaysPastDue - row.daysPastDue,
      });
    }

    items.sort((a, b) => b.score - a.score || a.case.id.localeCompare(b.case.id));
    const { limit, offset } = normalizePagination(filter, WORKLIST_MAX_LIMIT);
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      lanes,
      scanTruncated,
    };
  },

  /**
   * Desk state for an arbitrary set of cases — last touch, open promise, plan progress.
   *
   * The Cases list needs exactly this to render its two new columns, and it must NOT pay for the
   * worklist's classification pass to get it. Bounded by the caller's id list (one page of rows).
   */
  async deskInfoByCase(ctx: TenantContext, caseIds: readonly string[]): Promise<Map<string, CaseDeskInfo>> {
    const out = new Map<string, CaseDeskInfo>();
    if (!canReadCollectionSnapshot(ctx) || caseIds.length === 0) return out;
    const [contacts, promises, plans] = await Promise.all([
      collectionActivityRepo.lastContactByCase(ctx, caseIds),
      collectionPlanRepo.openPromisesByCase(ctx, caseIds),
      collectionPlanRepo.planProgressByCase(ctx, caseIds),
    ]);
    const now = new Date();
    for (const id of caseIds) {
      const contact = contacts.get(id) ?? null;
      const promise = promises.get(id) ?? null;
      out.set(id, {
        lastContact: contact,
        daysSinceContact: contact ? daysBetween(new Date(contact.occurredAt), now) : null,
        promise: promise
          ? { ...promise, daysLate: daysBetween(new Date(`${promise.dueDate}T00:00:00Z`), now) }
          : null,
        plan: plans.get(id) ?? null,
      });
    }
    return out;
  },

  /**
   * The three figures on the Today header that the worklist itself cannot answer: recovered this
   * month, and how it was recovered. Counted over the whole book, never the current lane — a tile
   * that moves when you filter under it cannot be used to check your work.
   */
  async recovery(ctx: TenantContext): Promise<{
    recoveredMtd: string;
    openCases: number;
    remainingDebt: string;
    agencyPlaced: number;
  }> {
    if (!canReadCollectionSnapshot(ctx)) {
      return { recoveredMtd: '0', openCases: 0, remainingDebt: '0', agencyPlaced: 0 };
    }
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [book, mtd] = await Promise.all([
      db
        .select({
          openCases: sql<number>`count(*) FILTER (WHERE ${collectionCases.status} = 'open')::int`,
          remainingDebt: sql<string>`coalesce(sum(${collectionCases.totalDebtAmount}) FILTER (WHERE ${collectionCases.status} = 'open'), 0)::text`,
          agencyPlaced: sql<number>`count(*) FILTER (WHERE ${collectionCases.placementDate} IS NOT NULL)::int`,
        })
        .from(collectionCases),
      db
        .select({
          total: sql<string>`coalesce(sum(${collectionCases.totalAmountPaid}), 0)::text`,
        })
        .from(collectionCases)
        .where(
          and(
            isNotNull(collectionCases.closedAt),
            sql`${collectionCases.closedAt} >= ${monthStart.toISOString()}`,
          ),
        ),
    ]);
    return {
      recoveredMtd: mtd[0]?.total ?? '0',
      openCases: book[0]?.openCases ?? 0,
      remainingDebt: book[0]?.remainingDebt ?? '0',
      agencyPlaced: book[0]?.agencyPlaced ?? 0,
    };
  },
};
