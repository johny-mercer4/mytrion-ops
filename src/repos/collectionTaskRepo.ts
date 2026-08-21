/**
 * Follow-ups on a collection case.
 *
 * The worklist decides what needs attention today from policy and case state; a task is the
 * reminder a collector sets for themselves — "call this one back Thursday". Mutable, so it does
 * not belong in `collection_activity`, which is an append-only log.
 *
 * Reads are bounded like the rest of the desk: per-case lists are capped, and the cross-case
 * "what is due" read is capped and ordered so an offset page cannot skip or duplicate.
 */
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  collectionTasks,
  type CollectionTask,
  type CollectionTaskPriority,
  type CollectionTaskStatus,
} from '../db/schema/collection_tasks.js';
import type { TenantContext } from '../types/tenantContext.js';
import { canReadCollectionSnapshot } from './collectionAccess.js';
import { normalizePagination } from './util.js';

export const COLLECTION_TASKS_MAX_LIMIT = 100;

export interface CollectionTaskDto {
  id: string;
  caseId: string;
  title: string;
  note: string | null;
  dueDate: string;
  status: CollectionTaskStatus;
  priority: CollectionTaskPriority;
  assigneeUserId: string | null;
  assigneeName: string | null;
  completedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  /** Whole days past due. Negative while it is still in the future; null once it is not open. */
  daysLate: number | null;
}

const day = (d: string | null | undefined): string | null => (d ? d.slice(0, 10) : null);

/**
 * Day difference in whole UTC days. Both sides are pinned to midnight UTC first so a task due
 * today never reads as late because the server clock is past noon.
 */
function daysBetween(from: string, to: Date): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

export function toCollectionTaskDto(row: CollectionTask, now = new Date()): CollectionTaskDto {
  const dueDate = row.dueDate.slice(0, 10);
  return {
    id: row.id,
    caseId: row.caseId,
    title: row.title,
    note: row.note,
    dueDate,
    status: row.status,
    priority: row.priority,
    assigneeUserId: row.assigneeUserId,
    assigneeName: row.assigneeName,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    daysLate: row.status === 'open' ? daysBetween(dueDate, now) : null,
  };
}

export interface NewTaskInput {
  caseId: string;
  title: string;
  note?: string | null;
  dueDate: string;
  priority?: CollectionTaskPriority;
  assigneeUserId?: string | null;
  assigneeName?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
}

export const collectionTaskRepo = {
  async listByCase(ctx: TenantContext, caseId: string): Promise<CollectionTaskDto[]> {
    if (!canReadCollectionSnapshot(ctx)) return [];
    const rows = await db
      .select()
      .from(collectionTasks)
      .where(eq(collectionTasks.caseId, caseId))
      // Open first, then soonest due. A collector reads the top of this list and stops.
      .orderBy(
        sql`case when ${collectionTasks.status} = 'open' then 0 else 1 end`,
        asc(collectionTasks.dueDate),
        desc(collectionTasks.createdAt),
      )
      .limit(COLLECTION_TASKS_MAX_LIMIT);
    return rows.map((r) => toCollectionTaskDto(r));
  },

  /** Open tasks per case, for the list and board — one bounded read, not one per row. */
  async openCountsByCase(
    ctx: TenantContext,
    caseIds: readonly string[],
  ): Promise<Map<string, { open: number; overdue: number; nextDue: string | null }>> {
    const out = new Map<string, { open: number; overdue: number; nextDue: string | null }>();
    if (!canReadCollectionSnapshot(ctx) || caseIds.length === 0) return out;
    const today = new Date().toISOString().slice(0, 10);
    const rows = await db
      .select({
        caseId: collectionTasks.caseId,
        open: sql<number>`count(*)::int`,
        overdue: sql<number>`count(*) FILTER (WHERE ${collectionTasks.dueDate} < ${today})::int`,
        nextDue: sql<string | null>`min(${collectionTasks.dueDate})::text`,
      })
      .from(collectionTasks)
      .where(and(eq(collectionTasks.status, 'open'), inArray(collectionTasks.caseId, [...caseIds])))
      .groupBy(collectionTasks.caseId);
    for (const r of rows) {
      out.set(r.caseId, { open: r.open, overdue: r.overdue, nextDue: day(r.nextDue) });
    }
    return out;
  },

  /** Everything open and due on or before `through`, newest-pressure first. */
  async due(
    ctx: TenantContext,
    filter: { through: string; assigneeUserId?: string | undefined; limit?: number | undefined },
  ): Promise<CollectionTaskDto[]> {
    if (!canReadCollectionSnapshot(ctx)) return [];
    const { limit } = normalizePagination({ limit: filter.limit }, COLLECTION_TASKS_MAX_LIMIT);
    const clauses = [eq(collectionTasks.status, 'open'), lte(collectionTasks.dueDate, filter.through)];
    if (filter.assigneeUserId) {
      clauses.push(eq(collectionTasks.assigneeUserId, filter.assigneeUserId));
    }
    const rows = await db
      .select()
      .from(collectionTasks)
      .where(and(...clauses))
      .orderBy(asc(collectionTasks.dueDate), asc(collectionTasks.id))
      .limit(limit);
    return rows.map((r) => toCollectionTaskDto(r));
  },

  async create(input: NewTaskInput): Promise<CollectionTaskDto> {
    const rows = await db
      .insert(collectionTasks)
      .values({
        caseId: input.caseId,
        title: input.title,
        note: input.note ?? null,
        dueDate: input.dueDate,
        status: 'open',
        priority: input.priority ?? 'normal',
        assigneeUserId: input.assigneeUserId ?? null,
        assigneeName: input.assigneeName ?? null,
        createdById: input.createdById ?? null,
        createdByName: input.createdByName ?? null,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('collection task insert returned no row');
    return toCollectionTaskDto(row);
  },

  /**
   * Reschedule, re-word, reassign, or resolve. Completing stamps `completed_at`; reopening clears
   * it, so a task that is reopened does not keep claiming it was finished.
   */
  async update(
    id: string,
    patch: {
      title?: string;
      note?: string | null;
      dueDate?: string;
      priority?: CollectionTaskPriority;
      assigneeUserId?: string | null;
      assigneeName?: string | null;
      status?: CollectionTaskStatus;
      completedById?: string | null;
    },
  ): Promise<CollectionTaskDto | undefined> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['title', 'note', 'dueDate', 'priority', 'assigneeUserId', 'assigneeName'] as const) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    if (patch.status !== undefined) {
      set['status'] = patch.status;
      set['completedAt'] = patch.status === 'open' ? null : new Date();
      set['completedById'] = patch.status === 'open' ? null : (patch.completedById ?? null);
    }
    const rows = await db
      .update(collectionTasks)
      .set(set)
      .where(eq(collectionTasks.id, id))
      .returning();
    const row = rows[0];
    return row ? toCollectionTaskDto(row) : undefined;
  },

  async findById(id: string): Promise<CollectionTask | undefined> {
    const rows = await db.select().from(collectionTasks).where(eq(collectionTasks.id, id)).limit(1);
    return rows[0];
  },
};
