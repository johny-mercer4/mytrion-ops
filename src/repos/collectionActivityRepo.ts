/**
 * Collection activity — the case timeline, and the `last touch` the list and worklist read.
 *
 * One feed for contact attempts, payments, stage moves, agency events and plain notes: they are
 * all "what happened to this debt", and splitting them into four tables would mean four queries
 * and a merge sort in the browser to render one column of events.
 *
 * `lastContactByCase` is DISTINCT ON rather than a group-by-max plus a second fetch, because the
 * list needs the CHANNEL as well as the timestamp and the row it came from is the only place
 * both live together.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  collectionActivity,
  type CollectionActivityKind,
  type CollectionActivityRow,
  type CollectionContactChannel,
  type CollectionContactOutcome,
  type NewCollectionActivityRow,
} from '../db/schema/collection_desk.js';
import type { TenantContext } from '../types/tenantContext.js';
import { canReadCollectionSnapshot } from './collectionAccess.js';
import { firstOrThrow, normalizePagination } from './util.js';

export const COLLECTION_ACTIVITY_MAX_LIMIT = 200;

export interface CollectionActivityDto {
  id: string;
  caseId: string;
  kind: CollectionActivityKind;
  channel: CollectionContactChannel | null;
  outcome: CollectionContactOutcome | null;
  summary: string;
  note: string | null;
  contactName: string | null;
  amount: string | null;
  actorUserId: string | null;
  actorName: string | null;
  meta: Record<string, unknown> | null;
  occurredAt: string;
}

/** Newest logged contact on a case — the `Last touch` column, and the `silent` lane's input. */
export interface LastContact {
  occurredAt: string;
  channel: CollectionContactChannel | null;
  outcome: CollectionContactOutcome | null;
}

export function toActivityDto(row: CollectionActivityRow): CollectionActivityDto {
  return {
    id: row.id,
    caseId: row.caseId,
    kind: row.kind,
    channel: row.channel ?? null,
    outcome: row.outcome ?? null,
    summary: row.summary,
    note: row.note,
    contactName: row.contactName,
    amount: row.amount,
    actorUserId: row.actorUserId,
    actorName: row.actorName,
    meta: row.meta ?? null,
    occurredAt: row.occurredAt.toISOString(),
  };
}

export const collectionActivityRepo = {
  async listByCase(
    ctx: TenantContext,
    caseId: string,
    page?: { limit?: number | undefined; offset?: number | undefined; kind?: CollectionActivityKind | undefined },
  ): Promise<{ items: CollectionActivityDto[]; total: number }> {
    if (!canReadCollectionSnapshot(ctx)) return { items: [], total: 0 };
    const { limit, offset } = normalizePagination(page, COLLECTION_ACTIVITY_MAX_LIMIT);
    const where = page?.kind
      ? and(eq(collectionActivity.caseId, caseId), eq(collectionActivity.kind, page.kind))
      : eq(collectionActivity.caseId, caseId);
    const [rows, counts] = await Promise.all([
      db
        .select()
        .from(collectionActivity)
        .where(where)
        .orderBy(desc(collectionActivity.occurredAt), desc(collectionActivity.id))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(collectionActivity).where(where),
    ]);
    return { items: rows.map(toActivityDto), total: counts[0]?.count ?? 0 };
  },

  /**
   * Newest `contact` entry per case, for the given case ids.
   *
   * Bounded by the caller's id list, so this never scans the whole feed. Returns a Map rather
   * than rows because both consumers (list, worklist) index into it by case id.
   */
  async lastContactByCase(ctx: TenantContext, caseIds: readonly string[]): Promise<Map<string, LastContact>> {
    const out = new Map<string, LastContact>();
    if (!canReadCollectionSnapshot(ctx) || caseIds.length === 0) return out;
    const rows = await db
      .selectDistinctOn([collectionActivity.caseId], {
        caseId: collectionActivity.caseId,
        occurredAt: collectionActivity.occurredAt,
        channel: collectionActivity.channel,
        outcome: collectionActivity.outcome,
      })
      .from(collectionActivity)
      .where(
        and(eq(collectionActivity.kind, 'contact'), inArray(collectionActivity.caseId, [...caseIds])),
      )
      .orderBy(collectionActivity.caseId, desc(collectionActivity.occurredAt));
    for (const row of rows) {
      out.set(row.caseId, {
        occurredAt: row.occurredAt.toISOString(),
        channel: row.channel ?? null,
        outcome: row.outcome ?? null,
      });
    }
    return out;
  },

  /**
   * Append one entry. There is no update and no delete: a timeline that can be edited after the
   * fact is not a record of what happened, and this one is read before a debt is written off.
   */
  async insert(entry: NewCollectionActivityRow): Promise<CollectionActivityDto> {
    const rows = await db.insert(collectionActivity).values(entry).returning();
    return toActivityDto(firstOrThrow(rows, 'collection activity insert returned no row'));
  },
};
