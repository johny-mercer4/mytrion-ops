/**
 * Promises to pay and payment plans — the two commitments a collector takes on a call.
 *
 * They live in one repo because they are the same decision at two time-scales (one date vs a
 * schedule of them) and every consumer reads both together: the worklist to build its lanes, the
 * case record to render the plan strip and the promise chip.
 *
 * A plan's schedule is MATERIALISED into `collection_plan_instalments` at create time rather than
 * derived on read. "Instalment 4 was missed" is a fact about a date that has passed; once a plan
 * is revised, no formula over the surviving plan row can recover it.
 */
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  collectionPaymentPlans,
  collectionPlanInstalments,
  collectionPromises,
  type CollectionInstalmentStatus,
  type CollectionPaymentPlanRow,
  type CollectionPlanFrequency,
  type CollectionPlanInstalmentRow,
  type CollectionPromiseRow,
  type CollectionPromiseStatus,
} from '../db/schema/collection_desk.js';
import type { TenantContext } from '../types/tenantContext.js';
import { canReadCollectionSnapshot } from './collectionAccess.js';
import { firstOrThrow } from './util.js';

export interface CollectionPromiseDto {
  id: string;
  caseId: string;
  amount: string;
  dueDate: string;
  status: CollectionPromiseStatus;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface CollectionInstalmentDto {
  id: string;
  seq: number;
  dueDate: string;
  amount: string;
  status: CollectionInstalmentStatus;
  paidAt: string | null;
}

export interface CollectionPlanDto {
  id: string;
  caseId: string;
  status: 'active' | 'completed' | 'cancelled' | 'broken';
  instalmentAmount: string;
  instalmentCount: number;
  frequency: CollectionPlanFrequency;
  firstPaymentDate: string;
  note: string | null;
  supersedesPlanId: string | null;
  createdByName: string | null;
  createdAt: string;
  instalments: CollectionInstalmentDto[];
}

const day = (d: string): string => d.slice(0, 10);

function toPromiseDto(row: CollectionPromiseRow): CollectionPromiseDto {
  return {
    id: row.id,
    caseId: row.caseId,
    amount: row.amount,
    dueDate: day(row.dueDate),
    status: row.status,
    note: row.note,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
  };
}

function toInstalmentDto(row: CollectionPlanInstalmentRow): CollectionInstalmentDto {
  return {
    id: row.id,
    seq: row.seq,
    dueDate: day(row.dueDate),
    amount: row.amount,
    status: row.status,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
  };
}

function toPlanDto(row: CollectionPaymentPlanRow, instalments: CollectionInstalmentDto[]): CollectionPlanDto {
  return {
    id: row.id,
    caseId: row.caseId,
    status: row.status,
    instalmentAmount: row.instalmentAmount,
    instalmentCount: row.instalmentCount,
    frequency: row.frequency,
    firstPaymentDate: day(row.firstPaymentDate),
    note: row.note,
    supersedesPlanId: row.supersedesPlanId,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    instalments,
  };
}

/**
 * The dates a plan falls due on. Month arithmetic clamps to the end of a short month, so a plan
 * that starts on the 31st bills on the 28th in February rather than skipping into March.
 */
export function scheduleDates(
  firstPaymentDate: string,
  count: number,
  frequency: CollectionPlanFrequency,
): string[] {
  const start = new Date(`${firstPaymentDate}T00:00:00Z`);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(start.getTime());
    if (frequency === 'monthly') {
      const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      const lastDay = new Date(
        Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
      ).getUTCDate();
      target.setUTCDate(Math.min(start.getUTCDate(), lastDay));
      out.push(target.toISOString().slice(0, 10));
      continue;
    }
    const step = frequency === 'weekly' ? 7 : 14;
    d.setUTCDate(d.getUTCDate() + step * i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export const collectionPlanRepo = {
  /** Every promise on a case, newest due-date first. */
  async listPromises(ctx: TenantContext, caseId: string): Promise<CollectionPromiseDto[]> {
    if (!canReadCollectionSnapshot(ctx)) return [];
    const rows = await db
      .select()
      .from(collectionPromises)
      .where(eq(collectionPromises.caseId, caseId))
      .orderBy(desc(collectionPromises.dueDate), desc(collectionPromises.id));
    return rows.map(toPromiseDto);
  },

  /** Open promises across a set of cases — the worklist's `promise_due` lane. */
  async openPromisesByCase(
    ctx: TenantContext,
    caseIds: readonly string[],
  ): Promise<Map<string, CollectionPromiseDto>> {
    const out = new Map<string, CollectionPromiseDto>();
    if (!canReadCollectionSnapshot(ctx) || caseIds.length === 0) return out;
    const rows = await db
      .selectDistinctOn([collectionPromises.caseId])
      .from(collectionPromises)
      .where(
        and(eq(collectionPromises.status, 'open'), inArray(collectionPromises.caseId, [...caseIds])),
      )
      .orderBy(collectionPromises.caseId, asc(collectionPromises.dueDate));
    for (const row of rows) out.set(row.caseId, toPromiseDto(row));
    return out;
  },

  async createPromise(input: {
    caseId: string;
    amount: string;
    dueDate: string;
    note?: string | undefined;
    createdByUserId?: string | undefined;
    createdByName?: string | undefined;
  }): Promise<CollectionPromiseDto> {
    const rows = await db.insert(collectionPromises).values(input).returning();
    return toPromiseDto(firstOrThrow(rows, 'promise insert returned no row'));
  },

  /** Settle a promise. `kept` when money landed, `broken` when the grace period ran out. */
  async resolvePromise(id: string, status: Exclude<CollectionPromiseStatus, 'open'>): Promise<void> {
    await db
      .update(collectionPromises)
      .set({ status, resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(collectionPromises.id, id));
  },

  /** The one active plan on a case, with its schedule. */
  async activePlan(ctx: TenantContext, caseId: string): Promise<CollectionPlanDto | null> {
    if (!canReadCollectionSnapshot(ctx)) return null;
    const plans = await db
      .select()
      .from(collectionPaymentPlans)
      .where(and(eq(collectionPaymentPlans.caseId, caseId), eq(collectionPaymentPlans.status, 'active')))
      .limit(1);
    const plan = plans[0];
    if (!plan) return null;
    const instalments = await db
      .select()
      .from(collectionPlanInstalments)
      .where(eq(collectionPlanInstalments.planId, plan.id))
      .orderBy(asc(collectionPlanInstalments.seq));
    return toPlanDto(plan, instalments.map(toInstalmentDto));
  },

  /**
   * Per-case instalment tally for the active plans across a set of cases. The worklist needs
   * "how many missed" and nothing else, so this counts in Postgres rather than shipping the
   * whole schedule of every plan in the book.
   */
  async planProgressByCase(
    ctx: TenantContext,
    caseIds: readonly string[],
  ): Promise<Map<string, { planId: string; paid: number; missed: number; total: number }>> {
    const out = new Map<string, { planId: string; paid: number; missed: number; total: number }>();
    if (!canReadCollectionSnapshot(ctx) || caseIds.length === 0) return out;
    const rows = await db
      .select({
        caseId: collectionPaymentPlans.caseId,
        planId: collectionPaymentPlans.id,
        total: sql<number>`count(${collectionPlanInstalments.id})::int`,
        paid: sql<number>`count(*) FILTER (WHERE ${collectionPlanInstalments.status} = 'paid')::int`,
        missed: sql<number>`count(*) FILTER (WHERE ${collectionPlanInstalments.status} = 'missed')::int`,
      })
      .from(collectionPaymentPlans)
      .leftJoin(
        collectionPlanInstalments,
        eq(collectionPlanInstalments.planId, collectionPaymentPlans.id),
      )
      .where(
        and(
          eq(collectionPaymentPlans.status, 'active'),
          inArray(collectionPaymentPlans.caseId, [...caseIds]),
        ),
      )
      .groupBy(collectionPaymentPlans.caseId, collectionPaymentPlans.id);
    for (const row of rows) {
      out.set(row.caseId, { planId: row.planId, paid: row.paid, missed: row.missed, total: row.total });
    }
    return out;
  },

  /**
   * Start a plan, closing any plan already running on the case.
   *
   * One transaction: the partial unique index on (case_id) WHERE status = 'active' means a
   * half-applied revision would either lose the old plan or be rejected outright, and both are
   * worse than failing the whole call.
   */
  async createPlan(input: {
    caseId: string;
    instalmentAmount: string;
    instalmentCount: number;
    frequency: CollectionPlanFrequency;
    firstPaymentDate: string;
    note?: string | undefined;
    createdByUserId?: string | undefined;
    createdByName?: string | undefined;
  }): Promise<CollectionPlanDto> {
    return db.transaction(async (tx) => {
      const superseded = await tx
        .update(collectionPaymentPlans)
        .set({ status: 'cancelled', closedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(collectionPaymentPlans.caseId, input.caseId),
            eq(collectionPaymentPlans.status, 'active'),
          ),
        )
        .returning({ id: collectionPaymentPlans.id });
      const previous = superseded[0]?.id;
      const planRows = await tx
        .insert(collectionPaymentPlans)
        .values({ ...input, ...(previous ? { supersedesPlanId: previous } : {}) })
        .returning();
      const plan = firstOrThrow(planRows, 'payment plan insert returned no row');
      const dates = scheduleDates(input.firstPaymentDate, input.instalmentCount, input.frequency);
      const instalmentRows = await tx
        .insert(collectionPlanInstalments)
        .values(
          dates.map((dueDate, i) => ({
            planId: plan.id,
            caseId: input.caseId,
            seq: i + 1,
            dueDate,
            amount: input.instalmentAmount,
          })),
        )
        .returning();
      return toPlanDto(
        plan,
        instalmentRows.map(toInstalmentDto).sort((a, b) => a.seq - b.seq),
      );
    });
  },

  async closePlan(planId: string, status: 'completed' | 'cancelled' | 'broken'): Promise<void> {
    await db
      .update(collectionPaymentPlans)
      .set({ status, closedAt: new Date(), updatedAt: new Date() })
      .where(eq(collectionPaymentPlans.id, planId));
  },

  async setInstalmentStatus(id: string, status: CollectionInstalmentStatus): Promise<void> {
    await db
      .update(collectionPlanInstalments)
      .set({
        status,
        ...(status === 'paid' ? { paidAt: new Date() } : { paidAt: null }),
        updatedAt: new Date(),
      })
      .where(eq(collectionPlanInstalments.id, id));
  },

  /**
   * Mark every scheduled instalment whose due date has passed as missed, and every open promise
   * past its grace period as broken. Idempotent, so it is safe to call on every worklist read —
   * which is where it runs, because this desk has no scheduler and a lane that only fills in when
   * a cron happens to have run is a lane nobody trusts.
   */
  async sweepOverdue(graceDays: number, today = new Date()): Promise<void> {
    const graceCutoff = new Date(today.getTime() - graceDays * 86_400_000).toISOString().slice(0, 10);
    await db
      .update(collectionPlanInstalments)
      .set({ status: 'missed', updatedAt: new Date() })
      .where(
        and(
          eq(collectionPlanInstalments.status, 'scheduled'),
          lte(collectionPlanInstalments.dueDate, graceCutoff),
        ),
      );
    await db
      .update(collectionPromises)
      .set({ status: 'broken', resolvedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(collectionPromises.status, 'open'),
          lte(collectionPromises.dueDate, graceCutoff),
        ),
      );
  },
};
